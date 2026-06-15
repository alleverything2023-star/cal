import { myId, sendSignalingMessage, listenSignalingMessage } from "./room.js";

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;

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

// 共通のデータチャネル（チャット）設定関数
function setupDataChannel(peerId, dc) {
  dataChannels[peerId] = dc;

  dc.onopen = () => console.log(`[DataChannel] 接続完了: ${peerId}`);
  dc.onclose = () => {
    console.log(`[DataChannel] 切断: ${peerId}`);
    delete dataChannels[peerId];
  };
  dc.onerror = (err) => console.error("[DataChannel] エラー:", err);

  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (onMessageCallback) {
        onMessageCallback(data.sender, data.text);
      }
    } catch (err) {
      console.error("[DataChannel] データパース失敗:", err);
    }
  };
}

// P2P接続の初期化・開始関数
export function startP2P(peerId, localStream = null) {
  if (peerConnections[peerId]) return;

  // app.jsに紐づいているローカルストリームを安全に取得
  let currentStream = localStream;
  if (!currentStream && window.getGlobalLocalStream) {
    currentStream = window.getGlobalLocalStream();
  }

  console.log(`[WebRTC] 接続を初期化します: ターゲット=${peerId}`);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  // 自分のカメラ・マイクのトラックを追加
  if (currentStream) {
    currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
  }

  // 相手の映像が届いたときの処理
  pc.ontrack = (e) => {
    console.log(`[WebRTC] 相手のストリームを受信しました: ${peerId}`);
    if (window.handleRemoteStreamGlobal) {
      window.handleRemoteStreamGlobal(peerId, e.streams[0]);
    }
  };

  // 経路候補を相手にシグナリング送信
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { type: "candidate", candidate: e.candidate.toJSON() });
    }
  };

  // 相手が開いたDataChannelを検知したときの処理（Answer側がここを通る）
  pc.ondatachannel = (e) => {
    console.log(`[WebRTC] 相手からのDataChannelオープンを検知: ${peerId}`);
    setupDataChannel(peerId, e.channel);
  };

  // 衝突回避ルール：IDが小さい方がOffer側（発信）
  if (myId < peerId) {
    console.log(`[WebRTC] 自分(${myId})がOffer側になります -> ${peerId}`);
    const dc = pc.createDataChannel("chatChannel");
    setupDataChannel(peerId, dc);

    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        sendSignalingMessage(peerId, { type: "offer", sdp: pc.localDescription.sdp });
      })
      .catch(err => console.error("[WebRTC] Offer作成失敗:", err));
  } else {
    console.log(`[WebRTC] 自分(${myId})はAnswer側として待機します -> ${peerId}`);
  }
}

// Firebaseからシグナリングメッセージが届いたときの処理（非同期関数）
async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  // 相手からOfferが届いたときにPCがまだなければ、Answer側としてインスタンスを作成
  if (!pc && data.type === "offer") {
    console.log(`[シグナリング] 新しいOfferを検知したため、Answer側として初期化します: ${fromPeerId}`);
    startP2P(fromPeerId);
    pc = peerConnections[fromPeerId];
  }

  if (!pc) return;

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalingMessage(fromPeerId, { type: "answer", sdp: pc.localDescription.sdp });
      console.log(`[シグナリング] Offerに対してAnswerを送信しました -> ${fromPeerId}`);
    } 
    else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
      console.log(`[シグナリング] Answerを受信し、リモート設定を完了しました -> ${fromPeerId}`);
    } 
    else if (data.type === "candidate") {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log(`[シグナリング] ICE Candidateを適用しました -> ${fromPeerId}`);
    }
  } catch (err) {
    console.error("[シグナリング] 処理エラー:", err);
  }
}

// 【超重要】すべての関数が定義し終わった「一番下」でリスナーを起動する（即死バグ回避）
listenSignalingMessage((fromPeerId, signalingData) => {
  if (fromPeerId && signalingData) {
    handleSignalingMessage(fromPeerId, signalingData);
  }
});

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
