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

// ツールバーのインタラクション制御
if (penBtn && eraserBtn) {
  penBtn.onclick = () => {
    if (mode === "pen") {
      // 選択中に再度押されたら解除して「どちらでもない状態」にする
      mode = "none";
      penBtn.classList.remove("active");
      drawCanvas.classList.remove("drawing-mode-active");
    } else {
      mode = "pen";
      penBtn.classList.add("active");
      eraserBtn.classList.remove("active");
      drawCanvas.classList.add("drawing-mode-active");
    }
  };

  eraserBtn.onclick = () => {
    if (mode === "eraser") {
      mode = "none";
      eraserBtn.classList.remove("active");
      drawCanvas.classList.remove("drawing-mode-active");
    } else {
      mode = "eraser";
      eraserBtn.classList.add("active");
      penBtn.classList.remove("active");
      drawCanvas.classList.add("drawing-mode-active");
    }
  };
}

if (brushSizeInput && sizeLabel) {
  brushSizeInput.oninput = () => {
    sizeLabel.textContent = brushSizeInput.value;
  };
}

if (clearBtn) {
  clearBtn.onclick = () => {
    if (confirm("このページのすべての手書き描画を消去しますか？")) {
      clearStrokesInFirebase(currentPage);
    }
  };
}

if (zoomInBtn && zoomOutBtn) {
  zoomInBtn.onclick = () => {
    pdfScale = Math.min(5, pdfScale * 1.1);
    renderCurrentPage();
  };
  zoomOutBtn.onclick = () => {
    pdfScale = Math.max(0.5, pdfScale * 0.9);
    renderCurrentPage();
  };
}

function updateZoomLabel() {
  if (zoomLabel) {
    zoomLabel.textContent = Math.round(pdfScale * 100) + "%";
  }
}

// PDF読み込み不具合対策
function getPdfJsLibrary() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (window['pdfjs-dist/build/pdf']) return window['pdfjs-dist/build/pdf'];
  return null;
}

export async function loadAndRenderPdf(url, token, pageNum = 1) {
  const lib = getPdfJsLibrary();
  if (!lib) {
    console.error("PDF.jsライブラリの読み込みが確認できません。");
    // 1秒後に再試行
    setTimeout(() => loadAndRenderPdf(url, token, pageNum), 1000);
    return;
  }

  // 統合されたグローバルワーカーを設定
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }

  if (currentPdfUrl !== url || currentToken !== token) {
    currentPdfUrl = url;
    currentToken = token;
    
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const loadingTask = lib.getDocument({ url: url, httpHeaders: headers });
      pdfDoc = await loadingTask.promise;
      currentPage = pageNum;
      
      setupFirebaseStrokeListener();
    } catch (err) {
      console.error("PDF読み込み失敗:", err);
      return;
    }
  } else {
    currentPage = pageNum;
  }
  
  renderCurrentPage();
}

export async function renderCurrentPage() {
  if (!pdfDoc || !pdfCanvas) return;
  
  try {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: pdfScale });
    
    const context = pdfCanvas.getContext('2d');
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await renderContext.promise;
    updateZoomLabel();
    
    if (drawCanvas) {
      drawCanvas.width = pdfCanvas.width;
      drawCanvas.height = pdfCanvas.height;
    }
    
    if (pageInfo) {
      pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
    }
    
    redrawAllSavedStrokes();
    
  } catch (err) {
    console.error("ページ描画エラー:", err);
  }
}

export function changePage(offset) {
  if (!pdfDoc) return;
  const newPage = currentPage + offset;
  if (newPage >= 1 && newPage <= pdfDoc.numPages) {
    currentPage = newPage;
    updatePdfPageInFirebase(currentPage); 
    renderCurrentPage();
    setupFirebaseStrokeListener(); 
  }
}

let pinchStartDistance = null;
function getDistance(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

if (pdfScrollContainer) {
  pdfScrollContainer.addEventListener("touchstart", e => {
    if (e.touches.length === 2) {
      pinchStartDistance = getDistance(e.touches[0], e.touches[1]);
    }
  });

  pdfScrollContainer.addEventListener("touchmove", e => {
    if (e.touches.length === 2 && pinchStartDistance) {
      const newDistance = getDistance(e.touches[0], e.touches[1]);
      const ratio = newDistance / pinchStartDistance;
      
      pdfScale *= ratio;
      pdfScale = Math.min(5, Math.max(0.5, pdfScale));
      
      pinchStartDistance = newDistance;
      renderCurrentPage();
    }
  });
}

let localStrokesArray = []; 

if (drawCanvas) {
  drawCanvas.addEventListener("pointerdown", e => {
    if (mode === "none") return; // モード未選択時はなにもしない
    drawing = true;
    currentStroke = [];
    addPoint(e);
  });

  drawCanvas.addEventListener("pointermove", e => {
    if (!drawing || mode === "none") return;
    addPoint(e);
    redrawCurrentStroke();
  });

  drawCanvas.addEventListener("pointerup", () => {
    if (!drawing) return;
    drawing = false;
    saveStroke(currentStroke);
  });
}

function addPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  currentStroke.push({
    x: (e.clientX - rect.left) / pdfScale,
    y: (e.clientY - rect.top) / pdfScale
  });
}

function redrawCurrentStroke() {
  if (currentStroke.length < 1) return;
  
  drawCtx.beginPath();
  const currentSize = parseInt(brushSizeInput.value, 10);
  
  drawCtx.lineWidth = currentSize;
  drawCtx.strokeStyle = mode === "eraser" ? "rgba(0,0,0,1)" : brushColorInput.value;
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
  drawCtx.lineWidth = stroke.width * pdfScale; // ズーム倍率を線の太さにも動的に反映
  drawCtx.strokeStyle = stroke.color;
  drawCtx.globalCompositeOperation = stroke.mode === "eraser" ? "destination-out" : "source-over";
  
  const p = stroke.points;
  drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
  for (let i = 1; i < p.length; i++) {
    drawCtx.lineTo(p[i].x * pdfScale, p[i].y * pdfScale);
  }
  drawCtx.stroke();
}

function redrawAllSavedStrokes() {
  clearDrawCanvasLocal();
  localStrokesArray.forEach(stroke => {
    drawStroke(stroke);
  });
}

function clearDrawCanvasLocal() {
  if (drawCtx && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
}
