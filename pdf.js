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

// ① 重複リスナーをクリーンアップするための解除関数保持変数
let unsubscribeStrokeListener = null;

// ⑯ 多重描画防止用フラグ
let isRendering = false;

// ⑰ 進行中のレンダリングタスクキャンセル用
let currentRenderTask = null;

// ⑭ ページごとのローカルストロークキャッシュ
const strokesByPage = {};

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

// ⑬ Ctrl + マウスホイールによるズーム操作（ペン/消しゴムモード以外で動作）
if (pdfScrollContainer) {
  pdfScrollContainer.addEventListener("wheel", async (e) => {
    if (e.ctrlKey && mode === "none") {
      e.preventDefault();
      if (e.deltaY < 0) {
        // ズームイン
        if (pdfScale >= 3.0) return;
        pdfScale = Math.min(3.0, pdfScale + 0.1);
      } else {
        // ズームアウト
        if (pdfScale <= 0.5) return;
        pdfScale = Math.max(0.5, pdfScale - 0.1);
      }
      if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfScale * 100)}%`;
      await renderCurrentPage();
      redrawAllStrokesLocal();
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
  // ⑫ 同じPDFなら再ロードしない
  if (currentPdfUrl === pdfUrlOrBase64 && pdfDoc) {
    return;
  }

  // ⑪ 前のPDFドキュメントインスタンスが存在すれば破棄してメモリリークを防ぐ
  if (pdfDoc) {
    try {
      if (typeof pdfDoc.destroy === "function") {
        await pdfDoc.destroy();
      }
    } catch (e) {
      console.warn("前PDFインスタンス解放エラー:", e);
    }
    pdfDoc = null;
  }

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
    console.error("PDF読み込み失敗:", err, {
      pdfUrl: pdfUrlOrBase64
    });
  }
}

export async function renderCurrentPage() {
  if (!pdfDoc || !pdfCanvas || !drawCanvas) return;

  // ⑯ 描画重複防止フラグ
  isRendering = true;

  // ⑰ 前回の未完了レンダリング処理を中断
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
    } catch (e) {
      // キャンセルによる正常終了
    }
    currentRenderTask = null;
  }

  // ② 新ページロード時に古い描画がブレて表示されるのを防ぐクリーンアップ
  clearDrawCanvasLocal();
  localStrokesArray = [];

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

    currentRenderTask = page.render(renderContext);
    await currentRenderTask.promise;
    currentRenderTask = null;

    if (pageInfo) {
      pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
    }

    setupFirebaseStrokeListener();
  } catch (err) {
    // キャンセルによるエラーはコンソールに出力しない
    if (err && err.name !== "RenderingCancelledException") {
      console.error("ページ描画失敗:", err, {
        page: currentPage,
        scale: pdfScale,
        pdfUrl: currentPdfUrl
      });
    }
  } finally {
    isRendering = false;
  }
}

// 拡大ボタン（ペン・消しゴム使用時は動作しないように制限）
if (zoomInBtn) {
  zoomInBtn.onclick = async () => {
    if (mode === "pen" || mode === "eraser" || isRendering) return; // 使用中やレンダリング中は無効化
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
    if (mode === "pen" || mode === "eraser" || isRendering) return; // 使用中やレンダリング中は無効化
    if (pdfScale <= 0.5) return;
    pdfScale -= 0.2;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfScale * 100)}%`;
    await renderCurrentPage();
    redrawAllStrokesLocal();
  };
}

export async function changePage(offset) {
  if (!pdfDoc || isRendering) return;
  const newPage = currentPage + offset;
  if (newPage < 1 || newPage > pdfDoc.numPages) return;
  currentPage = newPage;
  updatePdfPageInFirebase(currentPage);
  await renderCurrentPage();
}

// 他のユーザーがページを切り替えた時の同期用
export async function setRemotePage(pageNumber) {
  if (!pdfDoc || currentPage === pageNumber || isRendering) return;
  currentPage = pageNumber;
  await renderCurrentPage();
}

if (document.getElementById("prevPageBtn")) {
  document.getElementById("prevPageBtn").onclick = () => changePage(-1);
}
if (document.getElementById("nextPageBtn")) {
  document.getElementById("nextPageBtn").onclick = () => changePage(1);
}

// ④ ウィンドウサイズが変更された場合にも手書きキャンバスをリサイズして再描画
window.addEventListener("resize", () => {
  if (pdfDoc) {
    redrawAllStrokesLocal();
  }
});

/* ========================================================
   手書き描画ロジック (Canvas操作)
   ======================================================== */
if (drawCanvas) {
  drawCanvas.onpointerdown = (e) => {
    if (mode === "none") return; // 閲覧モード時は描画しない
    
    // ⑤ pointer capture を有効にしてiPadやタッチ時の安定描画を実現
    try {
      drawCanvas.setPointerCapture(e.pointerId);
    } catch (err) {}

    drawing = true;
    currentStroke = [];
    const pt = getCanvasPoint(e);
    currentStroke.push(pt);
  };

  drawCanvas.onpointermove = (e) => {
    if (!drawing || mode === "none") return;
    const pt = getCanvasPoint(e);
    currentStroke.push(pt);
    
    // ⑦ requestAnimationFrame を介して再描画負荷を低減（カクつきを抑制）
    requestAnimationFrame(drawCurrentStrokeLocal);
  };

  drawCanvas.onpointerup = (e) => {
    if (!drawing) return;
    drawing = false;
    
    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch (err) {}

    saveStroke(currentStroke);
    currentStroke = [];
  };

  // ⑩ pointercancel時でも描いたデータを破棄せず保存
  drawCanvas.onpointercancel = (e) => {
    if (!drawing) return;
    drawing = false;

    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch (err) {}

    saveStroke(currentStroke);
    currentStroke = [];
  };

  // ⑥ pointerleave（領域外へのフェードアウト時）でもストロークをセーブ
  drawCanvas.onpointerleave = (e) => {
    if (!drawing) return;
    drawing = false;

    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch (err) {}

    saveStroke(currentStroke);
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
  
  // ⑧ 3点以上あればquadraticCurveTo（2次ベジェ曲線）により手書き線を滑らかに補間
  const p = currentStroke;
  if (p.length < 3) {
    drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
    for (let i = 1; i < p.length; i++) {
      drawCtx.lineTo(p[i].x * pdfScale, p[i].y * pdfScale);
    }
  } else {
    drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
    for (var i = 1; i < p.length - 2; i++) {
      const xc = ((p[i].x + p[i + 1].x) / 2) * pdfScale;
      const yc = ((p[i].y + p[i + 1].y) / 2) * pdfScale;
      drawCtx.quadraticCurveTo(p[i].x * pdfScale, p[i].y * pdfScale, xc, yc);
    }
    // 終端手前の2点間の補間
    drawCtx.quadraticCurveTo(
      p[i].x * pdfScale,
      p[i].y * pdfScale,
      p[i + 1].x * pdfScale,
      p[i + 1].y * pdfScale
    );
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
  // ① 既に存在するFirebaseリスナーがあれば確実に解除して増殖を防ぐ
  if (unsubscribeStrokeListener) {
    unsubscribeStrokeListener();
    unsubscribeStrokeListener = null;
  }

  localStrokesArray = [];
  
  // ⑭ ページごとにストローク履歴をロード・初期化
  if (!strokesByPage[currentPage]) {
    strokesByPage[currentPage] = [];
  }
  localStrokesArray = strokesByPage[currentPage];
  redrawAllStrokesLocal();

  unsubscribeStrokeListener = listenStrokes(currentPage, 
    (stroke) => {
      localStrokesArray.push(stroke);
      drawStroke(stroke);
    },
    () => {
      // ⑮ Firebase側でクリアされたらローカルも即削除
      localStrokesArray = [];
      strokesByPage[currentPage] = [];
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
  
  // ⑧ 3点以上あればquadraticCurveTo（2次ベジェ曲線）により滑らかに再描画
  const p = stroke.points;
  if (p.length < 3) {
    drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
    for (let i = 1; i < p.length; i++) {
      drawCtx.lineTo(p[i].x * pdfScale, p[i].y * pdfScale);
    }
  } else {
    drawCtx.moveTo(p[0].x * pdfScale, p[0].y * pdfScale);
    var i;
    for (i = 1; i < p.length - 2; i++) {
      const xc = ((p[i].x + p[i + 1].x) / 2) * pdfScale;
      const yc = ((p[i].y + p[i + 1].y) / 2) * pdfScale;
      drawCtx.quadraticCurveTo(p[i].x * pdfScale, p[i].y * pdfScale, xc, yc);
    }
    drawCtx.quadraticCurveTo(
      p[i].x * pdfScale,
      p[i].y * pdfScale,
      p[i + 1].x * pdfScale,
      p[i + 1].y * pdfScale
    );
  }
  
  drawCtx.stroke();
}

if (clearBtn) {
  clearBtn.onclick = () => {
    // ⑮ Firebaseの削除に合わせて、ローカル配列もその場で即座に初期化してクリア処理の同期ラグを低減
    localStrokesArray = [];
    strokesByPage[currentPage] = [];
    clearDrawCanvasLocal();
    clearStrokesInFirebase(currentPage);
  };
}
