import { saveStrokeToFirebase, listenStrokes, clearStrokesInFirebase, updatePdfPageInFirebase } from "./room.js";

let pdfDoc = null;
let currentPage = 1;
// ① pdfScaleのステート保持
let pdfScale = 1.0;
let currentPdfUrl = null;
let currentToken = null;

// 要素取得
const pdfCanvas = document.getElementById("pdfCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const pdfScrollContainer = document.getElementById("pdfScrollContainer");
const pdfWrapper = document.getElementById("pdfWrapper");
const pageInfo = document.getElementById("pageInfo");

// ① ズームツールバー要素
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomLabel = document.getElementById("zoomLabel");

// ⑧ 描画ツールバー要素
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");
const clearBtn = document.getElementById("clearBtn");

const drawCtx = drawCanvas ? drawCanvas.getContext("2d") : null;
let drawing = false;
let currentStroke = [];
let mode = "pen"; // pen or eraser

// ① ズーム処理の実装
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

// ⑧ 描画ツールバーのモード切り替え
if (penBtn && eraserBtn && clearBtn) {
  penBtn.onclick = () => {
    mode = "pen";
    penBtn.classList.add("active");
    eraserBtn.classList.remove("active");
  };
  eraserBtn.onclick = () => {
    mode = "eraser";
    eraserBtn.classList.add("active");
    penBtn.classList.remove("active");
  };
  clearBtn.onclick = () => {
    if (confirm("このページのすべての手書き描画を消去しますか？")) {
      clearStrokesInFirebase(currentPage);
    }
  };
}

// PDFのロードとレンダリング開始
export async function loadAndRenderPdf(url, token, pageNum = 1) {
  if (currentPdfUrl !== url || currentToken !== token) {
    currentPdfUrl = url;
    currentToken = token;
    
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const loadingTask = pdfjsLib.getDocument({ url: url, httpHeaders: headers });
      pdfDoc = await loadingTask.promise;
      currentPage = pageNum;
      
      // ページがロードされたらFirebaseのストローク受信をスタート
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

// ページのレンダリング処理
export async function renderCurrentPage() {
  if (!pdfDoc || !pdfCanvas) return;
  
  try {
    const page = await pdfDoc.getPage(currentPage);
    // ① pdfScale を適用
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
    
    // ④ Canvasサイズ同期
    if (drawCanvas) {
      drawCanvas.width = pdfCanvas.width;
      drawCanvas.height = pdfCanvas.height;
    }
    
    if (pageInfo) {
      pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
    }
    
    // ページを切り替え・ズームした後に既存の全ストロークをローカルCanvasへ一斉再描画
    redrawAllSavedStrokes();
    
  } catch (err) {
    console.error("ページ描画エラー:", err);
  }
}

// ページ切り替え
export function changePage(offset) {
  if (!pdfDoc) return;
  const newPage = currentPage + offset;
  if (newPage >= 1 && newPage <= pdfDoc.numPages) {
    currentPage = newPage;
    updatePdfPageInFirebase(currentPage); // 全員へページ同期
    renderCurrentPage();
    setupFirebaseStrokeListener(); // ページ切り替え時にリスナー再設定
  }
}

// ② ピンチズームの実装
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

// ⑤ 手書きイベントの実装 (pointerイベントを使用することでマウス・タッチ両対応)
let localStrokesArray = []; // ローカルに保持する現在のページの全ストロークデータ

if (drawCanvas) {
  drawCanvas.addEventListener("pointerdown", e => {
    drawing = true;
    currentStroke = [];
    addPoint(e);
  });

  drawCanvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    addPoint(e);
    redrawCurrentStroke();
  });

  drawCanvas.addEventListener("pointerup", () => {
    if (!drawing) return;
    drawing = false;
    saveStroke(currentStroke);
  });
}

// ⑤ PDF基準座標（Scaleで割った値）で座標を追加保存する
function addPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  currentStroke.push({
    x: (e.clientX - rect.left) / pdfScale,
    y: (e.clientY - rect.top) / pdfScale
  });
}

// 現在書き中の線をレンダリング（リアルタイム追従用）
function redrawCurrentStroke() {
  if (currentStroke.length < 1) return;
  
  drawCtx.beginPath();
  drawCtx.lineWidth = mode === "eraser" ? 20 : 3;
  drawCtx.strokeStyle = mode === "eraser" ? "rgba(0,0,0,1)" : "#ff0000";
  drawCtx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  
  drawCtx.moveTo(currentStroke[0].x * pdfScale, currentStroke[0].y * pdfScale);
  for (let i = 1; i < currentStroke.length; i++) {
    drawCtx.lineTo(currentStroke[i].x * pdfScale, currentStroke[i].y * pdfScale);
  }
  drawCtx.stroke();
}

// ⑥ Firebase保存
function saveStroke(strokePoints) {
  if (strokePoints.length === 0) return;
  
  saveStrokeToFirebase(currentPage, {
    mode: mode,
    color: mode === "eraser" ? "#000000" : "#ff0000",
    width: mode === "eraser" ? 20 : 3,
    points: strokePoints
  });
}

// ⑦ リアルタイム受信の設定
function setupFirebaseStrokeListener() {
  localStrokesArray = [];
  
  listenStrokes(currentPage, 
    (stroke) => {
      // 新しいストロークが追加された
      localStrokesArray.push(stroke);
      drawStroke(stroke);
    },
    () => {
      // データがクリアされた
      localStrokesArray = [];
      clearDrawCanvasLocal();
    }
  );
}

// 保存された1本分のストローク線を Canvas 基準に拡大して描画
function drawStroke(stroke) {
  if (!drawCtx || !stroke.points || stroke.points.length === 0) return;
  
  drawCtx.beginPath();
  drawCtx.lineWidth = stroke.width;
  drawCtx.strokeStyle = stroke.color;
  drawCtx.globalCompositeOperation = stroke.mode === "eraser" ? "destination-out" : "source-over";
  
  const p = stroke.points;
  drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
  for (let i = 1; i < p.length; i++) {
    drawCtx.lineTo(p[i].x * pdfScale, p[i].y * pdfScale);
  }
  drawCtx.stroke();
}

// ページ内に保存されているストロークを全て再レンダリングする
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

export function clearDrawCanvas() {
  clearDrawCanvasLocal();
}
