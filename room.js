import { db } from "./firebase.js";
import { ref, set, push, onChildAdded, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

const roomId = "default_room"; 
const participantsRef = ref(db, `rooms/${roomId}/participants`);
const signalingRef = ref(db, `rooms/${roomId}/signaling/${myId}`);
const chatRef = ref(db, `rooms/${roomId}/messages`); 
const pdfRef = ref(db, `rooms/${roomId}/pdfData`); 

let signalingListener = null;

export async function joinRoom(name) {
  roomParticipants[myId] = { name: name };
  
  await remove(signalingRef);

  const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
  await set(myParticipantRef, { name: name });
  console.log(`${name} としてFirebaseの部屋に参加しました。ID: ${myId}`);

  onDisconnect(myParticipantRef).remove();

  const leaveRoomData = () => {
    const pRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/participants/${myId}.json`;
    fetch(pRefUrl, { method: "DELETE", keepalive: true });

    if (Object.keys(roomParticipants).length <= 1) {
      fetch(`https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/messages.json`, { method: "DELETE", keepalive: true });
      fetch(`https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/pdfData.json`, { method: "DELETE", keepalive: true });
      fetch(`https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/drawings/${roomId}.json`, { method: "DELETE", keepalive: true });
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
      await remove(chatRef);
      await remove(pdfRef);
      await remove(ref(db, `drawings/${roomId}`));
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

export function sendChatMessageToFirebase(sender, text) {
  const newMessageRef = push(chatRef);
  set(newMessageRef, {
    sender: sender,
    text: text,
    timestamp: Date.now()
  });
}

export function sendImageMessageToFirebase(sender, imageData) {
  const newMessageRef = push(chatRef);
  set(newMessageRef, {
    sender: sender,
    image: imageData,
    timestamp: Date.now()
  });
}

export function listenChatMessages(callback) {
  onChildAdded(chatRef, (snapshot) => {
    const msg = snapshot.val();
    if (msg) {
      callback(msg);
    }
  });
}

export async function sendPdfToFirebase(sharedUrl, fileName) {
  await set(pdfRef, {
    pdf: sharedUrl,
    name: fileName,
    senderId: myId,
    page: 1, // 初期ページ初期化追加
    timestamp: Date.now()
  });
}

export function updatePdfPageInFirebase(page) {
  set(ref(db, `rooms/${roomId}/pdfData/page`), page);
}

export function listenPdfData(callback) {
  onValue(pdfRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.pdf) {
      callback(data);
    }
  });
}

/**
 * ⑥ 手書きのストロークをFirebaseに送信・保存する
 */
export function saveStrokeToFirebase(page, stroke) {
  push(ref(db, `drawings/${roomId}/${page}`), stroke);
}

/**
 * ⑦ 特定ページのFirebase手書きストロークをクリアする
 */
export function clearStrokesInFirebase(page) {
  remove(ref(db, `drawings/${roomId}/${page}`));
}

/**
 * ⑦ Firebaseの手書きイベントをリアルタイムにリッスンする
 */
export function listenStrokes(page, onAdded, onCleared) {
  const pageDrawRef = ref(db, `drawings/${roomId}/${page}`);
  
  onChildAdded(pageDrawRef, (snapshot) => {
    onAdded(snapshot.val());
  });

  onValue(pageDrawRef, (snapshot) => {
    if (!snapshot.exists()) {
      onCleared();
    }
  });
}

export function sendSignalingMessage(targetPeerId, payload) {
  const targetSignalingRef = ref(db, `rooms/${roomId}/signaling/${targetPeerId}`);
  const newMessageRef = push(targetSignalingRef);
  set(newMessageRef, {
    from: myId,
    data: payload
  });
}

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
