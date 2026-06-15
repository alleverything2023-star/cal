export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

export async function joinRoom(name) {
  roomParticipants[myId] = { name: name };
  console.log(`${name} として部屋に参加しました。ID: ${myId}`);
}

export function listenParticipants(callback) {
  // 1秒ごとに参加者リストを模したコールバックをトリガー（検証用）
  setInterval(() => {
    callback(roomParticipants);
  }, 1000);
}

export async function updateMyName(newName) {
  if (roomParticipants[myId]) {
    roomParticipants[myId].name = newName;
  }
}

// 共通シグナリングデータ送信口（webrtc.jsから呼び出されます）
export function sendSignalingMessage(targetPeerId, payload) {
  console.log(`[シグナリング送信] 宛先: ${targetPeerId}`, payload);
  // TODO: お使いのバックエンド（Socket.io / Firebase等）への送信処理をここに記述
}
