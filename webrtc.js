import { myId, sendSignalingMessage, listenSignalingMessage } from "./room.js";

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;

// 【改善】app.js側の最新ストリームをいつでも参照できるようにDOMから動的に取得、または保持する仕組み
let localStreamRef = null;
let onRemoteStreamRef = null;

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

// 【修正】自分から接続を仕掛ける（Offer側）か、相手のOfferを受け入れる（Answer側）かを明確に分離
export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  // ストリームの参照を保持
  if (localStream) localStreamRef = localStream;
  if (onRemoteStream) onRemoteStreamRef = onRemoteStream;

  // 1. PeerConnectionの作成
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  // 2. カメラ・マイクのトラックを追加
  const currentStream = localStream || localStreamRef;
  if (currentStream) {
    currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
  }

  // 3. 各種イベントリスナーの設定
  pc.ontrack = (e) => {
    if (onRemoteStreamRef) onRemoteStreamRef(peerId, e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { type: "candidate", candidate: e.candidate });
    }
  };

  // 相手からデータチャネルが送られてきた時用の受け皿（主にAnswer側が通る）
  pc.ondatachannel = (e) => {
    console.log(`[WebRTC] 相手からDataChannelを検出しました: ${peerId}`);
    setupDataChannel(peerId, e.channel);
  };

  // 4. 【超重要】衝突を回避しつつ、Offer側だけが能動的に接続を開始する
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
    console.log(`[WebRTC] 自分(${myId})はAnswer側です。相手からのOffer待機中... -> ${peerId}`);
  }
}

function setupDataChannel(peerId, dc) {
  dataChannels[peerId] = dc;

  dc.onopen = () => console.log(`🎉 チャット用のDataChannelが完全に接続されました: ${peerId}`);
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
 * room.js の受信リスナー経由で自動的に呼び出される
 */
async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  // 【修正】相手からOfferが届いた時、まだPCが無ければ「Answer側（受動側）」として初期化する
  if (!pc && data.type === "offer") {
    // もし app.js の初期化ロジックの都合で localStreamRef が取れない場合、DOMから直接ぶっこ抜く安全策
    if (!localStreamRef) {
      const myLocalVideo = document.getElementById("myLocalVideo");
      if (myLocalVideo && myLocalVideo.srcObject) {
        localStreamRef = myLocalVideo.srcObject;
      }
    }
    // startP2Pを呼び出して、相手用のRTCPeerConnectionを準備
    startP2P(fromPeerId, localStreamRef, onRemoteStreamRef);
    pc = peerConnections[fromPeerId];
  }

  if (!pc) return;

  try {
    if (data.type === "offer") {
      // 相手の条件をセットして、アンサーを返す
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
