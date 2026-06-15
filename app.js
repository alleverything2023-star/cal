import { joinRoom, listenParticipants, myId } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

let localStream = null;

const joinScreen = document.getElementById("joinScreen");
const roomScreen = document.getElementById("roomScreen");
const myPreviewVideo = document.getElementById("myPreviewVideo");
const previewFallback = document.getElementById("previewFallback");
const cameraSelect = document.getElementById("cameraSelect");
const micSelect = document.getElementById("micSelect");
const initCameraToggle = document.getElementById("initCameraToggle");
const initMicToggle = document.getElementById("initMicToggle");
const nameInput = document.getElementById("nameInput");
const joinButton = document.getElementById("joinButton");
const myLocalVideo = document.getElementById("myLocalVideo");
const myLocalName = document.getElementById("myLocalName");
const participantList = document.getElementById("participantList");
const videoGrid = document.getElementById("videoGrid");

// 1. 【起動時初期化】カメラ・マイクを立ち上げ、その後セレクトボックスを埋める
async function init() {
  try {
    // 許可をもらいつつ初期ストリーム取得
    localStream = await getLocalStream();
    myPreviewVideo.srcObject = localStream;

    // ★iPad対策：カメラが完全に起動するまでわずかに（0.2秒）待つ
    await new Promise(resolve => setTimeout(resolve, 2000));

    // デバイス一覧の選択肢を生成
    await updateDeviceList();
  } catch (error) {
    console.error("初期デバイス取得エラー:", error);
    alert("カメラ・マイクの利用を許可してください。");
  }
}

// 2. カメラやマイクの選択が変更されたときの処理
async function handleDeviceChange() {
  if (!localStream) return;
  // 古いストリームを一度停止
  localStream.getTracks().forEach(track => track.stop());

  try {
    localStream = await getLocalStream(cameraSelect.value, micSelect.value);
    myPreviewVideo.srcObject = localStream;
    
    // 入室前ON/OFFチェックボックスの状態を即座に反映
    toggleTracksByCheckbox();
  } catch (e) {
    console.error("デバイス切り替え失敗:", e);
  }
}

cameraSelect.addEventListener("change", handleDeviceChange);
micSelect.addEventListener("change", handleDeviceChange);

// 3. 入室前チェックボックスのON/OFFで映像・音声を制御する関数
function toggleTracksByCheckbox() {
  if (!localStream) return;
  
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];

  if (videoTrack) {
    videoTrack.enabled = initCameraToggle.checked;
    myPreviewVideo.style.display = initCameraToggle.checked ? "block" : "none";
    previewFallback.style.display = initCameraToggle.checked ? "none" : "block";
  }
  if (audioTrack) {
    audioTrack.enabled = initMicToggle.checked;
  }
}

initCameraToggle.addEventListener("change", toggleTracksByCheckbox);
initMicToggle.addEventListener("change", toggleTracksByCheckbox);

// 4. 【入室ボタンクリック時】
joinButton.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("名前を入力してください。");

  // 入室直前のON/OFF状態を最終適用
  toggleTracksByCheckbox();

  // Firebaseへ参加登録
  await joinRoom(name);

  // 画面の切り替え
  joinScreen.style.display = "none";
  roomScreen.style.display = "block";

  // 通話中画面の自分枠にストリームと名前をセット
  myLocalVideo.srcObject = localStream;
  myLocalName.textContent = `${name} (あなた)`;

  // Firebaseの参加者監視（メッシュ接続開始）
  listenParticipants((participants) => {
    // リストの更新
    participantList.innerHTML = "";
    
    // 退室した人を検知してP2P切断 ＆ カード削除
    for (const peerId in peerConnections) {
      if (!participants[peerId]) {
        closeP2P(peerId);
        removeVideoCard(peerId);
      }
    }

    // 参加者一覧の処理
    for (const peerId in participants) {
      const peerName = participants[peerId].name;
      
      // サイドバーのテキストリスト更新
      const li = document.createElement("li");
      li.textContent = peerName + (peerId === myId ? " (あなた)" : "");
      participantList.appendChild(li);

      // 自分以外の新規参加者に対してP2P接続を開始
      if (peerId !== myId && !peerConnections[peerId]) {
        startP2P(peerId, localStream, (id, remoteStream) => {
          // 相手の映像が届いたらタイルを追加
          addVideoCard(id, peerName, remoteStream);
        });
      }
    }
  });
});

// 5. 【便利関数】ビデオカードの動的生成と削除
function addVideoCard(id, name, stream) {
  if (document.getElementById(`card-${id}`)) return;

  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${id}`;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true; // iPad対策
  video.srcObject = stream;

  const nameDiv = document.createElement("div");
  nameDiv.className = "videoName";
  nameDiv.textContent = name;

  card.appendChild(video);
  card.appendChild(nameDiv);
  videoGrid.appendChild(card);
}

function removeVideoCard(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();
}

// 起動
init();
