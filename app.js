import { joinRoom, listenParticipants, myId, updateMyName, sendChatMessageToFirebase, listenChatMessages } from "./room.js";
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

const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatMessages = document.getElementById("chatMessages");

// ビデオ要素にストリームを安全に設定し、iPad用に再生を強制するヘルパー
function setVideoSrc(videoElement, stream) {
  if (!videoElement) return;
  videoElement.srcObject = stream;
  videoElement.play().catch(err => console.log("ビデオ再生開始の待機中:", err));
}

async function init() {
  // 【UI調整】入室画面が端末からはみ出さないように、高さを自動調整するスタイルを注入
  if (joinScreen) {
    joinScreen.style.display = "flex";
    joinScreen.style.flexDirection = "column";
    joinScreen.style.justifyContent = "center";
    joinScreen.style.alignItems = "center";
    joinScreen.style.minHeight = "100vh";
    joinScreen.style.padding = "10px";
    joinScreen.style.boxSizing = "border-box";
    joinScreen.style.overflowY = "auto"; // 万が一のスクロール対応

    // 入室画面の中にある白い（または暗い）コンテナボックスを取得してフィットさせる
    const joinContainer = joinScreen.querySelector(".join-container") || joinScreen.children[0];
    if (joinContainer) {
      joinContainer.style.maxHeight = "95vh";
      joinContainer.style.maxWidth = "100%";
      joinContainer.style.width = "400px";
      joinContainer.style.overflowY = "auto";
      joinContainer.style.boxSizing = "border-box";
      joinContainer.style.padding = "20px";
      joinContainer.style.margin = "auto";
    }

    // プレビュービデオのサイズが大きすぎてはみ出るのを防ぐ
    if (myPreviewVideo) {
      myPreviewVideo.style.maxWidth = "100%";
      myPreviewVideo.style.maxHeight = "200px"; 
      myPreviewVideo.style.borderRadius = "8px";
      myPreviewVideo.style.objectFit = "cover";
    }
  }

  try {
    localStream = await getLocalStream();
    if (myPreviewVideo) {
      setVideoSrc(myPreviewVideo, localStream);
    }
    await new Promise(r => setTimeout(r, 300));
    await updateDeviceList();
  } catch (e) { 
    console.error("初期化エラー:", e);
    alert("カメラ・マイクの起動に失敗しました。iPadの設定＞Safari＞カメラのアクセス権が「許可」になっているか確認してください。"); 
  }
}

async function handleDeviceChange() {
  if (!localStream) return;
  
  localStream.getTracks().forEach(track => { 
    try { track.stop(); } catch(err) { console.error(err); }
  });
  localStream = null;

  try {
    const targetCam = (cameraSelect && cameraSelect.value) ? cameraSelect.value : null;
    const targetMic = (micSelect && micSelect.value) ? micSelect.value : null;
    
    const newStream = await getLocalStream(targetCam, targetMic);
    localStream = newStream;
    const newVideoTrack = localStream.getVideoTracks()[0];
    const newAudioTrack = localStream.getAudioTracks()[0];
    
    if (!isJoined) {
      if (myPreviewVideo) setVideoSrc(myPreviewVideo, localStream);
      if (newVideoTrack && initCameraToggle) newVideoTrack.enabled = initCameraToggle.checked;
      if (newAudioTrack && initMicToggle) newAudioTrack.enabled = initMicToggle.checked;
    } else {
      if (myLocalVideo) setVideoSrc(myLocalVideo, localStream);
      if (newVideoTrack && myCamBtn) newVideoTrack.enabled = myCamBtn.classList.contains("on");
      if (newAudioTrack && myMicBtn) newAudioTrack.enabled = myMicBtn.classList.contains("on");
      
      for (const id in peerConnections) {
        const pc = peerConnections[id];
        if (!pc) continue;
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
    console.error("デバイス切り替え失敗:", e); 
  }
}

if (cameraSelect) cameraSelect.addEventListener("change", handleDeviceChange);
if (micSelect) micSelect.addEventListener("change", handleDeviceChange);

if (settingsBtn) settingsBtn.addEventListener("click", () => { if (settingsModal) settingsModal.style.display = "flex"; });
if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", () => { if (settingsModal) settingsModal.style.display = "none"; });

if (themeToggleBtn) {
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
}

if (updateNameBtn) {
  updateNameBtn.addEventListener("click", async () => {
    if (!newNameInput) return;
    const newName = newNameInput.value.trim();
    if (!newName) return;
    await updateMyName(newName);
    if (myLocalName) myLocalName.textContent = `${newName} (あなた)`;
    currentUserName = newName;
    newNameInput.value = "";
    alert("名前を更新しました");
  });
}

if (layoutToggleBtn) {
  layoutToggleBtn.addEventListener("click", () => {
    if (appLayout) {
      appLayout.classList.toggle("layout-default");
      appLayout.classList.toggle("layout-sidebar");
    }
  });
}

function updateGridClass() {
  if (!videoGrid) return;
  const cardCount = videoGrid.querySelectorAll(".videoCard").length;
  videoGrid.className = "count-" + (cardCount <= 4 ? cardCount : "many");
}

if (joinButton) {
  joinButton.addEventListener("click", async () => {
    if (!nameInput || !localStream) return;
    const name = nameInput.value.trim();
    if (!name) return alert("名前を入力してください");
    currentUserName = name;
    
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];
    if (videoTrack && initCameraToggle) videoTrack.enabled = initCameraToggle.checked;
    if (audioTrack && initMicToggle) audioTrack.enabled = initMicToggle.checked;

    if (myCamBtn && initCameraToggle) myCamBtn.classList.toggle("on", initCameraToggle.checked);
    if (myCamStatus && initCameraToggle) myCamStatus.classList.toggle("on", initCameraToggle.checked);
    if (myMicBtn && initMicToggle) myMicBtn.classList.toggle("on", initMicToggle.checked);
    if (myMicStatus && initMicToggle) myMicStatus.classList.toggle("on", initMicToggle.checked);

    await joinRoom(name);
    isJoined = true;
    if (joinScreen) joinScreen.style.display = "none";
    if (roomScreen) roomScreen.style.display = "flex";
    if (myLocalVideo) setVideoSrc(myLocalVideo, localStream);
    if (myLocalName) myLocalName.textContent = `${name} (あなた)`;

    // リアルタイム参加者監視の開始
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

    // Firebaseからのリアルタイムチャット受信を開始
    listenChatMessages((sender, text) => {
      const isMe = (sender === currentUserName);
      appendMessage(sender, text, isMe);
    });
  });
}

if (myCamBtn) {
  myCamBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (t) { 
      t.enabled = !t.enabled; 
      myCamBtn.classList.toggle("on", t.enabled); 
      if (myCamStatus) myCamStatus.classList.toggle("on", t.enabled); 
    }
  });
}

if (myMicBtn) {
  myMicBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (t) { 
      t.enabled = !t.enabled; 
      myMicBtn.classList.toggle("on", t.enabled); 
      if (myMicStatus) myMicStatus.classList.toggle("on", t.enabled); 
    }
  });
}

function addVideoCard(id, name, stream) {
  if (!videoGrid || document.getElementById(`card-${id}`)) return;
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
  
  const targetVideo = card.querySelector("video");
  setVideoSrc(targetVideo, stream);
  
  videoGrid.appendChild(card);
  updateGridClass();

  const camIndicator = card.querySelector(`#camStatus-${id}`);
  const micIndicator = card.querySelector(`#micStatus-${id}`);
  const intervalId = setInterval(() => {
    if (!document.getElementById(`card-${id}`)) {
      clearInterval(intervalId);
      return;
    }
    const vTrack = stream.getVideoTracks()[0];
    const aTrack = stream.getAudioTracks()[0];
    if (vTrack && camIndicator) camIndicator.classList.toggle("on", vTrack.enabled && !vTrack.muted);
    if (aTrack && micIndicator) micIndicator.classList.toggle("on", aTrack.enabled && !aTrack.muted);
  }, 500);
}

// タブ切り替え
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

// チャット送信処理
function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;

  // Firebase経由で全員に向けてメッセージを送信
  sendChatMessageToFirebase(currentUserName, text);

  chatInput.value = "";
  chatInput.focus();
}

function appendMessage(sender, text, isMe = false) {
  if (!chatMessages) return;
  
  const messageWrapper = document.createElement("div");
  messageWrapper.style.display = "flex";
  messageWrapper.style.flexDirection = "column";
  messageWrapper.style.margin = "8px 0";
  messageWrapper.style.width = "100%";
  if (isMe) messageWrapper.style.alignItems = "flex-end";

  const nameLabel = document.createElement("span");
  nameLabel.className = "chat-user-name";
  nameLabel.textContent = isMe ? "あなた" : sender;
  nameLabel.style.fontSize = "12px";
  nameLabel.style.color = "#aaa";
  nameLabel.style.marginBottom = "2px";
  messageWrapper.appendChild(nameLabel);

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isMe ? "my-msg" : ""}`;
  bubble.textContent = text;
  
  // 【超重要：メッセージ不可視対策】文字が絶対に隠れないようにスタイルを強制上書き
  bubble.style.padding = "10px 14px";
  bubble.style.borderRadius = "14px";
  bubble.style.maxWidth = "75%";
  bubble.style.wordBreak = "break-all";
  bubble.style.fontSize = "14px";
  bubble.style.display = "inline-block";

  if (isMe) {
    bubble.style.backgroundColor = "#007bff"; // 自分のメッセージは青
    bubble.style.color = "#ffffff";
  } else {
    bubble.style.backgroundColor = "#e9ecef"; // 相手のメッセージは薄いグレー
    bubble.style.color = "#333333";
  }
  
  messageWrapper.appendChild(bubble);
  chatMessages.appendChild(messageWrapper);
  
  scrollToBottom();
}

function scrollToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);
if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      sendChatMessage();
    }
  });
}

init();
