import { myId, sendSignalingMessage, listenSignalingMessage } from "./room.js";

export const peerConnections = {};
let localStreamRef = null;
let onRemoteStreamRef = null;

// アプリ起動時にシグナリングの受信待機を自動開始
listenSignalingMessage((fromPeerId, signalingData) => {
  handleSignalingMessage(fromPeerId, signalingData);
});

// チャット通信の関数（app.js側でエラーが起きないように空関数として定義）
export function registerOnMessage(callback) {}
export function broadcastMessage(messageData) {}

// P2P接続の開始
export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  if (localStream) localStreamRef = localStream;
  if (onRemoteStream) onRemoteStreamRef = onRemoteStream;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  const currentStream = localStream || localStreamRef;
  if (currentStream) {
    currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
  }

  pc.ontrack = (e) => {
    if (onRemoteStreamRef) onRemoteStreamRef(peerId, e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { type: "candidate", candidate: e.candidate.toJSON() });
    }
  };

  // 自分の方がIDが小さい場合、Offerを作成して送信
  if (myId < peerId) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        sendSignalingMessage(peerId, { type: "offer", sdp: pc.localDescription.sdp });
      })
      .catch(err => console.error("Offer作成失敗:", err));
  }
}

// シグナリングデータの処理
async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  if (!pc && data.type === "offer") {
    startP2P(fromPeerId, localStreamRef, onRemoteStreamRef);
    pc = peerConnections[fromPeerId];
  }

  if (!pc) return;

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalingMessage(fromPeerId, { type: "answer", sdp: pc.localDescription.sdp });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
    } else if (data.type === "candidate") {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error("シグナリング処理エラー:", err);
  }
}

export function closeP2P(peerId) {
  if (peerConnections[peerId]) {
    try { peerConnections[peerId].close(); } catch(e){}
    delete peerConnections[peerId];
  }
}
