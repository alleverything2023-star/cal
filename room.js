import { db } from "./firebase.js";
import { ref, set, update, push, onChildAdded, onValue, remove, onDisconnect, off } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export let myId = "user_" + Math.random().toString(36).substring(2, 9);
export let roomParticipants = {};

const roomId = "default_room"; 
const participantsRef = ref(db, `rooms/${roomId}/participants`);
const signalingRef = ref(db, `rooms/${roomId}/signaling/${myId}`);
const chatRef = ref(db, `rooms/${roomId}/messages`); 
const pdfRef = ref(db, `rooms/${roomId}/pdfData`); 
const timersRef = ref(db, `rooms/${roomId}/timers`);

let signalingListener = null;

// ① 退出検知用の前回状態記録オブジェクト
let previousParticipants = {};

// ⑥ チャット・画像の重複処理防止用Set
const processedMessageIds = new Set();

// ⑧ PDF変更検知用の前回状態記録変数
let previousPdfDataStr = null;

/**
 * エラーログの共通処理
 */
function logError(actionName, err) {
  console.error(`[Firebase Error - ${actionName}]`, {
    roomId: roomId,
    myId: myId,
    error: err?.message || err
  });
}

export async function joinRoom(name, camOn = true, micOn = true) {
  try {
    roomParticipants[myId] = { name: name };
    
    await remove(signalingRef);

    const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
    // ⑤ 参加者データに joinedAt タイムスタンプを追加
    await set(myParticipantRef, { 
      name: name,
      joinedAt: Date.now(),
      camOn: camOn,
      micOn: micOn
    });
    console.log(`${name} としてFirebaseの部屋に参加しました。ID: ${myId}`);

    onDisconnect(myParticipantRef).remove();
    // ③ シグナリング情報のオンディスクネクト削除登録
    onDisconnect(signalingRef).remove();

    const leaveRoomData = () => {
      const pRefUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/participants/${myId}.json`;
      const messagesUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/messages.json`;
      const pdfUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/pdfData.json`;
      const drawingsUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/drawings/${roomId}.json`;
      const timersUrl = `https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app/rooms/${roomId}/timers.json`;

      // sendBeaconは常にPOSTでしか送信できず、FirebaseのREST APIではPOSTは
      // 「新しい子要素の追加」を意味してしまうため削除には使えない。
      // 削除にはDELETEメソッドを明示できるfetch(+keepalive)を使う。
      try {
        fetch(pRefUrl, { method: "DELETE", keepalive: true });
        if (Object.keys(roomParticipants).length <= 1) {
          fetch(messagesUrl, { method: "DELETE", keepalive: true });
          fetch(pdfUrl, { method: "DELETE", keepalive: true });
          fetch(drawingsUrl, { method: "DELETE", keepalive: true });
          fetch(timersUrl, { method: "DELETE", keepalive: true });
        }
      } catch (err) {
        logError("leaveRoomData", err);
      }
    };

    window.addEventListener("pagehide", leaveRoomData);
    window.addEventListener("beforeunload", leaveRoomData);
  } catch (err) {
    logError("joinRoom", err);
  }
}

// ① app.jsの仕様 (peerId, info) コールバックへの変換処理
export function listenParticipants(callback) {
  onValue(participantsRef, async (snapshot) => {
    try {
      const data = snapshot.val() || {};
      
      // ⑪ 中身の参照を維持しながら更新
      for (const key in roomParticipants) {
        delete roomParticipants[key];
      }
      Object.assign(roomParticipants, data);

      if (!snapshot.exists()) {
        await remove(chatRef);
        await remove(pdfRef);
        await remove(ref(db, `drawings/${roomId}`));
        await remove(timersRef);
        console.log("部屋が空になったため、データを消去しました。");
      }

      // 新規参加者のチェック (前回いなくて、今回いるメンバー)
      for (const peerId in data) {
        if (!previousParticipants[peerId]) {
          callback(peerId, data[peerId]);
        } else if (JSON.stringify(previousParticipants[peerId]) !== JSON.stringify(data[peerId])) {
          // 既存参加者の情報更新（マイク/カメラのON-OFFなど）
          callback(peerId, data[peerId]);
        }
      }

      // 退室者のチェック (前回いて、今回いないメンバー)
      for (const peerId in previousParticipants) {
        if (!data[peerId]) {
          callback(peerId, null);
        }
      }

      // 差分確認用に状態を退避
      previousParticipants = JSON.parse(JSON.stringify(data));

    } catch (err) {
      logError("listenParticipants", err);
    }
  });
}

export async function updateMyName(newName) {
  if (roomParticipants[myId]) {
    try {
      const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
      // set()だとcamOn/micOnなど他のフィールドが消えてしまうため、update()で該当フィールドのみ変更する
      await update(myParticipantRef, { name: newName });
    } catch (err) {
      logError("updateMyName", err);
    }
  }
}

// マイク/カメラのON-OFF状態を他の参加者に共有する
export async function updateMyMediaState(partialState) {
  try {
    const myParticipantRef = ref(db, `rooms/${roomId}/participants/${myId}`);
    await update(myParticipantRef, partialState);
  } catch (err) {
    logError("updateMyMediaState", err);
  }
}

export function sendChatMessageToFirebase(sender, text) {
  try {
    const newMessageRef = push(chatRef);
    set(newMessageRef, {
      sender: sender,
      text: text,
      timestamp: Date.now()
    });
  } catch (err) {
    logError("sendChatMessageToFirebase", err);
  }
}

export function sendImageMessageToFirebase(sender, imageData) {
  try {
    const newMessageRef = push(chatRef);
    set(newMessageRef, {
      sender: sender,
      image: imageData,
      timestamp: Date.now()
    });
  } catch (err) {
    logError("sendImageMessageToFirebase", err);
  }
}

// ⑥ & ⑦ 重複防止とイメージ・テキストの両データ加工なしcallback
export function listenChatMessages(callback) {
  onChildAdded(chatRef, (snapshot) => {
    try {
      const msgId = snapshot.key;
      if (processedMessageIds.has(msgId)) return;
      processedMessageIds.add(msgId);

      const msg = snapshot.val();
      if (msg) {
        callback(msg);
      }
    } catch (err) {
      logError("listenChatMessages", err);
    }
  });
}

export async function sendPdfToFirebase(sharedUrl, fileName) {
  try {
    await set(pdfRef, {
      pdf: sharedUrl,
      name: fileName,
      senderId: myId,
      page: 1, // 初期ページ初期化追加
      timestamp: Date.now()
    });
  } catch (err) {
    logError("sendPdfToFirebase", err);
  }
}

export function updatePdfPageInFirebase(page) {
  try {
    set(ref(db, `rooms/${roomId}/pdfData/page`), page);
  } catch (err) {
    logError("updatePdfPageInFirebase", err);
  }
}

// ⑧ 変更があった場合だけ callback
export function listenPdfData(callback) {
  onValue(pdfRef, (snapshot) => {
    try {
      const data = snapshot.val();
      if (data && data.pdf) {
        const currentDataStr = JSON.stringify(data);
        if (currentDataStr !== previousPdfDataStr) {
          previousPdfDataStr = currentDataStr;
          callback(data);
        }
      }
    } catch (err) {
      logError("listenPdfData", err);
    }
  });
}

/**
 * 共用ポモドーロタイマーの状態をFirebaseへ送信する
 */
export function sendTimerState(slotIndex, state) {
  try {
    set(ref(db, `rooms/${roomId}/timers/${slotIndex}`), state);
  } catch (err) {
    logError("sendTimerState", err);
  }
}

/**
 * 共用ポモドーロタイマーの状態変化をリッスンする
 */
export function listenTimerState(slotIndex, callback) {
  onValue(ref(db, `rooms/${roomId}/timers/${slotIndex}`), (snapshot) => {
    try {
      const data = snapshot.val();
      if (data) callback(data);
    } catch (err) {
      logError("listenTimerState", err);
    }
  });
}

/**
 * 手書きのストロークをFirebaseに送信・保存する
 */
export function saveStrokeToFirebase(page, stroke) {
  try {
    push(ref(db, `drawings/${roomId}/${page}`), stroke);
  } catch (err) {
    logError("saveStrokeToFirebase", err);
  }
}

/**
 * 特定ページのFirebase手書きストロークをクリアする
 */
export function clearStrokesInFirebase(page) {
  try {
    remove(ref(db, `drawings/${roomId}/${page}`));
  } catch (err) {
    logError("clearStrokesInFirebase", err);
  }
}

/**
 * Firebaseの手書きイベントをリアルタイムにリッスンする
 * ⑫ リスナー解除関数を返却するように修正
 */
export function listenStrokes(page, onAdded, onCleared) {
  const pageDrawRef = ref(db, `drawings/${roomId}/${page}`);
  
  const handleChildAdded = (snapshot) => {
    onAdded(snapshot.val());
  };

  const handleValue = (snapshot) => {
    if (!snapshot.exists()) {
      onCleared();
    }
  };

  onChildAdded(pageDrawRef, handleChildAdded);
  onValue(pageDrawRef, handleValue);

  // リスナーを正しくクリーンアップするための関数を返す
  return () => {
    try {
      off(pageDrawRef, "child_added", handleChildAdded);
      off(pageDrawRef, "value", handleValue);
    } catch (err) {
      logError("listenStrokes_off", err);
    }
  };
}

// ⑨ timestampを追加
export function sendSignalingMessage(targetPeerId, payload) {
  try {
    const targetSignalingRef = ref(db, `rooms/${roomId}/signaling/${targetPeerId}`);
    const newMessageRef = push(targetSignalingRef);
    set(newMessageRef, {
      from: myId,
      data: {
        ...payload,
        timestamp: Date.now() // シグナリングに送信時刻を付与
      }
    });
  } catch (err) {
    logError("sendSignalingMessage", err);
  }
}

// ②, ⑩, ⑯ 非同期コールバック完了後の削除および古いメッセージのフィルタリング
export function listenSignalingMessage(callback) {
  signalingListener = callback;
  onChildAdded(signalingRef, async (snapshot) => {
    try {
      const msg = snapshot.val();
      if (msg && msg.from !== myId) {
        const payload = msg.data || {};
        const timestamp = payload.timestamp || Date.now();
        const ageInSeconds = (Date.now() - timestamp) / 1000;

        // ⑩ 60秒以上古いメッセージはコールバックせずに破棄
        if (ageInSeconds >= 60) {
          await remove(snapshot.ref);
          return;
        }

        if (signalingListener) {
          // ⑯ コールバックがPromiseを返却した際、await完了を待機してからFirebaseよりノードを削除
          await signalingListener(msg.from, msg.data);
        }
        // ② 処理が成功して完了した（callbackが終了した）タイミングで安全に削除
        await remove(snapshot.ref);
      }
    } catch (err) {
      logError("listenSignalingMessage", err);
    }
  });
}
