export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

// 外部のシグナリング受信イベントと webrtc.js を繋ぐためのリスナー保持用
let signalingListener = null;

export async function joinRoom(name) {
  roomParticipants[myId] = { name: name };
  console.log(`${name} として部屋に参加しました。ID: ${myId}`);
  
  // 実際のアプリではここでサーバーに「入室通知」を送り、
  // 他の参加者からシグナリングメッセージを受信できるように開始します。
}

export function listenParticipants(callback) {
  setInterval(() => {
    callback(roomParticipants);
  }, 1000);
}

export async function updateMyName(newName) {
  if (roomParticipants[myId]) {
    roomParticipants[myId].name = newName;
  }
}

/**
 * webrtc.js から呼び出されるシグナリング送信関数
 */
export function sendSignalingMessage(targetPeerId, payload) {
  console.log(`[シグナリング送信] 宛先: ${targetPeerId}`, payload);
  
  // ========================================================
  // 【ココを修正！】お使いのサーバー通信コードを記述してください
  // ========================================================
  // (例1: Socket.io の場合)
  // socket.emit("signaling", { to: targetPeerId, from: myId, data: payload });
  //
  // (例2: Firebaseの場合)
  // firebase.database().ref(`rooms/messages/${targetPeerId}`).push({ from: myId, data: payload });
  // ========================================================
}

/**
 * サーバーからシグナリングデータを受信したときに呼び出すリスナーを登録する
 */
export function listenSignalingMessage(callback) {
  signalingListener = callback;
  
  // ========================================================
  // 【ココに受信処理を結合！】サーバーからデータが届いた時のイベント
  // ========================================================
  // (例: Socket.io の受信イベントから webrtc 側に流す場合)
  // socket.on("signaling", (msg) => {
  //   if (signalingListener) signalingListener(msg.from, msg.data);
  // });
  // ========================================================
}
