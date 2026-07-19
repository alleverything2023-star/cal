import { joinRoom, listenParticipants, myId, updateMyName, updateMyMediaState, sendChatMessageToFirebase, listenChatMessages, sendImageMessageToFirebase, sendPdfToFirebase, listenPdfData } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";
import { loadAndRenderPdf, renderCurrentPage, changePage } from "./pdf.js";
import { initPomodoroTimers } from "./pomodoro.js";

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

(async function init() {
  loadGapiAndGsi();
  initPomodoroTimers();
  try {
    // 権限要求なしで一覧取得のみ（ユーザー操作を伴わないgetUserMedia呼び出しを避ける）
    await updateDeviceList(false);
  } catch (e) {
    console.error("初期デバイス一覧取得に失敗しました", e);
  }
})();
async function updatePreview() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    localStream = await getLocalStream(
      cameraSelect.value || null,
      micSelect.value || null
    );
    if (myPreviewVideo) {
      myPreviewVideo.srcObject = localStream;
    }
    // トラックの初期ON/OFF制御
    localStream.getVideoTracks().forEach(t => t.enabled = initCameraToggle.checked);
    localStream.getAudioTracks().forEach(t => t.enabled = initMicToggle.checked);
  } catch(e) {
    console.error(e);
  }
}

if (cameraSelect) cameraSelect.addEventListener("change", updatePreview);
if (micSelect) micSelect.addEventListener("change", updatePreview);
if (initCameraToggle) initCameraToggle.addEventListener("change", updatePreview);
if (initMicToggle) initMicToggle.addEventListener("change", updatePreview);

// 参加処理
if (joinButton) {
  joinButton.addEventListener("click", async () => {

    joinButton.disabled = true;

    try {

      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      permissionStream.getTracks().forEach(track => track.stop());

      // カメラ/マイクのハードウェア解放が完了するまで少し待つ
      // (解放直後に再取得すると、一部のスマホで "could not start video source" になるため)
      await new Promise(resolve => setTimeout(resolve, 300));

      // 権限はすでに取得済みなので、ここでは一覧取得のみ行う(二重にgetUserMediaを呼ばない)
      await updateDeviceList(false);

      const name = nameInput.value.trim() || "名無しさん";
      currentUserName = name;

      localStream = await getLocalStream(
        cameraSelect.value || null,
        micSelect.value || null
      );

      if (myLocalVideo) myLocalVideo.srcObject = localStream;
      if (myPreviewVideo) myPreviewVideo.srcObject = localStream;

      const camOn = initCameraToggle.checked;
      const micOn = initMicToggle.checked;

      localStream.getVideoTracks().forEach(t => t.enabled = camOn);
      localStream.getAudioTracks().forEach(t => t.enabled = micOn);

      updateButtonStatusUI(mainCamBtn, "myCamStatus", camOn);
      updateButtonStatusUI(mainMicBtn, "myMicStatus", micOn);

      await joinRoom(name, camOn, micOn);

      isJoined = true;

      joinScreen.style.display = "none";
      roomScreen.style.display = "block";

      document.getElementById("myVideoName").textContent = name;

      setupRoomListeners();

    } catch (err) {

      console.error(err);

      alert("メディアデバイスへのアクセスに失敗しました。\n\n" + err.message);

    } finally {

      joinButton.disabled = false;

    }

  });
}

function setupRoomListeners() {
  listenParticipants((id, info) => {
    if (id === myId) return;
    if (info) {
      if (document.getElementById(`card-${id}`)) {
        // 既にカードがあれば、マイク/カメラの状態だけ更新
        updateRemoteMediaStatusUI(id, info);
      } else {
        addRemoteVideoCard(id, info.name);
        updateRemoteMediaStatusUI(id, info);
        startP2P(id, localStream, (peerId, remoteStream) => {
          const video = document.getElementById(`video-${peerId}`);
          if (video) video.srcObject = remoteStream;
        });
      }
    } else {
      removeRemoteVideoCard(id);
      closeP2P(id);
    }
  });

  listenChatMessages((msg) => {
    if (msg.image) {
      appendImageMessage(msg.sender, msg.image, msg.sender === currentUserName);
    } else {
      appendMessage(msg.sender, msg.text, msg.sender === currentUserName);
    }
  });

  listenPdfData((data) => {
    if (pdfFileNameLabel) pdfFileNameLabel.textContent = data.name || "共有中の資料";
    loadAndRenderPdf(data.pdf);
  });
}

/* ========================================================
   コントロールボタン制御 (マイク、カメラ、比率、設定)
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
      updateMyMediaState({ micOn: audioTrack.enabled });
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
      updateMyMediaState({ camOn: videoTrack.enabled });
    }
  };
}

// 比率変更（レイアウト切り替え 16:9 ↔ サイドバー型）
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

// 設定モーダルとテーマカラー変更機能
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

// 他参加者のマイク/カメラの状態を、名前バーのアイコンに反映する
function updateRemoteMediaStatusUI(peerId, info) {
  const micIndicator = document.getElementById(`mic-${peerId}`);
  const camIndicator = document.getElementById(`cam-${peerId}`);
  const micOn = info.micOn !== false; // 情報がまだ無い場合はON扱い
  const camOn = info.camOn !== false;

  if (micIndicator) {
    if (micOn) micIndicator.classList.add("on");
    else micIndicator.classList.remove("on");
  }
  if (camIndicator) {
    if (camOn) camIndicator.classList.add("on");
    else camIndicator.classList.remove("on");
  }
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
  bbl.style.padding = "10px 14px"; bbl.style.borderRadius = "14px"; bbl.style.maxWidth = "75%"; bbl.style.wordBreak = "break-all"; bbl.style.fontSize = "14px";
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
   Google Drive Picker 連携処理
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

/* ========================================================
   デプロイ更新チェック（古いキャッシュを見ていないか自動検知）
   ======================================================== */
const VERSION_CHECK_URL = "./version.json";
const VERSION_CHECK_INTERVAL_MS = 60 * 1000; // 60秒おきにチェック

let loadedVersion = null;
let updateBannerEl = null;

async function fetchVersion() {
  try {
    // キャッシュを無視して必ず最新のversion.jsonを取得する
    const res = await fetch(`${VERSION_CHECK_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch (e) {
    return null;
  }
}

function showUpdateBanner() {
  if (updateBannerEl) return; // 既に表示中なら何もしない

  updateBannerEl = document.createElement("div");
  updateBannerEl.textContent = "新しいバージョンが公開されました。";

  Object.assign(updateBannerEl.style, {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#5865f2",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "10px",
    boxShadow: "0 4px 15px rgba(0,0,0,0.4)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "0.9rem"
  });

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = "更新する";
  reloadBtn.type = "button";
  Object.assign(reloadBtn.style, {
    background: "#fff",
    color: "#5865f2",
    border: "none",
    borderRadius: "6px",
    padding: "6px 12px",
    fontWeight: "bold",
    cursor: "pointer"
  });
  reloadBtn.onclick = () => location.reload();

  updateBannerEl.appendChild(reloadBtn);
  document.body.appendChild(updateBannerEl);
}

async function checkForUpdate() {
  const latest = await fetchVersion();
  if (latest === null) return; // 取得失敗時は何もしない（通信一時エラーなどを無視）

  if (loadedVersion === null) {
    // 初回チェック時の値を「今表示しているバージョン」として記録
    loadedVersion = latest;
    return;
  }

  if (latest !== loadedVersion) {
    showUpdateBanner();
  }
}

// ページ読み込み後にもう一度確認 ＋ 定期的にチェック
setTimeout(checkForUpdate, 3000);
setInterval(checkForUpdate, VERSION_CHECK_INTERVAL_MS);

// スリープ復帰・タブ切り替えから戻った時にも即チェック
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkForUpdate();
  }
});

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
