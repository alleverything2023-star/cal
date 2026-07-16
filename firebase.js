import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getDatabase, ref, ServerValue } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC8xaZlj3hnMNYeppvbtxZFLqw4q-9ca9g",
  authDomain: "call-a9823.firebaseapp.com",
  projectId: "call-a9823",
  storageBucket: "call-a9823.firebasestorage.app",
  messagingSenderId: "656862118456",
  appId: "1:656862118456:web:46dc8bfbdaf355ef9b9ccd",
  measurementId: "G-DRZKNJF6NY",
  databaseURL: "https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app"
};

export let app;
export let db;
export let connectedRef;

// ④ serverTimestamp用の参照 (ServerValue.TIMESTAMP) をいつでも使えるようエクスポート
export const serverTimestamp = ServerValue.TIMESTAMP;

try {
  // ② initializeApp重複防止処理
  if (getApps().length === 0) {
    // ① appをexportする
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }

  // ① dbを定義してexportする
  db = getDatabase(app);

  // ③ オンライン判定・再接続判定に利用する接続状態取得用の参照を定義
  connectedRef = ref(db, ".info/connected");

  // ⑥ 将来用コメント: 今後AuthenticationやStorageを利用する場合はここで初期化する

} catch (error) {
  // ⑤ 初期化失敗時のエラーログ
  console.error("Firebase initialization failed", error);
}
