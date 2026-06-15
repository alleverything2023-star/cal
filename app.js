import { joinRoom, listenParticipants, myId, updateMyName } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

let localStream = null;
let isJoined = false;

// 要素の取得
const joinScreen = document.getElementById("joinScreen");
const roomScreen = document.getElementById("roomScreen");
const myPreviewVideo = document.getElementById("myPreviewVideo");
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
const appLayout = document.getElementById("appLayout");
const layoutToggleBtn = document.getElementById("layoutToggleBtn");

// 設定モーダル関連
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const newNameInput = document.getElementById("newNameInput");
const updateNameBtn = document.getElementById("updateNameBtn");

// 1. 初期化
async function init() {
  try {
    localStream = await getLocalStream();
    myPreviewVideo.srcObject = localStream;
    await new Promise(r => setTimeout(r, 200));
    await updateDeviceList();
  } catch (e) { alert("カメラ許可が必要です"); }
}

// 2. デバイス変更時のリアルタイム切り替え処理（イン・アウトカメラ切り替え対応）
async function handleDeviceChange() {
  if (!localStream) return;

  // 古いトラックを完全に停止してリセット
  localStream.getTracks().forEach(track => {
    track.stop();
    localStream.removeTrack(track);
  });

  try {
    const newStream = await getLocalStream(cameraSelect.value, micSelect.value);
    localStream = newStream;

    const newVideoTrack = localStream.getVideoTracks()[0];
    const newAudioTrack = localStream.getAudioTracks()[0];

    if (!isJoined) {
      // 入室前
      myPreviewVideo.srcObject = localStream;
      if (newVideoTrack) newVideoTrack.enabled = initCameraToggle.checked;
      if (newAudioTrack) newAudioTrack.enabled = initMicToggle.checked;
    } else {
      // 入室後
      myLocalVideo.srcObject = localStream;

      if (newVideoTrack) newVideoTrack.enabled = myCamBtn.classList.contains("on");
      if (newAudioTrack) newAudioTrack.enabled = myMicBtn.classList.contains("on");

      // ピア接続（相手への送信映像）のトラックを即時差し替え
      for (const id in peerConnections) {
        const pc = peerConnections[id];
        const senders = pc.getSenders();

        senders.forEach(sender => {
          if (sender.track && sender.track.kind === "video" && newVideoTrack) {
            sender.replaceTrack(newVideoTrack).catch(e => console.error(e));
          }
          if (sender.track && sender.track.kind === "audio" && newAudioTrack) {
            sender.replaceTrack(newAudioTrack).catch(e => console.error(e));
          }
        });
      }
    }
  } catch (e) {
    console.error("デバイスの切り替えに失敗しました:", e);
    alert("カメラの切り替えに失敗しました。別のアプリがカメラを使用していないか確認してください。");
  }
}

cameraSelect.addEventListener("change", handleDeviceChange);
micSelect.addEventListener("change", handleDeviceChange);

// 3. 設定モーダルの制御
settingsBtn.addEventListener("click", () => settingsModal.style.display = "flex");
closeSettingsBtn.addEventListener("click", () => settingsModal.style.display = "none");

// 4. テーマ切り替え
themeToggleBtn.addEventListener("click", () => {
  const isDark = document.body.classList.contains("dark-theme");
  if (isDark) {
    document.body.classList.replace("dark-theme", "light-theme");
    themeToggleBtn.textContent = "ダークモードに切替";
  } else {
    document.body.classList.replace("light-theme", "dark-theme");
    themeToggleBtn.textContent = "ライトモードに切替";
  }
});

// 5. 名前変更処理
updateNameBtn.addEventListener("click", async () => {
  const newName = newNameInput.value.trim();
  if (!newName) return;
  await updateMyName(newName);
  myLocalName.textContent = `${newName} (あなた)`;
  newNameInput.value = "";
  alert("名前を更新しました");
});

// 6. レイアウト切り替え
layoutToggleBtn.addEventListener("click", () => {
  appLayout.classList.toggle("layout-default");
  appLayout.classList.toggle("layout-sidebar");
});

// ★イラスト通りの人数別グリッドクラスを適用するヘルパー関数
function updateGridClass() {
  const cardCount = videoGrid.querySelectorAll(".videoCard").length;
  videoGrid.className = ""; // 一旦リセット
  
  if (cardCount === 1) {
    videoGrid.classList.add("count-1");
  } else if (cardCount === 2) {
    videoGrid.classList.add("count-2");
  } else if (cardCount === 3) {
    videoGrid.classList.add("count-3");
  } else if (cardCount === 4) {
    videoGrid.classList.add("count-4");
  } else if (cardCount > 4) {
    videoGrid.classList.add("count-many");
  }
}

// 7. 入室処理
joinButton.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("名前を入力してください");

  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];
  if (videoTrack) videoTrack.enabled = initCameraToggle.checked;
  if (audioTrack) audioTrack.enabled = initMicToggle.checked;

  myCamBtn.classList.toggle("on", initCameraToggle.checked);
  myMicBtn.classList.toggle("on", initMicToggle.checked);

  await joinRoom(name);
  
  isJoined = true;
  
  joinScreen.style.display = "none";
  roomScreen.style.display = "flex";
  myLocalVideo.srcObject = localStream;
  myLocalName.textContent = `${name} (あなた)`;

  listenParticipants((participants) => {
    participantList.innerHTML = "";
    for (const id in peerConnections) {
      if (!participants[id]) {
        closeP2P(id);
        const card = document.getElementById(`card-${id}`);
        if (card) {
          card.remove();
          updateGridClass(); // 誰かが退出したときに配置をリフレッシュ
        }
      }
    }
    for (const id in participants) {
      const p = participants[id];
      const li = document.createElement("li");
      li.textContent = p.name + (id === myId ? " (あなた)" : "");
      participantList.appendChild(li);

      if (id !== myId && !peerConnections[id]) {
        startP2P(id, localStream, (peerId, remoteStream) => {
          addVideoCard(peerId, p.name, remoteStream);
        });
      }
      const existingCard = document.getElementById(`card-${id}`);
      if (existingCard) {
        existingCard.querySelector(".videoName").textContent = p.name;
      }
    }
    updateGridClass(); // 最初の監視起動時にも配置設定
  });
});

myCamBtn.addEventListener("click", () => {
  const t = localStream.getVideoTracks()[0];
  if (t) { t.enabled = !t.enabled; myCamBtn.classList.toggle("on", t.enabled); }
});
myMicBtn.addEventListener("click", () => {
  const t = localStream.getAudioTracks()[0];
  if (t) { t.enabled = !t.enabled; myMicBtn.classList.toggle("on", t.enabled); }
});

function addVideoCard(id, name, stream) {
  if (document.getElementById(`card-${id}`)) return;
  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${id}`;
  card.innerHTML = `
    <div class="video-wrapper"><video autoplay playsinline></video></div>
    <div class="videoControlBar"><span class="videoName">${name}</span></div>
  `;
  card.querySelector("video").srcObject = stream;
  videoGrid.appendChild(card);
  updateGridClass(); // ビデオカードが追加されたら配置を更新
}

init();
