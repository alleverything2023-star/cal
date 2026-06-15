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
  
  // 入室前に、自分宛ての古いシグナリングの箱が万が一残っていたら完全に消去する
  await remove(signalingRef);

  // Firebaseに自分の参加情報を書き込む
  const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
  await set(myParticipantRef, { name: name });
  console.log(`${name} としてFirebaseの部屋に参加しました。ID: ${myId}`);

  // 【接続切れ・アプリ強制終了対策】
  // 万が一、下のページを閉じるイベントが間に合わなかった場合でも、
  // 数分以内にFirebase側が通信切れを検知して自動削除します
  onDisconnect(myParticipantRef).remove();

  // 【iPad/Safari対策】タブを閉じる・リロードする瞬間に強制的に削除を実行する
  const leaveRoomData = () => {
    // データベースのURLを取得して、標準のfetchAPIで直接削除命令を送りつける（Safariでも高確率で間に合う設定）
    const targetUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/participants/${myId}.json`;
    
    // keepalive: true をつけることで、ブラウザが閉じられても裏側で送信を完了させてくれます
    fetch(targetUrl, {
      method: "DELETE",
      keepalive: true
    });
  };

  // Safari用：ページが隠れたり閉じたりするイベントに紐付け
  window.addEventListener("pagehide", leaveRoomData);
  window.addEventListener("beforeunload", leaveRoomData);
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
      // 処理したシグナリングメッセージは即座に削除
      remove(snapshot.ref);
    }
  });
}
