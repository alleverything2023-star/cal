import { myId } from "./room.js";

export const peerConnections = {};
const dataChannels = {};
let onMessageCallback = null;

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

export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

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

  // --- DataChannelの設定 ---
  // 接続を仕掛ける側（オファー側）がデータチャンネルを作成する
  // 自分のIDが相手のIDより小さい場合をトリガーとする（競合防止の簡易ルール）
  if (myId < peerId) {
    const dc = pc.createDataChannel("chatChannel");
    setupDataChannel(peerId, dc);
  }

  // 相手からデータチャンネルが送られてきたときの処理（アンサー側）
  pc.ondatachannel = (e) => {
    setupDataChannel(peerId, e.channel);
  };

  // シグナリング処理（仮の実装プレースホルダー：既存のシグナリングロジックと連携させてください）
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      // 実際の実装ではここでシグナリングサーバー経由で相手にICEを送信します
    }
  };

  // ※ 注意: 実際の完全なP2P接続を確立するには、この後にシグナリングサーバー経由で
  // createOffer / createAnswer などのSDPの交換処理を行う必要があります。
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
