import { myId, sendSignalingMessage } from "./room.js";

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;
let localStreamRef = null;
let onRemoteStreamRef = null;

export function registerOnMessage(callback) {
  onMessageCallback = callback;
}

export function broadcastMessage(messageData) {
  const payload = JSON.stringify(messageData);
  for (const id in dataChannels) {
    const dc = dataChannels[id];
    if (dc && dc.readyState === "open") {
      dc.send(payload);
    }
  }
}

export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  localStreamRef = localStream;
  onRemoteStreamRef = onRemoteStream;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (e) => {
    if (onRemoteStream) onRemoteStream(peerId, e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { from: myId, type: "candidate", candidate: e.candidate });
    }
  };

  if (myId < peerId) {
    const dc = pc.createDataChannel("chatChannel");
    setupDataChannel(peerId, dc);

    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        sendSignalingMessage(peerId, { from: myId, type: "offer", sdp: pc.localDescription });
      })
      .catch(err => console.error("Offer作成失敗:", err));
  }

  pc.ondatachannel = (e) => {
    setupDataChannel(peerId, e.channel);
  };
}

function setupDataChannel(peerId, dc) {
  dataChannels[peerId] = dc;

  dc.onopen = () => console.log(`DataChannel 接続完了: ${peerId}`);
  dc.onclose = () => {
    console.log(`DataChannel 切断: ${peerId}`);
    delete dataChannels[peerId];
  };
  dc.onerror = (err) => console.error("DataChannel エラー:", err);

  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (onMessageCallback) {
        onMessageCallback(data.sender, data.text);
      }
    } catch (err) {
      console.error("データ解析失敗:", err);
    }
  };
}

export async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  if (!pc && data.type === "offer") {
    startP2P(fromPeerId, localStreamRef, onRemoteStreamRef);
    pc = peerConnections[fromPeerId];
  }

  if (!pc) return;

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalingMessage(fromPeerId, { from: myId, type: "answer", sdp: pc.localDescription });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === "candidate") {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error("シグナリング処理エラー:", err);
  }
}

export function closeP2P(peerId) {
  if (dataChannels[peerId]) {
    try { dataChannels[peerId].close(); } catch(e){}
    delete dataChannels[peerId];
  }
  if (peerConnections[peerId]) {
    try { peerConnections[peerId].close(); } catch(e){}
    delete peerConnections[peerId];
  }
}
