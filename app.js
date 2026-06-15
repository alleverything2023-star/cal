import { joinRoom, listenParticipants, myId } from "./room.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

// ※既存のコードで取得しているローカルストリームの変数を指定してください
// 例: let localStream; (すでに getUserMedia で映像が入っているものとします)

// 入室ボタンを押した時の処理の中（既存のロジックに追記してください）
joinButton.addEventListener("click", async () => {
  const name = nameInput.value;
  await joinRoom(name); // 自分の参加登録
  
  // 画面切り替え処理など（既存のもの）
  document.getElementById("joinScreen").style.display = "none";
  document.getElementById("roomScreen").style.display = "block";

  // ─── ここからWebRTCの自動メッシュ接続ロジックを追記 ───
  listenParticipants((participants) => {
    
    // 1. 退室した人を検知して切断 ＆ 画面から削除
    for (const peerId in peerConnections) {
      if (!participants[peerId]) {
        closeP2P(peerId);
        removeVideoCard(peerId);
      }
    }

    // 2. 新しく入室した人（まだ自分と接続していない人）を検知して接続開始
    for (const peerId in participants) {
      // 自分自身ではなく、かつまだ接続が作られていない相手の場合
      if (peerId !== myId && !peerConnections[peerId]) {
        const peerName = participants[peerId].name;
        
        // P2P接続を呼び出す
        startP2P(peerId, localStream, (id, remoteStream) => {
          // 相手の映像ストリームが届いたら、タイル（カード）を生成してグリッドに追加
          addVideoCard(id, peerName, remoteStream);
        });
      }
    }
  });
  // ─── ここまで ───
});

/**
 * 参加者の映像タイル（カード）を動的に生成して videoGrid に追加する
 */
function addVideoCard(id, name, stream) {
  // 既にカードが存在する場合は二重に作らない
  let card = document.getElementById(`card-${id}`);
  if (!card) {
    card = document.createElement("div");
    card.className = "videoCard";
    card.id = `card-${id}`;

    // video要素の生成
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true; // ★iPad/iOSブラウザでインライン再生させるために最重要！
    video.srcObject = stream;

    // 名前要素の生成
    const nameDiv = document.createElement("div");
    nameDiv.className = "videoName";
    nameDiv.textContent = name;

    // カードに組み立ててグリッドに追加
    card.appendChild(video);
    card.appendChild(nameDiv);
    document.getElementById("videoGrid").appendChild(card);
  }
}

/**
 * 参加者が退室した時に映像タイルを削除する
 */
function removeVideoCard(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) {
    card.remove();
  }
}
