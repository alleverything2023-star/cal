import { myId, roomRef } from "./room.js"; // 必要に応じてシグナリング用のインポートを調整してください

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;
let localStreamRef = null;
let onRemoteStreamRef = null;

// app.jsからメッセージ受信時のイベントを受け取るためのハンドラ登録
export function registerOnMessage(callback) {
  onMessageCallback = callback;
}

// 相手にチャットメッセージを一斉送信する関数
export function broadcastMessage(messageData) {
  const payload = JSON.stringify(messageData);
  for (const id in dataChannels) {
    const dc = dataChannels[id];
    if (dc && dc.readyState === "open") {
      dc.send(payload);
    }
  }
}

// シグナリングサーバー経由でメッセージを送信する共通関数（環境に合わせて調整してください）
// 例として room.js 側にメッセージ送信関数がある場合はそちらに差し替えてください
function sendSignaling(targetPeerId, data) {
  // TODO: お使いのシグナリングサーバー（Socket.ioやFirebaseなど）へデータを送信する処理
  // 構造例: room.js 内の関数を呼び出す、など
  // sendSignalingMessage(targetPeerId, { from: myId, ...data });
}

export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  // 後で再利用するために参照を保持
  localStreamRef = localStream;
  onRemoteStreamRef = onRemoteStream;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections[peerId] = pc;

  // トラックの追加
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // 映像ストリーム受信時の処理
  pc.ontrack = (e) => {
    if (onRemoteStream) onRemoteStream(peerId, e.streams[0]);
  };

  // ICE Candidate（経路候補）を発見したときの処理
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignaling(peerId, { type: "candidate", candidate: e.candidate });
    }
  };

  // --- DataChannelの設定 ---
  // 自分のIDが相手のIDより小さい場合、自分から接続（Offer）を仕掛け、DataChannelも作成する
  if (myId < peerId) {
    const dc = pc.createDataChannel("chatChannel");
    setupDataChannel(peerId, dc);

    // Offer（接続要求）の作成と送信
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        sendSignaling(peerId, { type: "offer", sdp: pc.localDescription });
      })
      .catch(err => console.error("Offer作成失敗:", err));
  }

  // 相手からデータチャンネルが送られてきたときの処理（アンサー側用）
  pc.ondatachannel = (e) => {
    setupDataChannel(peerId, e.channel);
  };
}

function setupDataChannel(peerId, dc) {
  dataChannels[peerId] = dc;

  dc.onopen = () => console.log(`DataChannel open with: ${peerId}`);
  dc.onclose = () => {
    console.log(`DataChannel closed with: ${peerId}`);
    delete dataChannels[peerId];
  };
  dc.onerror = (err) => console.error("DataChannel Error:", err);

  // 相手からデータ（チャットなど）が届いたとき
  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (onMessageCallback) {
        onMessageCallback(data.sender, data.text);
      }
    } catch (err) {
      console.error("メッセージのパースに失敗しました:", err);
    }
  };
}

// 外部（シグナリングサーバーの受信イベントなど）からシグナリングメッセージメッセージを受け取ったときに呼び出す関数
// ※room.js等のシグナリング受信イベント内でこの関数を呼び出すように繋ぎ込んでください。
export async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  
  // まだPCが存在せず、相手からOfferが届いた場合は新しく初期化する
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
      sendSignaling(fromPeerId, { type: "answer", sdp: pc.localDescription });
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
