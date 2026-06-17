import { joinRoom, listenParticipants, myId, updateMyName, sendChatMessageToFirebase, listenChatMessages, sendPdfToFirebase, listenPdfData } from "./room.js";
import { getLocalStream, updateDeviceList } from "./devices.js";
import { startP2P, closeP2P, peerConnections } from "./webrtc.js";

// ==========================================
// Google Drive Picker API の設定値
// ==========================================
const DEVELOPER_KEY = "AIzaSyCYJ-LkqWiTLlH-M8IICl6SGLC-OmJmg_8"; 
const CLIENT_ID = "421359626063-r6e12ki8834lsvp2kcqevqf3g2h64kd7.apps.googleusercontent.com";
const APP_ID = "421359626063";

// ドライブ選択画面に必要なスコープ
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

let accessToken = null;
let gapiInited = false;

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

// Google APIライブラリの読み込み関数
function loadGoogleLibraries() {
  return new Promise((resolve) => {
    if (gapiInited) {
      resolve(true);
      return;
    }
    if (typeof gapi === 'undefined') {
      console.error("gapiライブラリがindex.htmlで読み込まれていません");
      resolve(false);
      return;
    }
    gapi.load('client:picker', () => {
      gapiInited = true;
      resolve(true);
    });
  });
}

// アプリの初期化
async function init() {
  // 入室画面のレイアウト崩れ防止
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

  // 【PDF共有タブのUI構築：アカウント切替ボタンも完全搭載】
  if (tabContents && tabContents[1]) {
    const pdfTabArea = tabContents[1];
    pdfTabArea.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%; padding:10px; box-sizing:border-box;">
        <div style="margin-bottom:10px; display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
          <button id="openDrivePickerBtn" style="background-color:#25a15a; color:white; padding:8px 16px; border:none; border-radius:4px; cursor:pointer; font-size:14px; font-weight:bold; display:flex; align-items:center; gap:8px;">
            📁 GoogleドライブからPDFを選択
          </button>
          <button id="switchAccountBtn" style="background-color:#dc3545; color:white; padding:8px 12px; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:4px;">
            🔄 アカウントを切り替える
          </button>
        </div>
        <div id="pdfFileNameLabel" style="font-size:12px; color:#aaa; margin-bottom:6px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">共有中の資料はありません</div>
        <div id="pdfViewerWrapper" style="flex:1; border:2px dashed #444; border-radius:6px; display:flex; justify-content:center; align-items:center; overflow:hidden; background-color:#222; min-height:300px;">
          <p id="pdfPlaceholderText" style="color:#777; font-size:14px; text-align:center; padding:20px;">上のボタンからGoogleドライブのフォルダ・ファイルを開いてPDFを共有できます。<br>(共有後は全員の画面で全ページ自由にスクロール・拡大できます)</p>
        </div>
      </div>
    `;

    if (tabButtons && tabButtons[1]) {
      tabButtons[1].textContent = "PDF共有";
    }

    const openDrivePickerBtn = document.getElementById("openDrivePickerBtn");
    if (openDrivePickerBtn) {
      openDrivePickerBtn.addEventListener("click", handleDrivePickerOpen);
    }

    const switchAccountBtn = document.getElementById("switchAccountBtn");
    if (switchAccountBtn) {
      switchAccountBtn.addEventListener("click", handleSwitchAccount);
    }
  }

  // バックグラウンドで初期ライブラリロードを試みる
  await loadGoogleLibraries();

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

// ==========================================
// Googleドライブの選択ポップアップ制御（無反応対策強化版）
// ==========================================
async function handleDrivePickerOpen() {
  // ボタンが押された瞬間に、Googleライブラリが本当に準備できているか再チェック＆強制起動
  const ready = await loadGoogleLibraries();
  if (!ready || typeof google === 'undefined') {
    alert("Googleのシステムを読み込み中です。3秒ほど待ってからもう一度押してください。");
    return;
  }

  if (!accessToken) {
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: 'select_account', 
        callback: async (response) => {
          if (response.error !== undefined) {
            throw response;
          }
          accessToken = response.access_token;
          createPicker();
        },
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      console.error("Google認証エラー:", err);
      alert("認証画面の起動に失敗しました。");
    }
  } else {
    createPicker();
  }
}

// アカウントの切り替え処理
function handleSwitchAccount() {
  if (accessToken) {
    try {
      google.accounts.oauth2.revokeToken(accessToken, () => {
        accessToken = null;
        alert("ログイン状態をクリアしました！もう一度「PDFを選択」を押すとアカウントを選び直せます。");
      });
    } catch (err) {
      console.error("トークン解除エラー:", err);
      accessToken = null;
    }
  } else {
    accessToken = null;
    alert("ログイン状態はすでにクリアされています。そのまま「PDFを選択」を押して別のアカウントを選んでください。");
  }
}

// ピッカー選択画面の作成・表示
function createPicker() {
  if (!gapiInited || !accessToken) {
    alert("Googleドライブの準備がまだ完了していません。もう一度お試しください。");
    return;
  }
  
  try {
    const docsView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/pdf") 
      .setSelectFolderEnabled(false)   
      .setShowFolders(true);           

    const picker = new google.picker.PickerBuilder()
      .addView(docsView)
      .setOAuthToken(accessToken)
      .setDeveloperKey(DEVELOPER_KEY)
      .setAppId(APP_ID)
      .setCallback(pickerCallback)
      .build();
      
    picker.setVisible(true);
  } catch (err) {
    console.error("Picker起動エラー:", err);
    alert("ファイル選択画面を開けませんでした。APIキーの制限設定などをご確認ください。");
  }
}

// ユーザーがドライブ上のPDFファイルを選んだ時の処理
async function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const doc = data.docs[0];
    const fileId = doc.id;
    const fileName = doc.name;
    
    const embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    
    try {
      await sendPdfToFirebase(embedUrl, fileName);
    } catch (err) {
      console.error("Firebaseへの同期に失敗:", err);
      alert("共有に失敗しました。");
    }
  }
}

// Firebaseから共有URLを受信してiframeに描写
function renderPdfBlob(sharedUrl, fileName, senderId) {
  const wrapper = document.getElementById("pdfViewerWrapper");
  const label = document.getElementById("pdfFileNameLabel");
  if (!wrapper) return;

  if (label) {
    label.textContent = `共有中: ${fileName} (${senderId === myId ? "あなた" : "他のユーザー"})`;
  }

  wrapper.innerHTML = `<iframe src="${sharedUrl}" style="width:100%; height:100%; border:none; background-color:#fff;" allow="fullscreen"></iframe>`;
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

// 右上の操作コントロールボタン（完全保護）
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

// 入室処理
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

    // 参加者監視
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

    // チャット監視
    listenChatMessages((sender, text) => {
      appendMessage(sender, text, sender === currentUserName);
    });

    // PDFリンクリアルタイム監視
    listenPdfData((sharedUrl, fileName, senderId) => {
      renderPdfBlob(sharedUrl, fileName, senderId);
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

// タブ制御
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

// チャット
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
