import { db } from "./firebase.js";
import { ref, set, push, onChildAdded, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

const roomId = "default_room"; 
const participantsRef = ref(db, `rooms/${roomId}/participants`);
const signalingRef = ref(db, `rooms/${roomId}/signaling/${myId}`);
const chatRef = ref(db, `rooms/${roomId}/messages`); 
const pdfRef = ref(db, `rooms/${roomId}/pdfData`); // PDFデータ共有用のノード

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

    // もし自分が最後の1人だった場合、チャット履歴とPDFデータも強制削除
    if (Object.keys(roomParticipants).length <= 1) {
      const chatRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/messages.json`;
      fetch(chatRefUrl, { method: "DELETE", keepalive: true });
      
      const pdfRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/pdfData.json`;
      fetch(pdfRefUrl, { method: "DELETE", keepalive: true });
    }
  };

  window.addEventListener("pagehide", leaveRoomData);
  window.addEventListener("beforeunload", leaveRoomData);
}

export function listenParticipants(callback) {
  onValue(participantsRef, async (snapshot) => {
    const data = snapshot.val();
    if (data) {
      roomParticipants = data;
    } else {
      roomParticipants = {};
      // 参加者が完全に0人になったら、チャットとPDFをクリーンアップ
      await remove(chatRef);
      await remove(pdfRef);
      console.log("部屋が空になったため、データを消去しました。");
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
  onChildAdded(chatRef, (snapshot) => {
    const msg = snapshot.val();
    if (msg) {
      callback(msg.sender, msg.text);
    }
  });
}

/**
 * 【新規】PDFデータをFirebase経由で全員に送信する
 */
export async function sendPdfToFirebase(base64Data, fileName) {
  await set(pdfRef, {
    pdf: base64Data,
    name: fileName,
    senderId: myId,
    timestamp: Date.now()
  });
}

/**
 * 【新規】誰かがPDFをアップロードしたのを検知するリスナー
 */
export function listenPdfData(callback) {
  onValue(pdfRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.pdf) {
      callback(data.pdf, data.name, data.senderId);
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
