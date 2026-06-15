import { ref, set, push, child, onValue, onChildAdded, off } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import { db } from "./firebase.js";
import { myId } from "./room.js";

// STUNサーバーの設定（Googleの無料サーバーを利用）
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

// 接続中のPeerConnectionを管理するオブジェクト（外部からも参照可能に）
export const peerConnections = {};
// Firebaseのリスナーを解除するために保管する配列
const signalListeners = {};

/**
 * 特定の参加者とのP2P接続を開始する
 * @param {string} peerId 接続相手のUID
 * @param {MediaStream} localStream 自分のカメラ・マイクストリーム
 * @param {Function} onRemoteStream 相手の映像が届いた時のコールバック
 */
export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return; // 既に接続中なら何もしない

  const pc = new RTCPeerConnection(configuration);
  peerConnections[peerId] = pc;
  signalListeners[peerId] = [];

  let remoteDescSet = false;
  const iceQueue = [];

  // キューに溜まったICE Candidateを処理する関数
  const processIceQueue = () => {
    remoteDescSet = true;
    while (iceQueue.length > 0) {
      const candidate = iceQueue.shift();
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("ICE追加失敗:", e));
    }
  };

  // 1. 自分の映像・音声トラックを接続に追加
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // 2. 相手の映像・音声トラックを受信したときの処理
  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onRemoteStream(peerId, event.streams[0]);
    }
  };

  // 3. IDの大小比較で、このペア専用のシグナリング部屋名を一意に決定
  const isInitiator = myId < peerId;
  const roomKey = isInitiator ? `${myId}_${peerId}` : `${peerId}_${myId}`;
  const signalPath = ref(db, `signals/${roomKey}`);

  // 4. 経路情報（ICE Candidate）が生成されたらFirebaseに送信
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const candidateType = isInitiator ? "candidatesA" : "candidatesB";
      push(child(signalPath, candidateType), event.candidate.toJSON());
    }
  };

  // 5. ロール（オファー側かアンサー側か）に応じた処理
  if (isInitiator) {
    // 【オファー側：自分の方がIDが小さい】
    // オファー（発信書）を作ってFirebaseに書き込む
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        set(child(signalPath, "offer"), pc.localDescription.toJSON());
      })
      .catch(e => console.error("Offer作成失敗:", e));

    // 相手からのアンサー（応答書）を監視
    const answerRef = child(signalPath, "answer");
    onValue(answerRef, (snapshot) => {
      const answer = snapshot.val();
      if (answer && pc.signalingState === "have-local-offer") {
        pc.setRemoteDescription(new RTCSessionDescription(answer))
          .then(() => processIceQueue())
          .catch(e => console.error("RemoteDescription設定失敗(オファー側):", e));
      }
    });
    signalListeners[peerId].push(answerRef);

    // 相手の経路情報（candidatesB）を監視
    const candBRef = child(signalPath, "candidatesB");
    onChildAdded(candBRef, (snapshot) => {
      const candidate = snapshot.val();
      if (candidate) {
        if (remoteDescSet) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        } else {
          iceQueue.push(candidate);
        }
      }
    });
    signalListeners[peerId].push(candBRef);

  } else {
    // 【アンサー側：自分の方がIDが大きい】
    // 相手からのオファー（発信書）を監視
    const offerRef = child(signalPath, "offer");
    onValue(offerRef, (snapshot) => {
      const offer = snapshot.val();
      if (offer && pc.signalingState === "stable") {
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => {
            processIceQueue();
            return pc.createAnswer();
          })
          .then(answer => pc.setLocalDescription(answer))
          .then(() => {
            set(child(signalPath, "answer"), pc.localDescription.toJSON());
          })
          .catch(e => console.error("Answer作成失敗:", e));
      }
    });
    signalListeners[peerId].push(offerRef);

    // 相手の経路情報（candidatesA）を監視
    const candARef = child(signalPath, "candidatesA");
    onChildAdded(candARef, (snapshot) => {
      const candidate = snapshot.val();
      if (candidate) {
        if (remoteDescSet) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        } else {
          iceQueue.push(candidate);
        }
      }
    });
    signalListeners[peerId].push(candARef);
  }
}

/**
 * 特定の参加者とのP2P接続を終了し、リスナーを解除する
 * @param {string} peerId 
 */
export function closeP2P(peerId) {
  // Firebaseのリアルタイムリスナーを解除
  if (signalListeners[peerId]) {
    signalListeners[peerId].forEach(reference => off(reference));
    delete signalListeners[peerId];
  }

  // PeerConnectionをクローズ
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
}
