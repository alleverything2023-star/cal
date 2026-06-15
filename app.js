import { joinRoom, listenParticipants, myId } from "./room.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";
// ※もし devices.js などからインポートしている関数があればここに書く

// 1. 自分のカメラ映像を保存しておくグローバル変数
let localStream = null;

// 2. 【入室前】ページを開いた瞬間にカメラを起動してプレビューする処理
async function init() {
  try {
    // カメラとマイクのストリームを取得
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // 自分のプレビュー用video要素に映像をセット
    // ※HTMLにある自分の映像用videoのIDに合わせてください（例: myVideo）
    const myVideo = document.getElementById("myVideo"); 
    if (myVideo) {
      myVideo.srcObject = localStream;
      myVideo.playsInline = true;
      myVideo.autoplay = true;
    }

    // ここでカメラ・マイクの一覧をセレクトボックスに詰める処理（devices.jsの機能など）を呼ぶ

  } catch (error) {
    alert("カメラまたはマイクの起動に失敗しました: " + error.message);
  }
}

// ページ読み込み時に初期化処理を実行
init();


// 3. 【入室時】入室ボタンを押したときの処理
joinButton.addEventListener("click", async () => {
  const name = nameInput.value;
  if (!name) return alert("名前を入力してください");

  await joinRoom(name); // Firebaseに参加者登録
  
  // 画面の切り替え
  document.getElementById("joinScreen").style.display = "none";
  document.getElementById("roomScreen").style.display = "block";

  // 【前回追加したWebRTCの同期処理】
  listenParticipants((participants) => {
    // 退室した人を検知して切断
    for (const peerId in peerConnections) {
      if (!participants[peerId]) {
        closeP2P(peerId);
        removeVideoCard(peerId);
      }
    }

    // 新しく入室した人と接続（ここで上の localStream を渡す）
    for (const peerId in participants) {
      if (peerId !== myId && !peerConnections[peerId]) {
        const peerName = participants[peerId].name;
        
        // localStream が空っぽじゃないことを確認して渡す
        startP2P(peerId, localStream, (id, remoteStream) => {
          addVideoCard(id, peerName, remoteStream);
        });
      }
    }
  });
});

// ─── 以下、addVideoCard や removeVideoCard の関数 ───
