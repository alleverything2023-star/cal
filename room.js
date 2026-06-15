import { db } from "./firebase.js";
import { ref, set, push, onChildAdded, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

const roomId = "default_room"; 
const participantsRef = ref(db, `rooms/${roomId}/participants`);
const signalingRef = ref(db, `rooms/${roomId}/signaling/${myId}`);

let signalingListener = null;

export async function joinRoom(name) {
  roomParticipants[myId] = { name: name };
  
  // 1. 【安全策】入室前に、自分宛ての古いシグナリングの箱が万が一残っていたら完全に消去する
  await remove(signalingRef);

  // 2. Firebaseに自分の参加情報を書き込む
  const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
  await set(myParticipantRef, { name: name });
  console.log(`${name} としてFirebaseの部屋に参加しました。ID: ${myId}`);

  // 3. 【自動削除】ブラウザを閉じた時や、回線が切れて退室した時に自動で自分を消す設定
  onDisconnect(myParticipantRef).remove();
}

export function listenParticipants(callback) {
  // 参加者リストの変更をリアルタイムに監視
  onValue(participantsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      roomParticipants = data;
    } else {
      roomParticipants = {};
    }
    callback(roomParticipants);
  });
}

export async function updateMyName(newName) {
  if (roomParticipants[myId]) {
    const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
    await set(myParticipantRef, { name: newName });
  }
}

/**
 * webrtc.js から呼び出されるシグナリング送信関数
 */
export function sendSignalingMessage(targetPeerId, payload) {
  console.log(`[Firebase送信] 宛先: ${targetPeerId}`, payload);
  
  const targetSignalingRef = ref(db, `rooms/${roomId}/signaling/${targetPeerId}`);
  const newMessageRef = push(targetSignalingRef);
  set(newMessageRef, {
    from: myId,
    data: payload
  });
}

/**
 * サーバー（Firebase）から自分宛てのシグナリングデータが届いたときに呼び出すリスナー
 */
export function listenSignalingMessage(callback) {
  signalingListener = callback;
  
  // 自分宛てのシグナリング用ノードにデータが追加された瞬間をキャッチ
  onChildAdded(signalingRef, (snapshot) => {
    const msg = snapshot.val();
    if (msg && msg.from !== myId) {
      console.log(`[Firebase受信] 送信元: ${msg.from}`);
      if (signalingListener) {
        signalingListener(msg.from, msg.data);
      }
      // 処理したシグナリングメッセージは、データベースが肥大化しないように即座に削除
      remove(snapshot.ref);
    }
  });
}
