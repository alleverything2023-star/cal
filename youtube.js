import { myId, shareYoutubeVideo, updateYoutubeState, stopYoutubeShare, listenYoutubeData } from "./room.js";

// ※ Google Cloud の同一プロジェクトのAPIキーを再利用しています。
// このキーに対して「YouTube Data API v3」を有効化しないと検索は動作しません。
const YOUTUBE_API_KEY = "AIzaSyCYJ-LkqWiTLlH-M8IICl6SGLC-OmJmg_8";

// YouTube Data API v3 のデフォルト割当(1日10,000ユニット)を、検索1回=100ユニットで割った目安値
const DAILY_SEARCH_LIMIT = 100;
const QUOTA_STORAGE_KEY = "ytSearchQuotaState";

// DOM参照（initYoutubeFeature内で取得）
let linkInput, loadLinkBtn, searchInput, searchBtn, quotaLabelEl, searchResultsEl;
let shareToggleBtn, shareStatusText, noVideoLabel;

// プレイヤー・同期関連の状態
let ytApiReadyPromise = null;
let ytPlayer = null;
let currentVideoId = null;
let isSharing = false;
let suppressSync = false;
let latestRemoteState = null;

/* ========================================================
   YouTube IFrame API のロード
   ======================================================== */
function loadYoutubeIframeApi() {
  if (ytApiReadyPromise) return ytApiReadyPromise;

  ytApiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === "function") previousCallback();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });

  return ytApiReadyPromise;
}

/* ========================================================
   プレイヤーの生成・動画差し替え
   ======================================================== */
async function ensurePlayer(videoId) {
  await loadYoutubeIframeApi();

  if (ytPlayer && typeof ytPlayer.cueVideoById === "function") {
    if (currentVideoId !== videoId) {
      currentVideoId = videoId;
      ytPlayer.cueVideoById(videoId);
    }
    return ytPlayer;
  }

  return new Promise((resolve) => {
    ytPlayer = new YT.Player("youtubePlayerMount", {
      videoId: videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          currentVideoId = videoId;
          resolve(ytPlayer);
        },
        onStateChange: handlePlayerStateChange
      }
    });
  });
}

function handlePlayerStateChange(event) {
  if (suppressSync) return;
  if (!isSharing) return; // 共有していない間はローカルプレビューのみで同期は行わない

  const state = event.data;
  if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED) {
    let time = 0;
    try { time = ytPlayer.getCurrentTime(); } catch (e) {}
    updateYoutubeState({
      playing: state === YT.PlayerState.PLAYING,
      time: time
    });
  }
}

/* ========================================================
   動画エリアの表示場所切り替え（タブ内 ⇔ ビデオグリッド内）
   ======================================================== */
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

function movePlayerIntoGrid() {
  const grid = document.getElementById("videoGrid");
  const wrapper = document.getElementById("youtubePlayerWrapper");
  if (!grid || !wrapper) return;

  let card = document.getElementById("card-youtube");
  if (!card) {
    card = document.createElement("div");
    card.className = "videoCard";
    card.id = "card-youtube";
    card.innerHTML = `
      <div class="video-wrapper" id="youtubeGridWrapper"></div>
      <div class="videoControlBar">
        <span class="videoName">📺 YouTube（共有中）</span>
      </div>
    `;
    grid.appendChild(card);
    updateGridCountClass();
  }

  const gridWrapper = document.getElementById("youtubeGridWrapper");
  if (gridWrapper && wrapper.parentElement !== gridWrapper) {
    gridWrapper.appendChild(wrapper);
  }
  if (noVideoLabel) noVideoLabel.style.display = "none";
}

function movePlayerBackToTab() {
  const card = document.getElementById("card-youtube");
  if (card) {
    card.remove();
    updateGridCountClass();
  }

  const displayArea = document.getElementById("youtubeVideoDisplayArea");
  const wrapper = document.getElementById("youtubePlayerWrapper");
  if (displayArea && wrapper && wrapper.parentElement !== displayArea) {
    displayArea.insertBefore(wrapper, displayArea.firstChild);
  }
  if (noVideoLabel) noVideoLabel.style.display = currentVideoId ? "none" : "flex";
}

/* ========================================================
   共有トグルUIの見た目更新
   ======================================================== */
function updateShareToggleUI(on) {
  if (shareToggleBtn) {
    shareToggleBtn.classList.toggle("on", on);
    shareToggleBtn.setAttribute("aria-checked", on ? "true" : "false");
  }
  if (shareStatusText) {
    shareStatusText.textContent = on ? "オン（全員が視聴中）" : "オフ（自分だけ）";
  }
}

/* ========================================================
   リモート状態への追従（再生位置・再生/一時停止の同期）
   ======================================================== */
function applyRemoteState(data) {
  if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") return;

  const elapsedSinceUpdate = data.playing ? (Date.now() - (data.updatedAt || Date.now())) / 1000 : 0;
  const targetTime = Math.max(0, (data.time || 0) + elapsedSinceUpdate);

  let current = 0;
  try { current = ytPlayer.getCurrentTime(); } catch (e) {}
  const drift = Math.abs(current - targetTime);

  suppressSync = true;
  try {
    if (drift > 1.5) {
      ytPlayer.seekTo(targetTime, true);
    }
    if (data.playing) {
      ytPlayer.playVideo();
    } else {
      ytPlayer.pauseVideo();
    }
  } catch (e) {
    console.error("YouTube再生状態の同期に失敗しました", e);
  }
  setTimeout(() => { suppressSync = false; }, 600);
}

/* ========================================================
   動画の選択（検索結果クリック／リンク読込 共通処理）
   ======================================================== */
async function selectVideo(videoId) {
  if (!videoId) return;
  currentVideoId = videoId;
  await ensurePlayer(videoId);
  if (noVideoLabel) noVideoLabel.style.display = "none";

  // 共有中に動画を変更した場合は、共有内容も新しい動画に差し替える
  if (isSharing) {
    await shareYoutubeVideo(videoId, 0, true);
  }
}

/* ========================================================
   URLからvideoIdを抽出
   ======================================================== */
function extractVideoId(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    }
  } catch (e) {
    // URLとして解釈できない場合はフォールバックへ
  }
  // IDだけが貼り付けられた場合等のフォールバック
  const match = trimmed.match(/[a-zA-Z0-9_-]{11}/);
  return match ? match[0] : null;
}

/* ========================================================
   検索回数クオータ（1日あたり）
   ======================================================== */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getQuotaState() {
  let state = null;
  try {
    state = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) || "null");
  } catch (e) {}
  if (!state || state.date !== todayStr()) {
    state = { date: todayStr(), remaining: DAILY_SEARCH_LIMIT };
    saveQuotaState(state);
  }
  return state;
}

function saveQuotaState(state) {
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function decrementQuota() {
  const state = getQuotaState();
  state.remaining = Math.max(0, state.remaining - 1);
  saveQuotaState(state);
  updateQuotaLabel();
}

function updateQuotaLabel() {
  const state = getQuotaState();
  if (quotaLabelEl) quotaLabelEl.textContent = `本日の検索: あと${state.remaining}回`;
}

/* ========================================================
   検索処理
   ======================================================== */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function renderSearchResults(items) {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = "";

  if (!items || items.length === 0) {
    searchResultsEl.innerHTML = `<div class="yt-search-empty">見つかりませんでした</div>`;
    return;
  }

  items.forEach((item) => {
    const videoId = item.id && item.id.videoId;
    if (!videoId) return;
    const title = (item.snippet && item.snippet.title) || "";
    const thumb = (item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.default && item.snippet.thumbnails.default.url) || "";

    const row = document.createElement("div");
    row.className = "yt-search-result-item";
    row.innerHTML = `
      <img src="${thumb}" alt="" class="yt-thumb" loading="lazy">
      <span class="yt-result-title">${escapeHtml(title)}</span>
    `;
    row.addEventListener("click", () => selectVideo(videoId));
    searchResultsEl.appendChild(row);
  });
}

async function performSearch(query) {
  const q = (query || "").trim();
  if (!q) return;

  const quota = getQuotaState();
  if (quota.remaining <= 0) {
    alert("本日のYouTube検索回数の上限に達しました。日付が変わるとリセットされます。");
    return;
  }

  if (searchResultsEl) searchResultsEl.innerHTML = `<div class="yt-search-loading">検索中...</div>`;

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&type=video&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    decrementQuota();

    if (!res.ok) {
      console.error("YouTube検索エラー", data);
      if (searchResultsEl) searchResultsEl.innerHTML = `<div class="yt-search-error">検索に失敗しました（APIキーの設定をご確認ください）</div>`;
      return;
    }

    renderSearchResults(data.items || []);
  } catch (err) {
    console.error(err);
    if (searchResultsEl) searchResultsEl.innerHTML = `<div class="yt-search-error">検索中にエラーが発生しました</div>`;
  }
}

/* ========================================================
   共有トグルのクリック処理
   ======================================================== */
async function handleShareToggleClick() {
  if (isSharing) {
    await stopYoutubeShare();
    // 実際のUI更新はlistenYoutubeDataのコールバック経由で行われる
    return;
  }

  if (!currentVideoId) {
    alert("先に動画を選択してください（検索するか、URLを読み込んでください）");
    return;
  }

  let time = 0;
  if (ytPlayer && typeof ytPlayer.getCurrentTime === "function") {
    try { time = ytPlayer.getCurrentTime() || 0; } catch (e) {}
  }

  await shareYoutubeVideo(currentVideoId, time, true);
}

/* ========================================================
   定期的な再生位置補正（共有開始者のみが送信）
   ======================================================== */
function startHeartbeat() {
  setInterval(() => {
    if (!isSharing || !ytPlayer || !latestRemoteState) return;
    if (latestRemoteState.senderId !== myId) return; // 共有開始者だけが補正を送る
    if (typeof ytPlayer.getPlayerState !== "function") return;
    if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) return;

    let time = 0;
    try { time = ytPlayer.getCurrentTime(); } catch (e) { return; }
    updateYoutubeState({ playing: true, time: time });
  }, 4000);
}

/* ========================================================
   初期化
   ======================================================== */
export function initYoutubeFeature() {
  linkInput = document.getElementById("youtubeLinkInput");
  loadLinkBtn = document.getElementById("youtubeLoadLinkBtn");
  searchInput = document.getElementById("youtubeSearchInput");
  searchBtn = document.getElementById("youtubeSearchBtn");
  quotaLabelEl = document.getElementById("youtubeQuotaLabel");
  searchResultsEl = document.getElementById("youtubeSearchResults");
  shareToggleBtn = document.getElementById("youtubeShareToggleBtn");
  shareStatusText = document.getElementById("youtubeShareStatusText");
  noVideoLabel = document.getElementById("youtubeNoVideoLabel");

  updateQuotaLabel();

  if (loadLinkBtn) {
    loadLinkBtn.addEventListener("click", () => {
      if (!linkInput) return;
      const raw = linkInput.value.trim();
      if (!raw) return;
      const videoId = extractVideoId(raw);
      if (!videoId) {
        alert("YouTubeのURLを正しく認識できませんでした");
        return;
      }
      selectVideo(videoId);
      linkInput.value = "";
    });
  }
  if (linkInput) {
    linkInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) loadLinkBtn.click();
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", () => performSearch(searchInput ? searchInput.value : ""));
  }
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) performSearch(searchInput.value);
    });
  }

  if (shareToggleBtn) {
    shareToggleBtn.addEventListener("click", handleShareToggleClick);
  }

  listenYoutubeData(async (data) => {
    if (!data) {
      isSharing = false;
      latestRemoteState = null;
      updateShareToggleUI(false);
      movePlayerBackToTab();
      if (ytPlayer && typeof ytPlayer.pauseVideo === "function") {
        suppressSync = true;
        try { ytPlayer.pauseVideo(); } catch (e) {}
        setTimeout(() => { suppressSync = false; }, 300);
      }
      return;
    }

    latestRemoteState = data;
    isSharing = true;
    updateShareToggleUI(true);

    await ensurePlayer(data.videoId);
    movePlayerIntoGrid();
    applyRemoteState(data);
  });

  startHeartbeat();
}
