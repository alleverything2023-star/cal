import { db } from "./firebase.js";
import { ref, set, push, onChildAdded, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

const roomId = "default_room"; 
const participantsRef = ref(db, `rooms/${roomId}/participants`);
const signalingRef = ref(db, `rooms/${roomId}/signaling/${myId}`);
const chatRef = ref(db, `rooms/${roomId}/messages`); 

let signalingListener = null;

export async function joinRoom(name) {
  roomParticipants[myId] = { name: name };
  
  // 入室前に、自分宛ての古いシグナリングの箱が万が一残っていたら完全に消去する
  await remove(signalingRef);

  // Firebaseに自分の参加情報を書き込む
  const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
  await set(myParticipantRef, { name: name });
  console.log(`${name} としてFirebaseの部屋に参加しました。ID: ${myId}`);

  // 【接続切れ対策】自分が通信切れになったら参加者リストから自分を消す
  onDisconnect(myParticipantRef).remove();

  // 【iPad/Safari対策】タブを閉じる・リロードする瞬間に即座に自分を削除
  const leaveRoomData = () => {
    const pRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/participants/${myId}.json`;
    fetch(pRefUrl, { method: "DELETE", keepalive: true });

    // もし自分が最後の1人だった場合、チャット履歴もFetchで強制削除命令を出す（Safari用保険）
    if (Object.keys(roomParticipants).length <= 1) {
      const chatRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/messages.json`;
      fetch(chatRefUrl, { method: "DELETE", keepalive: true });
    }
  };

  window.addEventListener("pagehide", leaveRoomData);
  window.addEventListener("beforeunload", leaveRoomData);
}

export function listenParticipants(callback) {
  // 参加者リストの変更をリアルタイムに監視
  onValue(participantsRef, async (snapshot) => {
    const data = snapshot.val();
    if (data) {
      roomParticipants = data;
    } else {
      roomParticipants = {};
      // 参加者が完全に0人になったら、チャット履歴を自動で綺麗に削除する
      await remove(chatRef);
      console.log("部屋が空になったため、チャット履歴を消去しました。");
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
 * チャットメッセージをFirebaseに送信する関数
 */
export function sendChatMessageToFirebase(sender, text) {
  const newMessageRef = push(chatRef);
  set(newMessageRef, {
    sender: sender,
    text: text,
    timestamp: Date.now()
  });
}

/**
 * リアルタイムにチャットメッセージを受信するリスナー
 */
export function listenChatMessages(callback) {
  // 新しいメッセージが追加された瞬間をキャッチ
  onChildAdded(chatRef, (snapshot) => {
    const msg = snapshot.val();
    if (msg) {
      callback(msg.sender, msg.text);
    }
  });
}

/**
 * webrtc.js から呼び出されるシグナリング送信関数
 */
export function sendSignalingMessage(targetPeerId, payload) {
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
  onChildAdded(signalingRef, (snapshot) => {
    const msg = snapshot.val();
    if (msg && msg.from !== myId) {
      if (signalingListener) {
        signalingListener(msg.from, msg.data);
      }
      remove(snapshot.ref); 
    }
  });
}
