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

const myCamBtn = document.getElementById("myCamBtn");
const myMicBtn = document.getElementById("myMicBtn");

// 1. 【起動時初期化】
async function init() {
  try {
    localStream = await getLocalStream();
    myPreviewVideo.srcObject = localStream;

    // iPad対策：認識完了まで少し待つ
    await new Promise(resolve => setTimeout(resolve, 200));
    await updateDeviceList();
  } catch (error) {
    console.error("初期デバイス取得エラー:", error);
    alert("カメラ・マイクの利用を許可してください。");
  }
}

// 2. デバイス変更処理
async function handleDeviceChange() {
  if (!localStream) return;
  localStream.getTracks().forEach(track => track.stop());

  try {
    localStream = await getLocalStream(cameraSelect.value, micSelect.value);
    myPreviewVideo.srcObject = localStream;
    toggleTracksByCheckbox();
  } catch (e) {
    console.error("デバイス切り替え失敗:", e);
  }
}

cameraSelect.addEventListener("change", handleDeviceChange);
micSelect.addEventListener("change", handleDeviceChange);

// 3. 入室前チェックボックスのON/OFF制御
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

// 4. 通話中のカメラ・マイクボタン制御（自分用・色の反転ロジック）
myCamBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    // 有効（ON）のときに「on」クラスをつける（緑化）
    myCamBtn.classList.toggle("on", videoTrack.enabled);
  }
});

myMicBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    myMicBtn.classList.toggle("on", audioTrack.enabled);
  }
});

// 5. 【入室ボタンクリック時】
joinButton.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("名前を入力してください。");

  toggleTracksByCheckbox();

  // 入室前の設定に合わせて、ボタンの「on」クラスの初期状態を決定
  myCamBtn.classList.toggle("on", initCameraToggle.checked);
  myMicBtn.classList.toggle("on", initMicToggle.checked);

  await joinRoom(name);

  joinScreen.style.display = "none";
  roomScreen.style.display = "flex";

  myLocalVideo.srcObject = localStream;
  myLocalName.textContent = `${name} (あなた)`;

  listenParticipants((participants) => {
    participantList.innerHTML = "";
    
    for (const peerId in peerConnections) {
      if (!participants[peerId]) {
        closeP2P(peerId);
        removeVideoCard(peerId);
      }
    }

    for (const peerId in participants) {
      const peerName = participants[peerId].name;
      
      const li = document.createElement("li");
      li.textContent = peerName + (peerId === myId ? " (あなた)" : "");
      participantList.appendChild(li);

      if (peerId !== myId && !peerConnections[peerId]) {
        startP2P(peerId, localStream, (id, remoteStream) => {
          addVideoCard(id, peerName, remoteStream);
        });
      }
    }
  });
});

// 6. ビデオカードの動的生成（他人のカードにはボタンを作らず名前だけに修正）
function addVideoCard(id, name, stream) {
  if (document.getElementById(`card-${id}`)) return;

  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${id}`;

  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  wrapper.appendChild(video);

  const controlBar = document.createElement("div");
  controlBar.className = "videoControlBar";

  const nameDiv = document.createElement("div");
  nameDiv.className = "videoName";
  nameDiv.textContent = name;

  // 他人のカードにはボタンを追加しない（nameDivのみ入れる）
  controlBar.appendChild(nameDiv);
  
  card.appendChild(wrapper);
  card.appendChild(controlBar);
  videoGrid.appendChild(card);
}

function removeVideoCard(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();
}

init();
