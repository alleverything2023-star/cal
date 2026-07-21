import { myId, shareYoutubeVideo, updateYoutubeState, stopYoutubeShare, listenYoutubeData } from "./room.js";

// ※ Google Cloud の同一プロジェクトのAPIキーを再利用しています。
// このキーに対して「YouTube Data API v3」を有効化しないと検索は動作しません。
const YOUTUBE_API_KEY = "AIzaSyBDbYUZ_PHXnMQPwaIABfYToc2y6YbWwRI";

// YouTube Data API v3 のデフォルト割当(1日10,000ユニット)を、検索1回=100ユニットで割った目安値
const DAILY_SEARCH_LIMIT = 100;
const QUOTA_STORAGE_KEY = "ytSearchQuotaState";

// DOM参照（initYoutubeFeature内で取得）
let linkInput, loadLinkBtn, searchInput, searchBtn, quotaLabelEl, searchResultsEl;
let shareToggleBtn, shareStatusText, noVideoLabel, sharingPlaceholderEl;

// プレイヤー・同期関連の状態
// ※タブ内プレビュー用（ytPlayer）とグリッド共有表示用（ytGridPlayer）は
//   完全に別インスタンスとして扱う。DOM間で同じiframeを移動(reparent)すると
//   Safari/iPadOSや一部のタブレット・Androidブラウザでiframeが強制リロードされ、
//   再読み込み失敗や他端末でのプレイヤーエラー表示の原因になるため。
let ytApiReadyPromise = null;
let ytPlayer = null;          // タブ内プレビュー用（常に同じ場所にマウントしたまま使い回す）
let ytGridPlayer = null;      // グリッド共有表示用（共有開始のたびに作り直す）
let currentVideoId = null;    // タブ側で選択中の動画ID
let gridVideoId = null;       // グリッド側で現在再生中の動画ID
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
   タブ内プレビュー用プレイヤーの生成・動画差し替え
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
        }
      }
    });
  });
}

/* ========================================================
   グリッド共有用プレイヤーの生成・破棄
   ※ 同じiframeを使い回さず、共有セッションが変わるたびに
     破棄してから新しく作り直す（古い状態を引きずらないため）
   ======================================================== */
function destroyGridPlayer() {
  if (ytGridPlayer && typeof ytGridPlayer.destroy === "function") {
    try { ytGridPlayer.destroy(); } catch (e) {}
  }
  ytGridPlayer = null;
}

function rebuildGridCard() {
  destroyGridPlayer();

  const grid = document.getElementById("videoGrid");
  if (!grid) return;

  const old = document.getElementById("card-youtube");
  if (old) old.remove();

  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = "card-youtube";
  card.innerHTML = `
    <div class="video-wrapper">
      <div id="youtubeGridPlayerMount"></div>
    </div>
    <div class="videoControlBar">
      <span class="videoName">📺 YouTube（共有中）</span>
    </div>
  `;
  grid.appendChild(card);
  updateGridCountClass();
}

async function ensureGridPlayer(videoId) {
  await loadYoutubeIframeApi();

  const mount = document.getElementById("youtubeGridPlayerMount");
  if (!mount) return null;

  return new Promise((resolve) => {
    ytGridPlayer = new YT.Player(mount, {
      videoId: videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          gridVideoId = videoId;
          resolve(ytGridPlayer);
        },
        onStateChange: handleGridPlayerStateChange
      }
    });
  });
}

function teardownGridShare() {
  destroyGridPlayer();
  gridVideoId = null;
  const card = document.getElementById("card-youtube");
  if (card) {
    card.remove();
    updateGridCountClass();
  }
  hideSharingPlaceholderInTab();
}

function handleGridPlayerStateChange(event) {
  if (suppressSync) return;
  if (!isSharing) return;

  const state = event.data;
  if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED) {
    let time = 0;
    try { time = ytGridPlayer.getCurrentTime(); } catch (e) {}
    updateYoutubeState({
      playing: state === YT.PlayerState.PLAYING,
      time: time
    });
  }
}

/* ========================================================
   ビデオグリッドの列数クラス更新
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

/* ========================================================
   タブ側表示の切り替え（共有中プレースホルダー ⇔ 通常プレビュー）
   共有中は音声が二重に流れないよう、タブ側プレイヤーは一時停止して隠す
   ======================================================== */
function showSharingPlaceholderInTab() {
  if (sharingPlaceholderEl) sharingPlaceholderEl.style.display = "flex";
  if (noVideoLabel) noVideoLabel.style.display = "none";
  if (ytPlayer && typeof ytPlayer.pauseVideo === "function") {
    try { ytPlayer.pauseVideo(); } catch (e) {}
  }
}

function hideSharingPlaceholderInTab() {
  if (sharingPlaceholderEl) sharingPlaceholderEl.style.display = "none";
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
   ※グリッド共有用プレイヤーに対して適用する
   ======================================================== */
function applyRemoteState(data) {
  if (!ytGridPlayer || typeof ytGridPlayer.getPlayerState !== "function") return;

  const elapsedSinceUpdate = data.playing ? (Date.now() - (data.updatedAt || Date.now())) / 1000 : 0;
  const targetTime = Math.max(0, (data.time || 0) + elapsedSinceUpdate);

  let current = 0;
  try { current = ytGridPlayer.getCurrentTime(); } catch (e) {}
  const drift = Math.abs(current - targetTime);

  suppressSync = true;
  try {
    if (drift > 1.5) {
      ytGridPlayer.seekTo(targetTime, true);
    }
    if (data.playing) {
      ytGridPlayer.playVideo();
    } else {
      ytGridPlayer.pauseVideo();
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
  if (!isSharing && noVideoLabel) noVideoLabel.style.display = "none";

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
      const reason = data && data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
      const rawMessage = (data && data.error && data.error.message) || "";
      let message = "検索に失敗しました（APIキーの設定をご確認ください）";
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        message = "検索に失敗しました（Google Cloud側のAPIクォータ上限に達しています）";
      } else if (reason === "accessNotConfigured" || reason === "forbidden") {
        message = "検索に失敗しました（YouTube Data API v3が有効化されていないか、アクセスが許可されていません）";
      } else if (reason === "keyInvalid" || reason === "badRequest") {
        message = "検索に失敗しました（APIキーが無効か、設定に誤りがあります）";
      } else if (reason === "ipRefererBlocked" || reason === "refererNotAllowed") {
        message = "検索に失敗しました（APIキーのHTTPリファラー制限で、このサイトからのアクセスが許可されていません）";
      }
      if (searchResultsEl) {
        searchResultsEl.innerHTML = `
          <div class="yt-search-error">${escapeHtml(message)}</div>
          <div class="yt-search-error-detail">status: ${res.status}${reason ? " / reason: " + escapeHtml(reason) : ""}${rawMessage ? "<br>" + escapeHtml(rawMessage) : ""}</div>
        `;
      }
      return;
    }

    renderSearchResults(data.items || []);
  } catch (err) {
    console.error(err);
    if (searchResultsEl) {
      searchResultsEl.innerHTML = `
        <div class="yt-search-error">検索中にエラーが発生しました</div>
        <div class="yt-search-error-detail">${escapeHtml((err && err.message) || String(err))}</div>
      `;
    }
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
    if (!isSharing || !ytGridPlayer || !latestRemoteState) return;
    if (latestRemoteState.senderId !== myId) return; // 共有開始者だけが補正を送る
    if (typeof ytGridPlayer.getPlayerState !== "function") return;
    if (ytGridPlayer.getPlayerState() !== YT.PlayerState.PLAYING) return;

    let time = 0;
    try { time = ytGridPlayer.getCurrentTime(); } catch (e) { return; }
    updateYoutubeState({ playing: true, time: time });
  }, 4000);
}

/* ========================================================
   初期化
   ======================================================== */
export function initYoutubeFeature() {
  try {
    linkInput = document.getElementById("youtubeLinkInput");
    loadLinkBtn = document.getElementById("youtubeLoadLinkBtn");
    searchInput = document.getElementById("youtubeSearchInput");
    searchBtn = document.getElementById("youtubeSearchBtn");
    quotaLabelEl = document.getElementById("youtubeQuotaLabel");
    searchResultsEl = document.getElementById("youtubeSearchResults");
    shareToggleBtn = document.getElementById("youtubeShareToggleBtn");
    shareStatusText = document.getElementById("youtubeShareStatusText");
    noVideoLabel = document.getElementById("youtubeNoVideoLabel");
    sharingPlaceholderEl = document.getElementById("youtubeSharingPlaceholder");

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
      try {
        if (!data) {
          isSharing = false;
          latestRemoteState = null;
          updateShareToggleUI(false);
          teardownGridShare();
          return;
        }

        // 新しい共有セッションの開始か、共有中に動画が差し替わった場合のみ
        // グリッド側プレイヤーを破棄して作り直す（継続中の再生/一時停止/シークだけなら作り直さない）
        const isNewSession = !isSharing || gridVideoId !== data.videoId;

        latestRemoteState = data;
        isSharing = true;
        updateShareToggleUI(true);
        showSharingPlaceholderInTab();

        if (isNewSession) {
          // 先にgridVideoIdを確定させておく。ensureGridPlayer()の完了(非同期)を待つ前に
          // 短時間で複数回コールバックが発火しても、二重に作り直さないようにするため。
          gridVideoId = data.videoId;
          rebuildGridCard();
          await ensureGridPlayer(data.videoId);
        }

        applyRemoteState(data);
      } catch (err) {
        console.error("YouTube共有データの反映に失敗しました", err);
      }
    });

    startHeartbeat();
  } catch (err) {
    console.error("YouTube機能のセットアップに失敗しました", err);
  }
}
