import { joinRoom, listenParticipants, myId, updateMyName, sendChatMessageToFirebase, listenChatMessages, sendPdfToFirebase, listenPdfData } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

let localStream = null;
let isJoined = false;
let currentUserName = "あなた";

// HTML要素の取得
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

// 右上のコントロールボタン類
const myCamBtn = document.getElementById("myCamBtn");
const myMicBtn = document.getElementById("myMicBtn");
const layoutToggleBtn = document.getElementById("layoutToggleBtn");
const appLayout = document.getElementById("appLayout");

const myCamStatus = document.getElementById("myCamStatus");
const myMicStatus = document.getElementById("myMicStatus");

// 設定モーダル関連
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const newNameInput = document.getElementById("newNameInput");
const updateNameBtn = document.getElementById("updateNameBtn");

// タブ・チャット関連
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatMessages = document.getElementById("chatMessages");

// ビデオ要素にストリームを設定するヘルパー
function setVideoSrc(videoElement, stream) {
  if (!videoElement) return;
  videoElement.srcObject = stream;
  videoElement.play().catch(err => console.log("ビデオ再生開始の待機中:", err));
}

// アプリの初期化
async function init() {
  // 入室画面が端末からはみ出さないように調整
  if (joinScreen) {
    joinScreen.style.display = "flex";
    joinScreen.style.flexDirection = "column";
    joinScreen.style.justifyContent = "center";
    joinScreen.style.alignItems = "center";
    joinScreen.style.minHeight = "100vh";
    joinScreen.style.padding = "10px";
    joinScreen.style.boxSizing = "border-box";
    joinScreen.style.overflowY = "auto";

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

    if (myPreviewVideo) {
      myPreviewVideo.style.maxWidth = "100%";
      myPreviewVideo.style.maxHeight = "200px"; 
      myPreviewVideo.style.borderRadius = "8px";
      myPreviewVideo.style.objectFit = "cover";
    }
  }

  // 【PDF共有をGoogleドライブのURL同期方式にアップグレード】
  if (tabContents && tabContents[1]) {
    const pdfTabArea = tabContents[1];
    pdfTabArea.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%; padding:10px; box-sizing:border-box;">
        <div style="margin-bottom:10px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <input type="text" id="driveUrlInput" placeholder="Googleドライブの共有リンク(URL)を貼り付け" style="flex:1; min-width:180px; padding:6px 10px; border:1px solid #555; border-radius:4px; background-color:#333; color:white; font-size:13px;">
          <button id="shareDriveUrlBtn" style="background-color:#007bff; color:white; padding:6px 14px; border:none; border-radius:4px; cursor:pointer; font-size:13px; font-weight:bold;">共有</button>
        </div>
        <div id="pdfFileNameLabel" style="font-size:11px; color:#aaa; margin-bottom:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">共有中のドライブURLはありません</div>
        <div id="pdfViewerWrapper" style="flex:1; border:2px dashed #444; border-radius:6px; display:flex; justify-content:center; align-items:center; overflow:hidden; background-color:#222; min-height:300px;">
          <p id="pdfPlaceholderText" style="color:#777; font-size:14px; text-align:center; padding:20px;">Googleドライブの共有URLを上に貼り付けて「共有」を押すと、ここに全ページ表示されます。<br>(各自で自由にめくったり拡大できます)</p>
        </div>
      </div>
    `;

    if (tabButtons && tabButtons[1]) {
      tabButtons[1].textContent = "PDF共有";
    }

    const shareDriveUrlBtn = document.getElementById("shareDriveUrlBtn");
    if (shareDriveUrlBtn) {
      shareDriveUrlBtn.addEventListener("click", handleDriveUrlShare);
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
  }
}

// ドライブのURLを共有ボタンを押した時の処理
async function handleDriveUrlShare() {
  const urlInput = document.getElementById("driveUrlInput");
  if (!urlInput) return;
  
  let url = urlInput.value.trim();
  if (!url) {
    alert("GoogleドライブのリンクURLを入力してください。");
    return;
  }

  // ドライブの通常URLを埋め込み用のプレビューURLへ自動変換する安全ロジック
  // 例: /file/d/XXXXX/view?usp=sharing -> /file/d/XXXXX/preview
  if (url.includes("drive.google.com")) {
    if (url.includes("/view")) {
      url = url.split("/view")[0] + "/preview";
    } else if (!url.endsWith("/preview") && url.includes("/file/d/")) {
      url = url.split("?")[0];
      if (!url.endsWith("/preview")) {
        url = url + "/preview";
      }
    }
  }

  try {
    // 既存のFirebase関数（sendPdfToFirebase）の第一引数にURLをそのままのせて全員へ同期
    await sendPdfToFirebase(url, "Googleドライブの共有資料");
    urlInput.value = ""; // 入力欄をクリア
  } catch(err) {
    console.error(err);
    alert("URLの共有に失敗しました。");
  }
}

// Firebaseから同期されたURLを受け取ってiframeに全ページ綺麗に表示
function renderPdfBlob(sharedUrlOrBase64, fileName, senderId) {
  const wrapper = document.getElementById("pdfViewerWrapper");
  const label = document.getElementById("pdfFileNameLabel");
  if (!wrapper) return;

  // データがGoogleドライブのURLか、古いBase64形式のデータかを判別して安全に処理
  let targetSrc = sharedUrlOrBase64;

  if (sharedUrlOrBase64.startsWith("data:application/pdf") || !sharedUrlOrBase64.startsWith("http")) {
    // もし古いBase64データが飛んできた場合の、前バージョンとの互換性用処理
    try {
      const byteCharacters = atob(sharedUrlOrBase64.split(",")[1]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      targetSrc = URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
      return;
    }
  }

  if (label) {
    label.textContent = "共有元: " + (senderId === myId ? "あなた" : "他のユーザー");
  }

  // Googleドライブのプレビュー画面（全ページ、スクロール、拡大可能）を完全埋め込み
  wrapper.innerHTML = `<iframe src="${targetSrc}" style="width:100%; height:100%; border:none; background-color:#fff;" allow="fullscreen"></iframe>`;
  wrapper.style.border = "none";
}

// デバイス（カメラ・マイク）切り替え処理
async function handleDeviceChange() {
  if (!localStream) return;
  localStream.getTracks().forEach(track => { try { track.stop(); } catch(err) {} });
  localStream = null;

  try {
    const targetCam = cameraSelect?.value || null;
    const targetMic = micSelect?.value || null;
    const newStream = await getLocalStream(targetCam, targetMic);
    localStream = newStream;
    
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

// 右上の各操作ボタンのクリックイベント（完全保護）
if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    if (settingsModal) settingsModal.style.display = "flex";
  });
}
if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener("click", () => {
    if (settingsModal) settingsModal.style.display = "none";
  });
}

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

// 部屋に参加する処理
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

    // リアルタイム参加者監視
    listenParticipants((participants) => {
      for (const id in peerConnections) {
        if (!participants[id]) {
          closeP2P(id);
          document.getElementById(`card-${id}`)?.remove();
        }
      }
      for (const id in participants) {
        if (id !== myId && !peerConnections[id]) {
          startP2P(id, localStream, (peerId, remoteStream) => { addVideoCard(peerId, participants[peerId].name, remoteStream); });
        }
      }
      updateGridClass();
    });

    // チャット受信監視
    listenChatMessages((sender, text) => {
      appendMessage(sender, text, sender === currentUserName);
    });

    // PDFリンク受信監視
    listenPdfData((base64OrUrl, fileName, senderId) => {
      renderPdfBlob(base64OrUrl, fileName, senderId);
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

// タブ切り替え処理
tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    tabButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    const targetTab = button.getAttribute("data-tab");
    tabContents.forEach(content => {
      content.classList.toggle("active", content.id === `tabContent-${targetTab}`);
    });
    if (targetTab === "chat") scrollToBottom();
  });
});

// チャット送信
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
    bbl.style.backgroundColor = "#007bff"; bbl.style.color = "white";
  } else {
    bbl.style.backgroundColor = "#e9ecef"; bbl.style.color = "#333";
  }
  wrap.appendChild(bbl);
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

function scrollToBottom() { if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; }
if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);
if (chatInput) chatInput.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && sendChatMessage());

init();
