import { joinRoom, listenParticipants, myId, updateMyName } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

let localStream = null;
let isJoined = false;
let currentUserName = "あなた";

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
const videoGrid = document.getElementById("videoGrid");

const myCamBtn = document.getElementById("myCamBtn");
const myMicBtn = document.getElementById("myMicBtn");
const layoutToggleBtn = document.getElementById("layoutToggleBtn");
const appLayout = document.getElementById("appLayout");

const myCamStatus = document.getElementById("myCamStatus");
const myMicStatus = document.getElementById("myMicStatus");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const newNameInput = document.getElementById("newNameInput");
const updateNameBtn = document.getElementById("updateNameBtn");

// タブ・チャット関連の要素
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatMessages = document.getElementById("chatMessages");

async function init() {
  try {
    localStream = await getLocalStream();
    myPreviewVideo.srcObject = localStream;
    await new Promise(r => setTimeout(r, 200));
    await updateDeviceList();
  } catch (e) { alert("カメラ許可が必要です"); }
}

async function handleDeviceChange() {
  if (!localStream) return;
  localStream.getTracks().forEach(track => { track.stop(); localStream.removeTrack(track); });
  try {
    const newStream = await getLocalStream(cameraSelect.value, micSelect.value);
    localStream = newStream;
    const newVideoTrack = localStream.getVideoTracks()[0];
    const newAudioTrack = localStream.getAudioTracks()[0];
    if (!isJoined) {
      myPreviewVideo.srcObject = localStream;
      if (newVideoTrack) newVideoTrack.enabled = initCameraToggle.checked;
      if (newAudioTrack) newAudioTrack.enabled = initMicToggle.checked;
    } else {
      myLocalVideo.srcObject = localStream;
      if (newVideoTrack) newVideoTrack.enabled = myCamBtn.classList.contains("on");
      if (newAudioTrack) newAudioTrack.enabled = myMicBtn.classList.contains("on");
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
  } catch (e) { console.error("デバイスの切り替えに失敗しました:", e); }
}

cameraSelect.addEventListener("change", handleDeviceChange);
micSelect.addEventListener("change", handleDeviceChange);
settingsBtn.addEventListener("click", () => settingsModal.style.display = "flex");
closeSettingsBtn.addEventListener("click", () => settingsModal.style.display = "none");

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

updateNameBtn.addEventListener("click", async () => {
  const newName = newNameInput.value.trim();
  if (!newName) return;
  await updateMyName(newName);
  myLocalName.textContent = `${newName} (あなた)`;
  currentUserName = newName;
  newNameInput.value = "";
  alert("名前を更新しました");
});

layoutToggleBtn.addEventListener("click", () => {
  appLayout.classList.toggle("layout-default");
  appLayout.classList.toggle("layout-sidebar");
});

function updateGridClass() {
  const cardCount = videoGrid.querySelectorAll(".videoCard").length;
  videoGrid.className = "count-" + (cardCount <= 4 ? cardCount : "many");
}

joinButton.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return alert("名前を入力してください");
  currentUserName = name;
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];
  if (videoTrack) videoTrack.enabled = initCameraToggle.checked;
  if (audioTrack) audioTrack.enabled = initMicToggle.checked;

  myCamBtn.classList.toggle("on", initCameraToggle.checked);
  myCamStatus.classList.toggle("on", initCameraToggle.checked);
  myMicBtn.classList.toggle("on", initMicToggle.checked);
  myMicStatus.classList.toggle("on", initMicToggle.checked);

  await joinRoom(name);
  isJoined = true;
  joinScreen.style.display = "none";
  roomScreen.style.display = "flex";
  myLocalVideo.srcObject = localStream;
  myLocalName.textContent = `${name} (あなた)`;

  listenParticipants((participants) => {
    for (const id in peerConnections) {
      if (!participants[id]) {
        closeP2P(id);
        const card = document.getElementById(`card-${id}`);
        if (card) { card.remove(); updateGridClass(); }
      }
    }
    for (const id in participants) {
      const p = participants[id];
      if (id !== myId && !peerConnections[id]) {
        startP2P(id, localStream, (peerId, remoteStream) => { addVideoCard(peerId, p.name, remoteStream); });
      }
      const existingCard = document.getElementById(`card-${id}`);
      if (existingCard) { existingCard.querySelector(".videoName").textContent = p.name; }
    }
    updateGridClass();
  });
});

myCamBtn.addEventListener("click", () => {
  const t = localStream.getVideoTracks()[0];
  if (t) { t.enabled = !t.enabled; myCamBtn.classList.toggle("on", t.enabled); myCamStatus.classList.toggle("on", t.enabled); }
});
myMicBtn.addEventListener("click", () => {
  const t = localStream.getAudioTracks()[0];
  if (t) { t.enabled = !t.enabled; myMicBtn.classList.toggle("on", t.enabled); myMicStatus.classList.toggle("on", t.enabled); }
});

function addVideoCard(id, name, stream) {
  if (document.getElementById(`card-${id}`)) return;
  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${id}`;
  card.innerHTML = `
    <div class="video-wrapper"><video autoplay playsinline></video></div>
    <div class="videoControlBar">
      <span class="videoName">${name}</span>
      <div class="btn-group">
        <div id="camStatus-${id}" class="status-indicator on">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M15 8H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"/>
            <polygon points="17 11 22 8 22 16 17 13"/>
            <line class="slash-line" x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </div>
        <div id="micStatus-${id}" class="status-indicator on">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <rect x="9" y="2" width="6" height="11" rx="3"/>
            <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>
            <line class="slash-line" x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </div>
      </div>
    </div>
  `;
  card.querySelector("video").srcObject = stream;
  videoGrid.appendChild(card);
  updateGridClass();

  const camIndicator = card.querySelector(`#camStatus-${id}`);
  const micIndicator = card.querySelector(`#micStatus-${id}`);
  setInterval(() => {
    const vTrack = stream.getVideoTracks()[0];
    const aTrack = stream.getAudioTracks()[0];
    if (vTrack) camIndicator.classList.toggle("on", vTrack.enabled && !vTrack.muted);
    if (aTrack) micIndicator.classList.toggle("on", aTrack.enabled && !aTrack.muted);
  }, 500);
}

// タブ切り替えロジック
tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    tabButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");

    const targetTab = button.getAttribute("data-tab");
    tabContents.forEach(content => {
      content.classList.remove("active");
      if (content.id === `tabContent-${targetTab}`) {
        content.classList.add("active");
      }
    });

    if (targetTab === "chat") {
      scrollToBottom();
    }
  });
});

// チャット送信・表示処理（ローカルモック）
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage(currentUserName, text, true);
  chatInput.value = "";
  chatInput.focus();
}

function appendMessage(sender, text, isMe = false) {
  const messageWrapper = document.createElement("div");
  messageWrapper.style.display = "flex";
  messageWrapper.style.flexDirection = "column";
  if (isMe) messageWrapper.style.alignItems = "flex-end";

  const nameLabel = document.createElement("span");
  nameLabel.className = "chat-user-name";
  nameLabel.textContent = isMe ? "あなた" : sender;
  messageWrapper.appendChild(nameLabel);

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isMe ? "my-msg" : ""}`;
  bubble.textContent = text;
  messageWrapper.appendChild(bubble);

  chatMessages.appendChild(messageWrapper);
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) {
    sendChatMessage();
  }
});

init();
