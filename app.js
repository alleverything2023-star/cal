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

const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const imageViewer = document.getElementById("imageViewer");
const viewerImage = document.getElementById("viewerImage");
const closeImageViewer = document.getElementById("closeImageViewer");

const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");

function setVideoSrc(videoElement, stream) {
  if (!videoElement) return;
  videoElement.srcObject = stream;
  videoElement.play().catch(err => console.log("ビデオ再生開始の待機中:", err));
}

function loadGoogleLibraries() {
  return new Promise((resolve) => {
    if (gapiInited) { resolve(true); return; }
    if (typeof gapi === 'undefined') { resolve(false); return; }
    gapi.load('picker', () => { gapiInited = true; resolve(true); });
  });
}

async function init() {
  const openDrivePickerBtn = document.getElementById("openDrivePickerBtn");
  if (openDrivePickerBtn) {
    openDrivePickerBtn.addEventListener("click", handleDrivePickerOpen);
  }
  const switchAccountBtn = document.getElementById("switchAccountBtn");
  if (switchAccountBtn) {
    switchAccountBtn.addEventListener("click", handleSwitchAccount);
  }

  await loadGoogleLibraries();

  try {
    localStream = await getLocalStream();
    if (myPreviewVideo) { setVideoSrc(myPreviewVideo, localStream); }
    await new Promise(r => setTimeout(r, 300));
    await updateDeviceList();
  } catch (e) { console.error("初期化エラー:", e); }
}

async function handleDrivePickerOpen() {
  const ready = await loadGoogleLibraries();
  if (!ready || typeof google === 'undefined') {
    alert("Googleのシステムを読み込み中です。少し待ってからもう一度押してください。");
    return;
  }
  if (!accessToken) {
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: 'select_account', 
        callback: async (response) => {
          if (response.error !== undefined) throw response;
          accessToken = response.access_token;
          createPicker();
        },
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      alert("認証画面の起動に失敗しました。");
    }
  } else {
    createPicker();
  }
}

function handleSwitchAccount() {
  if (accessToken) {
    try {
      google.accounts.oauth2.revokeToken(accessToken, () => {
        accessToken = null;
        alert("アカウントを選択し直せます。");
      });
    } catch (err) {
      accessToken = null;
    }
  } else {
    alert("そのまま「PDFを選択」を押して別のアカウントを選んでください。");
  }
}

function createPicker() {
  if (!gapiInited || !accessToken) return;
  try {
    const docsView = new google.picker.DocsView().setMimeTypes("application/pdf");
    const picker = new google.picker.PickerBuilder()
      .addView(docsView)
      .setOAuthToken(accessToken)
      .setDeveloperKey(DEVELOPER_KEY)
      .setCallback(pickerCallback)
      .build();
    picker.setVisible(true);
  } catch (err) { alert(String(err)); }
}

async function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const doc = data.docs[0];
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`;
    try {
      await sendPdfToFirebase(downloadUrl, doc.name);
    } catch (err) { alert("共有に失敗しました。"); }
  }
}

async function handleDeviceChange() {
  if (!localStream) return;
  localStream.getTracks().forEach(track => { try { track.stop(); } catch(err) {} });
  localStream = null;

  try {
    const targetCam = cameraSelect?.value || null;
    const targetMic = micSelect?.value || null;
    localStream = await getLocalStream(targetCam, targetMic);
    
    if (!isJoined) {
      if (myPreviewVideo) setVideoSrc(myPreviewVideo, localStream);
    } else {
      if (myLocalVideo) setVideoSrc(myLocalVideo, localStream);
      const vTrack = localStream.getVideoTracks()[0];
      const aTrack = localStream.getAudioTracks()[0];
      
      if (vTrack && myCamBtn) vTrack.enabled = myCamBtn.classList.contains("on");
      if (aTrack && myMicBtn) aTrack.enabled = myMicBtn.classList.contains("on");
      
      for (const id in peerConnections) {
        const pc = peerConnections[id];
        if (!pc) continue;
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === "video" && vTrack) sender.replaceTrack(vTrack);
          if (sender.track?.kind === "audio" && aTrack) sender.replaceTrack(aTrack);
        });
      }
    }
  } catch (e) { console.error(e); }
}

if (cameraSelect) cameraSelect.addEventListener("change", handleDeviceChange);
if (micSelect) micSelect.addEventListener("change", handleDeviceChange);

if (settingsBtn) settingsBtn.addEventListener("click", () => settingsModal && (settingsModal.style.display = "flex"));
if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", () => settingsModal && (settingsModal.style.display = "none"));

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    if (document.body.classList.contains("dark-theme")) {
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

if (prevPageBtn) { prevPageBtn.onclick = () => changePage(-1); }
if (nextPageBtn) { nextPageBtn.onclick = () => changePage(1); }

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

    listenParticipants((participants) => {
      for (const id in peerConnections) {
        if (!participants[id]) { closeP2P(id); document.getElementById(`card-${id}`)?.remove(); }
      }
      for (const id in participants) {
        if (id !== myId && !peerConnections[id]) {
          startP2P(id, localStream, (peerId, remoteStream) => { addVideoCard(peerId, participants[peerId].name, remoteStream); });
        }
      }
      updateGridClass();
    });

    listenChatMessages((msg) => {
      if (msg.image) {
        appendImageMessage(msg.sender, msg.image, msg.sender === currentUserName);
      } else {
        appendMessage(msg.sender, msg.text, msg.sender === currentUserName);
      }
    });

    listenPdfData((pdfData) => {
      const label = document.getElementById("pdfFileNameLabel");
      if (label) label.textContent = `共有中: ${pdfData.name}`;
      loadAndRenderPdf(pdfData.pdf, accessToken, pdfData.page);
    });
  });
}

function addVideoCard(id, name, stream) {
  if (!videoGrid || document.getElementById(`card-${id}`)) return;
  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `card-${id}`;
  card.innerHTML = `
    <div class="video-wrapper"><video autoplay playsinline></video></div>
    <div class="videoControlBar"><span class="videoName">${name}</span></div>
  `;
  setVideoSrc(card.querySelector("video"), stream);
  videoGrid.appendChild(card);
  updateGridClass();
}

function updateGridClass() {
  if (!videoGrid) return;
  videoGrid.className = "count-" + videoGrid.querySelectorAll(".videoCard").length;
}

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    tabButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    const targetTab = button.getAttribute("data-tab");
    tabContents.forEach(content => {
      content.classList.toggle("active", content.id === `tabContent-${targetTab}`);
    });
    if (targetTab === "chat") scrollToBottom();
    // 自動でサイズを変更する処理を完全排除
  });
});

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
  if (isMe) { bbl.style.backgroundColor = "#007bff"; bbl.style.color = "white"; }
  else { bbl.style.backgroundColor = "#e9ecef"; bbl.style.color = "#333"; }
  wrap.appendChild(bbl);
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

function appendImageMessage(sender, imageUrl, isMe=false){
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.margin = "8px 0";
  if(isMe) wrap.style.alignItems = "flex-end";

  const lbl = document.createElement("span");
  lbl.textContent = isMe ? "あなた" : sender;
  lbl.style.fontSize = "12px"; lbl.style.color = "#aaa"; lbl.style.marginBottom = "2px";
  wrap.appendChild(lbl);

  const img = document.createElement("img");
  img.src = imageUrl;
  img.className = "chat-image";
  img.onclick = () => {
    viewerImage.src = imageUrl;
    imageViewer.style.display = "flex";
  };

  wrap.appendChild(img);
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

function scrollToBottom() { if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; }
if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);
if (chatInput) chatInput.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && sendChatMessage());

imageBtn.addEventListener("click", () => { imageInput.click(); });
imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { sendImageMessageToFirebase(currentUserName, reader.result); };
  reader.readAsDataURL(file);
});

closeImageViewer.addEventListener("click", () => { imageViewer.style.display = "none"; });
imageViewer.addEventListener("click", (e) => {
  if(e.target === imageViewer) imageViewer.style.display = "none";
});

init();
