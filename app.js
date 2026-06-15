import { joinRoom, listenParticipants, myId, updateMyName } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

let localStream = null;
let isJoined = false; // ★入室済みかどうかを判定するフラグを追加

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

// 2. ★【大幅修正】デバイス（カメラ・マイク）変更時のリアルタイム切り替え処理
async function handleDeviceChange() {
  if (!localStream) return;

  // 古いストリームのトラックをすべて停止させて解放する
  localStream.getTracks().forEach(track => track.stop());

  try {
    // 選択された新しいデバイスでストリームを再取得
    localStream = await getLocalStream(cameraSelect.value, micSelect.value);

    if (!isJoined) {
      // 【入室前】の場合：プレビュー画面の映像を更新
      myPreviewVideo.srcObject = localStream;
      
      // チェックボックスの状態を反映
      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      if (videoTrack) videoTrack.enabled = initCameraToggle.checked;
      if (audioTrack) audioTrack.enabled = initMicToggle.checked;
    } else {
      // 【入室後】の場合：自分の通話画面の映像を更新
      myLocalVideo.srcObject = localStream;

      const newVideoTrack = localStream.getVideoTracks()[0];
      const newAudioTrack = localStream.getAudioTracks()[0];

      // 現在のボタンのON/OFF状態（クラスに 'on' があるか）を新しいトラックに引き継ぐ
      if (newVideoTrack) newVideoTrack.enabled = myCamBtn.classList.contains("on");
      if (newAudioTrack) newAudioTrack.enabled = myMicBtn.classList.contains("on");

      // 接続中のすべての相手（Peer）に対して、新しくなったカメラ・マイクの映像を送り直す（RTCRtpSenderの差し替え）
      for (const id in peerConnections) {
        const pc = peerConnections[id];
        const senders = pc.getSenders();

        senders.forEach(sender => {
          if (sender.track && sender.track.kind === "video" && newVideoTrack) {
            sender.replaceTrack(newVideoTrack);
          }
          if (sender.track && sender.track.kind === "audio" && newAudioTrack) {
            sender.replaceTrack(newAudioTrack);
          }
        });
      }
    }
  } catch (e) {
    console.error("デバイスの切り替えに失敗しました:", e);
  }
}

// セレクトボックスが変更されたら即座に上記の切り替えを実行
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

// 7. 入室処理
joinButton.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("名前を入力してください");

  // トラック状態の初期反映
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];
  if (videoTrack) videoTrack.enabled = initCameraToggle.checked;
  if (audioTrack) audioTrack.enabled = initMicToggle.checked;

  myCamBtn.classList.toggle("on", initCameraToggle.checked);
  myMicBtn.classList.toggle("on", initMicToggle.checked);

  await joinRoom(name);
  
  isJoined = true; // ★入室フラグをtrueにする
  
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
        if (card) card.remove();
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
      // 名前が更新された場合への対応
      const existingCard = document.getElementById(`card-${id}`);
      if (existingCard) {
        existingCard.querySelector(".videoName").textContent = p.name;
      }
    }
  });
});

// 自分のカメラ・マイクボタン
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
}

init();
