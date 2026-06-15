import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  set, 
  remove, 
  onValue, 
  onDisconnect 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Firebaseの設定（ご自身のプロジェクト情報に書き換えてください）
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export let myId = null;
let roomRef = null;
let myUserRef = null;

// ランダムなIDを生成するヘルパー
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 11);
}

// ルームに参加する処理
export async function joinRoom(name) {
  myId = generateUniqueId();
  // 固定の部屋名「main-room」内の「users」配下に自分を登録
  roomRef = ref(db, "rooms/main-room/users");
  myUserRef = ref(db, `rooms/main-room/users/${myId}`);

  // 1. データベースに自分の名前を書き込み
  await set(myUserRef, { name: name });

  // 2. ★【重要】通信が切れたり、タブが閉じられたら自動でDBから自分を消す設定
  onDisconnect(myUserRef).remove();

  // 3. ★【重要】ブラウザの「戻る」や「タブを閉じる」ボタンが押された瞬間に即時削除を実行
  window.addEventListener("beforeunload", () => {
    remove(myUserRef);
  });
}

// 参加者一覧の変更を監視する処理
export function listenParticipants(callback) {
  if (!roomRef) return;

  onValue(roomRef, (snapshot) => {
    const data = snapshot.val() || {};
    callback(data);
  });
}
