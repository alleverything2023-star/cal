import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  set, 
  update,
  onValue, 
  onDisconnect 
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import { db } from "./firebase.js";

export let myId = null;
let myUserRef = null;

export async function joinRoom(name) {
  myId = crypto.randomUUID();
  myUserRef = ref(db, "participants/" + myId);

  await set(myUserRef, {
    name,
    joinedAt: Date.now()
  });

  // 切断時に削除
  onDisconnect(myUserRef).remove();
}

// ★名前を更新するための関数を追加
export async function updateMyName(newName) {
  if (!myUserRef) return;
  await update(myUserRef, { name: newName });
}

export function listenParticipants(callback) {
  onValue(ref(db, "participants"), snapshot => {
    const data = snapshot.val() || {};
    callback(data);
  });
}
