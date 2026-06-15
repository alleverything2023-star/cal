import { myId, sendSignalingMessage, listenSignalingMessage } from "./room.js";

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;

// アプリ起動時にシグナリングの受信待機を自動開始
listenSignalingMessage((fromPeerId, signalingData) => {
  handleSignalingMessage(fromPeerId, signalingData);
});

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

// 接続の初期化コアロジック
export function startP2P(peerId, localStream = null) {
  if (peerConnections[peerId]) return;

  // 1. ローカルストリームの安全な取得（なければapp.jsから持ってくる）
  let currentStream = localStream;
  if (!currentStream && window.getGlobalLocalStream) {
    currentStream = window.getGlobalLocalStream();
  }

  console.log(`[WebRTC] 接続を初期化します: 相手=${peerId}`);

  // 2. PeerConnectionの作成
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  // 3. 自分のトラックを追加
  if (currentStream) {
    currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
  }

  // 4. 相手の映像トラックが届いた時の処理（常にグローバル関数経由で画面に反映）
  pc.ontrack = (e) => {
    console.log(`[WebRTC] 相手の映像ストリームを受信しました: ${peerId}`);
    if (window.handleRemoteStreamGlobal) {
      window.handleRemoteStreamGlobal(peerId, e.streams[0]);
    }
  };

  // 経路が見つかったら送信
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { type: "candidate", candidate: e.candidate });
    }
  };

  // 相手からデータチャネルが開かれた時（Answer側がここを通る）
  pc.ondatachannel = (e) => {
    console.log(`[WebRTC] 相手が作成したDataChannelを検知しました: ${peerId}`);
    setupDataChannel(peerId, e.channel);
  };

  // 5. ID比較による衝突回避ルール（小さいIDの人がOfferを作る）
  if (myId < peerId) {
    console.log(`[WebRTC] 自分(${myId})がOffer側としてDataChannelを作成します -> ${peerId}`);
    const dc = pc.createDataChannel("chatChannel");
    setupDataChannel(peerId, dc);

    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        sendSignalingMessage(peerId, { type: "offer", sdp: pc.localDescription });
      })
      .catch(err => console.error("Offer作成失敗:", err));
  } else {
    console.log(`[WebRTC] 自分(${myId})はAnswer側です。相手からのOfferを待機します -> ${peerId}`);
  }
}

function setupDataChannel(peerId, dc) {
  dataChannels[peerId] = dc;

  dc.onopen = () => console.log(`🎉 チャットのDataChannel通信が完全に確立しました: ${peerId}`);
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

/**
 * Firebase経由で届いたシグナリングを処理
 */
async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  // 相手からOfferが届いた時点でPCがなければ、すぐ作成
  if (!pc && data.type === "offer") {
    startP2P(fromPeerId);
    pc = peerConnections[fromPeerId];
  }

  if (!pc) return;

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalingMessage(fromPeerId, { type: "answer", sdp: pc.localDescription });
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
