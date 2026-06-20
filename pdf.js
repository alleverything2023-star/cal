import { saveStrokeToFirebase, listenStrokes, clearStrokesInFirebase, updatePdfPageInFirebase } from "./room.js";

let pdfDoc = null;
let currentPage = 1;
let pdfScale = 1.0;
let currentPdfUrl = null;
let currentToken = null;

const pdfCanvas = document.getElementById("pdfCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const pdfScrollContainer = document.getElementById("pdfScrollContainer");
const pageInfo = document.getElementById("pageInfo");

const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomLabel = document.getElementById("zoomLabel");

// 新しいツールバー要素
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");
const brushColorInput = document.getElementById("brushColor");
const brushSizeInput = document.getElementById("brushSize");
const sizeLabel = document.getElementById("sizeLabel");
const clearBtn = document.getElementById("clearBtn");

const drawCtx = drawCanvas ? drawCanvas.getContext("2d") : null;
let drawing = false;
let currentStroke = [];

// 初期状態はどちらも選択されていない状態 (none = 閲覧モード)
let mode = "none"; 

// 【新規追加】スクロール・ズーム（ピンチイン・アウト）を禁止するイベントリスナー
function preventScrollAndZoom(e) {
  if (mode === "pen" || mode === "eraser") {
    e.preventDefault();
  }
}

// モード変更時にスクロール可否のスタイルを切り替える関数
function updateScrollLock() {
  if (!pdfScrollContainer) return;
  if (mode === "pen" || mode === "eraser") {
    // ペン・消しゴム使用時はスクロールバーを隠し、スクロールをロック
    pdfScrollContainer.style.overflow = "hidden";
  } else {
    // 未使用時は通常のスクロールを許可
    pdfScrollContainer.style.overflow = "auto";
  }
}

// タッチ操作による画面移動やピンチズームを禁止（ペン・消しゴム使用時のみ発動）
if (pdfScrollContainer) {
  pdfScrollContainer.addEventListener("wheel", (e) => {
    // Ctrlキーを押しながらのホイール（ブラウザ標準のズーム）も禁止
    if (e.ctrlKey && (mode === "pen" || mode === "eraser")) {
      e.preventDefault();
    }
  }, { passive: false });

  pdfScrollContainer.addEventListener("touchmove", preventScrollAndZoom, { passive: false });
  pdfScrollContainer.addEventListener("pointermove", (e) => {
    if ((mode === "pen" || mode === "eraser") && e.pointerType === "touch") {
      // タッチイベントによる誤動作防止
    }
  }, { passive: false });
}

// ツールバーのインタラクション制御
if (penBtn && eraserBtn) {
  penBtn.onclick = () => {
    if (mode === "pen") {
      mode = "none";
      penBtn.classList.remove("active");
    } else {
      mode = "pen";
      penBtn.classList.add("active");
      eraserBtn.classList.remove("active");
    }
    updateScrollLock(); // ロック状態を更新
  };

  eraserBtn.onclick = () => {
    if (mode === "eraser") {
      mode = "none";
      eraserBtn.classList.remove("active");
    } else {
      mode = "eraser";
      eraserBtn.classList.add("active");
      penBtn.classList.remove("active");
    }
    updateScrollLock(); // ロック状態を更新
  };
}

if (brushSizeInput && sizeLabel) {
  brushSizeInput.oninput = (e) => {
    sizeLabel.textContent = e.target.value;
  };
}

let localStrokesArray = [];

export async function loadAndRenderPdf(pdfUrlOrBase64, token = null) {
  currentPdfUrl = pdfUrlOrBase64;
  currentToken = token;
  
  if (!window.pdfjsLib) {
    console.error("pdfjsLib がロードされていません。");
    return;
  }

  try {
    let loadingTask;
    if (token) {
      loadingTask = window.pdfjsLib.getDocument({
        url: pdfUrlOrBase64,
        httpHeaders: { 'Authorization': 'Bearer ' + token }
      });
    } else {
      loadingTask = window.pdfjsLib.getDocument(pdfUrlOrBase64);
    }

    pdfDoc = await loadingTask.promise;
    currentPage = 1;
    await renderCurrentPage();
  } catch (err) {
    console.error("PDF読み込み失敗:", err);
  }
}

export async function renderCurrentPage() {
  if (!pdfDoc || !pdfCanvas || !drawCanvas) return;

  try {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: pdfScale });

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;

    const renderContext = {
      canvasContext: pdfCanvas.getContext("2d"),
      viewport: viewport
    };
    await page.render(renderContext).promise;

    if (pageInfo) {
      pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
    }

    setupFirebaseStrokeListener();
  } catch (err) {
    console.error("ページ描画失敗:", err);
  }
}

// 拡大ボタン（ペン・消しゴム使用時は動作しないように制限）
if (zoomInBtn) {
  zoomInBtn.onclick = async () => {
    if (mode === "pen" || mode === "eraser") return; // 使用中は無効化
    if (pdfScale >= 3.0) return;
    pdfScale += 0.2;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfScale * 100)}%`;
    await renderCurrentPage();
    redrawAllStrokesLocal();
  };
}

// 縮小ボタン（ペン・消しゴム使用時は動作しないように制限）
if (zoomOutBtn) {
  zoomOutBtn.onclick = async () => {
    if (mode === "pen" || mode === "eraser") return; // 使用中は無効化
    if (pdfScale <= 0.5) return;
    pdfScale -= 0.2;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfScale * 100)}%`;
    await renderCurrentPage();
    redrawAllStrokesLocal();
  };
}

export async function changePage(offset) {
  if (!pdfDoc) return;
  const newPage = currentPage + offset;
  if (newPage < 1 || newPage > pdfDoc.numPages) return;
  currentPage = newPage;
  updatePdfPageInFirebase(currentPage);
  await renderCurrentPage();
}

// 他のユーザーがページを切り替えた時の同期用
export async function setRemotePage(pageNumber) {
  if (!pdfDoc || currentPage === pageNumber) return;
  currentPage = pageNumber;
  await renderCurrentPage();
}

if (document.getElementById("prevPageBtn")) {
  document.getElementById("prevPageBtn").onclick = () => changePage(-1);
}
if (document.getElementById("nextPageBtn")) {
  document.getElementById("nextPageBtn").onclick = () => changePage(1);
}

/* ========================================================
   手書き描画ロジック (Canvas操作)
   ======================================================== */
if (drawCanvas) {
  drawCanvas.onpointerdown = (e) => {
    if (mode === "none") return; // 閲覧モード時は描画しない
    drawing = true;
    currentStroke = [];
    const pt = getCanvasPoint(e);
    currentStroke.push(pt);
  };

  drawCanvas.onpointermove = (e) => {
    if (!drawing || mode === "none") return;
    const pt = getCanvasPoint(e);
    currentStroke.push(pt);
    drawCurrentStrokeLocal();
  };

  drawCanvas.onpointerup = () => {
    if (!drawing) return;
    drawing = false;
    saveStroke(currentStroke);
    currentStroke = [];
  };

  drawCanvas.onpointercancel = () => {
    drawing = false;
    currentStroke = [];
  };
}

function getCanvasPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  // 拡大縮小（pdfScale）の影響を受けない「絶対的な比率座標」を計算して保存
  return {
    x: (e.clientX - rect.left) / pdfScale,
    y: (e.clientY - rect.top) / pdfScale
  };
}

function clearDrawCanvasLocal() {
  if (!drawCtx || !drawCanvas) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function redrawAllStrokesLocal() {
  clearDrawCanvasLocal();
  localStrokesArray.forEach(stroke => {
    drawStroke(stroke);
  });
}

function drawCurrentStrokeLocal() {
  if (!drawCtx || currentStroke.length === 0) return;
  
  drawCtx.beginPath();
  const currentSize = parseInt(brushSizeInput.value, 10);
  drawCtx.lineWidth = currentSize * pdfScale; 
  drawCtx.strokeStyle = mode === "eraser" ? "#000000" : brushColorInput.value;
  drawCtx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  
  drawCtx.moveTo(currentStroke[0].x * pdfScale, currentStroke[0].y * pdfScale);
  for (let i = 1; i < currentStroke.length; i++) {
    drawCtx.lineTo(currentStroke[i].x * pdfScale, currentStroke[i].y * pdfScale);
  }
  drawCtx.stroke();
}

function saveStroke(strokePoints) {
  if (strokePoints.length === 0) return;
  const currentSize = parseInt(brushSizeInput.value, 10);
  
  saveStrokeToFirebase(currentPage, {
    mode: mode,
    color: mode === "eraser" ? "#000000" : brushColorInput.value,
    width: currentSize,
    points: strokePoints
  });
}

function setupFirebaseStrokeListener() {
  localStrokesArray = [];
  listenStrokes(currentPage, 
    (stroke) => {
      localStrokesArray.push(stroke);
      drawStroke(stroke);
    },
    () => {
      localStrokesArray = [];
      clearDrawCanvasLocal();
    }
  );
}

function drawStroke(stroke) {
  if (!drawCtx || !stroke.points || stroke.points.length === 0) return;
  
  drawCtx.beginPath();
  drawCtx.lineWidth = stroke.width * pdfScale; 
  drawCtx.strokeStyle = stroke.color;
  drawCtx.globalCompositeOperation = stroke.mode === "eraser" ? "destination-out" : "source-over";
  
  const p = stroke.points;
  drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
  for (let i = 1; i < p.length; i++) {
    drawCtx.lineTo(p[i].x * pdfScale, p[i].y * pdfScale);
  }
  drawCtx.stroke();
}

if (clearBtn) {
  clearBtn.onclick = () => {
    clearStrokesInFirebase(currentPage);
  };
}
