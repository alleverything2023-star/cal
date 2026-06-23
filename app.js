import { joinRoom, listenParticipants, myId, updateMyName, sendChatMessageToFirebase, listenChatMessages, sendImageMessageToFirebase, sendPdfToFirebase, listenPdfData } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";
import { loadAndRenderPdf, renderCurrentPage, changePage } from "./pdf.js";

const DEVELOPER_KEY = "AIzaSyCYJ-LkqWiTLlH-M8IICl6SGLC-OmJmg_8"; 
const CLIENT_ID = "421359626063-r6e12ki8834lsvp2kcqevqf3g2h64kd7.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

let accessToken = null;
let gapiInited = false;

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

const mainMicBtn = document.getElementById("mainMicBtn");
const mainCamBtn = document.getElementById("mainCamBtn");
const layoutToggleBtn = document.getElementById("layoutToggleBtn");
const settingsBtn = document.getElementById("settingsBtn");

const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatMessages = document.getElementById("chatMessages");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const imageViewer = document.getElementById("imageViewer");
const viewerImage = document.getElementById("viewerImage");
const closeImageViewer = document.getElementById("closeImageViewer");

const uploadPdfBtn = document.getElementById("uploadPdfBtn");
const drivePdfBtn = document.getElementById("drivePdfBtn");
const pdfFileInput = document.getElementById("pdfFileInput");
const pdfFileNameLabel = document.getElementById("pdfFileNameLabel");

const settingsModal = document.getElementById("settingsModal");
const modalNameInput = document.getElementById("modalNameInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");

// タブ切り替え制御
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const targetTab = btn.getAttribute("data-tab");
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    
    btn.classList.add("active");
    const targetContent = document.getElementById(`tabContent-${targetTab}`);
    if (targetContent) targetContent.classList.add("active");
  });
});

// アプリ起動時のセットアップ
(async function init() {
  try {
    await updateDeviceList();
    await updatePreview();
  } catch (e) {
    console.error("初期デバイス取得失敗:", e);
  }
  
  // Google API と Identity Services の読み込み
  loadGapiAndGsi();
})();

async function updatePreview() {
  try {
    const stream = await getLocalStream(cameraSelect.value || null, micSelect.value || null);
    if (myPreviewVideo) {
      myPreviewVideo.srcObject = stream;
    }
    // トラックの初期ON/OFF制御
    stream.getVideoTracks().forEach(t => t.enabled = initCameraToggle.checked);
    stream.getAudioTracks().forEach(t => t.enabled = initMicToggle.checked);
  } catch(e) {
    console.warn("プレビュー用ストリーム取得失敗:", e);
  }
}

if (cameraSelect) cameraSelect.addEventListener("change", updatePreview);
if (micSelect) micSelect.addEventListener("change", updatePreview);
if (initCameraToggle) initCameraToggle.addEventListener("change", updatePreview);
if (initMicToggle) initMicToggle.addEventListener("change", updatePreview);

// 参加処理
if (joinButton) {
  joinButton.addEventListener("click", async () => {
    const name = nameInput.value.trim() || "名無しさん";
    currentUserName = name;
    
    try {
      localStream = await getLocalStream(cameraSelect.value || null, micSelect.value || null);
      if (myLocalVideo) myLocalVideo.srcObject = localStream;
      
      // 事前トグルの状態を反映
      const camOn = initCameraToggle.checked;
      const micOn = initMicToggle.checked;
      localStream.getVideoTracks().forEach(t => t.enabled = camOn);
      localStream.getAudioTracks().forEach(t => t.enabled = micOn);
      
      updateButtonStatusUI(mainCamBtn, "myCamStatus", camOn);
      updateButtonStatusUI(mainMicBtn, "myMicStatus", micOn);

      await joinRoom(name);
      isJoined = true;

      if (joinScreen) joinScreen.style.display = "none";
      if (roomScreen) roomScreen.style.display = "block";

      document.getElementById("myVideoName").textContent = name;

      // FirebaseメッセージとP2Pのリスナー開始
      setupRoomListeners();
    } catch (err) {
      alert("メディアデバイスへのアクセスに失敗しました: " + err.message);
    }
  });
}

function setupRoomListeners() {
  listenParticipants((id, info) => {
    if (id === myId) return;
    if (info) {
      addRemoteVideoCard(id, info.name);
      startP2P(id, localStream, (peerId, remoteStream) => {
        const video = document.getElementById(`video-${peerId}`);
        if (video) video.srcObject = remoteStream;
      });
    } else {
      removeRemoteVideoCard(id);
      closeP2P(id);
    }
  });

  listenChatMessages((sender, text) => {
    appendMessage(sender, text, sender === currentUserName);
  });

  listenPdfData((pdfUrl, fileName) => {
    if (pdfFileNameLabel) pdfFileNameLabel.textContent = fileName || "共有中の資料";
    loadAndRenderPdf(pdfUrl);
  });
}

/* ========================================================
   コントロールボタン制御 (マイク、カメラ、比率、設定) 完全復旧
   ======================================================== */
function updateButtonStatusUI(btnElement, indicatorId, isOn) {
  if (!btnElement) return;
  if (isOn) {
    btnElement.classList.add("on");
  } else {
    btnElement.classList.remove("on");
  }
  const indicator = document.getElementById(indicatorId);
  if (indicator) {
    if (isOn) indicator.classList.add("on");
    else indicator.classList.remove("on");
  }
}

if (mainMicBtn) {
  mainMicBtn.onclick = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      updateButtonStatusUI(mainMicBtn, "myMicStatus", audioTrack.enabled);
    }
  };
}

if (mainCamBtn) {
  mainCamBtn.onclick = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      updateButtonStatusUI(mainCamBtn, "myCamStatus", videoTrack.enabled);
    }
  };
}

// 比率変更（レイアウト切り替え 16:9 ↔ サイドバー型）の復旧
if (layoutToggleBtn) {
  layoutToggleBtn.onclick = () => {
    const mainContent = document.querySelector(".main-content");
    if (!mainContent) return;
    if (mainContent.classList.contains("layout-default")) {
      mainContent.classList.remove("layout-default");
      mainContent.classList.add("layout-sidebar");
    } else {
      mainContent.classList.remove("layout-sidebar");
      mainContent.classList.add("layout-default");
    }
    renderCurrentPage(); // PDFの再描画をかけて比率崩れを防ぐ
  };
}

// 設定モーダルとテーマカラー変更機能の復旧
if (settingsBtn) {
  settingsBtn.onclick = () => {
    if (modalNameInput) modalNameInput.value = currentUserName;
    if (settingsModal) settingsModal.style.display = "flex";
  };
}
if (closeSettingsBtn) {
  closeSettingsBtn.onclick = () => {
    if (settingsModal) settingsModal.style.display = "none";
  };
}
if (saveSettingsBtn) {
  saveSettingsBtn.onclick = () => {
    const newName = modalNameInput.value.trim();
    if (newName) {
      currentUserName = newName;
      document.getElementById("myVideoName").textContent = newName;
      updateMyName(newName);
    }
    // テーマ変更セレクトボックスが追加されている場合の処理
    const themeSelect = document.getElementById("themeColorSelect");
    if (themeSelect) {
      document.body.className = themeSelect.value;
    }
    if (settingsModal) settingsModal.style.display = "none";
  };
}

// モーダル内にテーマ切り替えUIがなければ動的に付与（デザイン維持）
if (settingsModal && !document.getElementById("themeColorSelect")) {
  const modalContent = settingsModal.querySelector(".modal-content");
  if (modalContent) {
    const themeItem = document.createElement("div");
    themeItem.className = "modal-item";
    themeItem.innerHTML = `
      <label for="themeColorSelect">テーマカラー:</label>
      <select id="themeColorSelect">
        <option value="dark-theme">ダークテーマ</option>
        <option value="light-theme">ライトテーマ</option>
      </select>
    `;
    modalContent.insertBefore(themeItem, modalContent.lastElementChild);
  }
}

/* ========================================================
   ビデオカード管理
   ======================================================== */
function addRemoteVideoCard(peerId, name) {
  if (document.getElementById(`card-${peerId}`)) return;

  const grid = document.getElementById("videoGrid");
  if (!grid) return;

  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${peerId}`;

  card.innerHTML = `
    <div class="video-wrapper">
      <video id="video-${peerId}" autoplay playsinline></video>
    </div>
    <div class="videoControlBar">
      <span class="videoName">${name}</span>
      <div class="btn-group">
        <div class="status-indicator on" id="mic-${peerId}">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
            <line class="slash-line" x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        </div>
        <div class="status-indicator on" id="cam-${peerId}">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            <line class="slash-line" x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        </div>
      </div>
    </div>
  `;
  grid.appendChild(card);
  updateGridCountClass();
}

function removeRemoteVideoCard(peerId) {
  const card = document.getElementById(`card-${peerId}`);
  if (card) card.remove();
  updateGridCountClass();
}

function updateGridCountClass() {
  const grid = document.getElementById("videoGrid");
  if (!grid) return;
  const count = grid.querySelectorAll(".videoCard").length;
  grid.className = "";
  if (count === 1) grid.classList.add("count-1");
  else if (count === 2) grid.classList.add("count-2");
  else if (count === 3) grid.classList.add("count-3");
  else if (count === 4) grid.classList.add("count-4");
  else grid.classList.add("count-many");
}

/* ========================================================
   チャット・画像送信
   ======================================================== */
function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;
  sendChatMessageToFirebase(currentUserName, text);
  chatInput.value = "";
  chatInput.focus();
}

function appendMessage(sender, text, isMe = false) {
  if (!chatMessages) return;
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.margin = "8px 0";
  if (isMe) wrap.style.alignItems = "flex-end";

  const lbl = document.createElement("span");
  lbl.textContent = isMe ? "あなた" : sender;
  lbl.style.fontSize = "12px"; lbl.style.color = "#aaa"; lbl.style.marginBottom = "2px";
  wrap.appendChild(lbl);

  const bbl = document.createElement("div");
  bbl.textContent = text;
  bbl.style.padding = "10px 14px"; bbl.style.borderRadius = "14px"; bbl.style.maxWidth = "75%\"; bbl.style.wordBreak = \"break-all\"; bbl.style.fontSize = \"14px\";
  if (isMe) {
    bbl.style.backgroundColor = "#5865f2"; bbl.style.color = "white";
  } else {
    bbl.style.backgroundColor = "#2b2d31"; bbl.style.color = "white";
    bbl.style.border = "1px solid #444";
  }
  wrap.appendChild(bbl);
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

function appendImageMessage(sender, imageUrl, isMe = false) {
  if (!chatMessages) return;
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.margin = "8px 0";
  if (isMe) wrap.style.alignItems = "flex-end";

  const lbl = document.createElement("span");
  lbl.textContent = isMe ? "あなた" : sender;
  lbl.style.fontSize = "12px"; lbl.style.color = "#aaa"; lbl.style.marginBottom = "2px";
  wrap.appendChild(lbl);

  const img = document.createElement("img");
  img.src = imageUrl;
  img.className = "chat-image";
  img.onclick = () => {
    if (viewerImage) viewerImage.src = imageUrl;
    if (imageViewer) imageViewer.style.display = "flex";
  };

  wrap.appendChild(img);
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

function scrollToBottom() { if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; }
if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);
if (chatInput) chatInput.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && sendChatMessage());

if (imageBtn) imageBtn.addEventListener("click", () => { imageInput.click(); });
if (imageInput) {
  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { sendImageMessageToFirebase(currentUserName, reader.result); };
    reader.readAsDataURL(file);
  });
}
if (closeImageViewer) {
  closeImageViewer.onclick = () => { if (imageViewer) imageViewer.style.display = "none"; };
}

/* ========================================================
   PDFローカルアップロード処理
   ======================================================== */
if (uploadPdfBtn) uploadPdfBtn.onclick = () => pdfFileInput.click();
if (pdfFileInput) {
  pdfFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (pdfFileNameLabel) pdfFileNameLabel.textContent = file.name;
    const reader = new FileReader();
    reader.onload = function () {
      sendPdfToFirebase(reader.result, file.name);
    };
    reader.readAsDataURL(file);
  };
}

/* ========================================================
   Google Drive Picker 連携処理の完全復旧
   ======================================================== */
function loadGapiAndGsi() {
  const scriptGapi = document.createElement("script");
  scriptGapi.src = "https://apis.google.com/js/api.js";
  scriptGapi.onload = () => gapi.load("client:picker", () => { gapiInited = true; });
  document.head.appendChild(scriptGapi);

  const scriptGsi = document.createElement("script");
  scriptGsi.src = "https://accounts.google.com/gsi/client";
  document.head.appendChild(scriptGsi);
}

if (drivePdfBtn) {
  drivePdfBtn.onclick = () => {
    if (!gapiInited) {
      alert("Google APIの準備ができていません。しばらく経ってからやり直してください。");
      return;
    }
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (response) => {
        if (response.error !== undefined) throw response;
        accessToken = response.access_token;
        createPicker();
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  };
}

function createPicker() {
  const view = new google.picker.View(google.picker.ViewId.PDFS);
  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(DEVELOPER_KEY)
    .setCallback(pickerCallback)
    .build();
  picker.setVisible(true);
}

async function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const doc = data.docs[0];
    const fileId = doc.id;
    const fileName = doc.name;
    if (pdfFileNameLabel) pdfFileNameLabel.textContent = fileName;
    
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        sendPdfToFirebase(reader.result, fileName);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Driveファイル取得失敗:", err);
    }
  }
}
