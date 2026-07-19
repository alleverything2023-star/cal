// ポモドーロタイマー機能
// 3つのタイマーをそれぞれ独立してバックグラウンドで動かし、
// 矢印(◁▷)とドットで「今どれを表示しているか」だけを切り替える。
// スロット0・1(左・真ん中)は「共用」として全参加者とFirebase経由で連動し、
// スロット2(右)は「個人用」としてこの端末だけで完結する。

import { sendTimerState, listenTimerState } from "./room.js";

const SHARED_SLOT_INDICES = [0, 1];

const SLOT_COUNT = 3;
const RING_RADIUS = 90;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

let currentSlotIndex = 0;
let timerSlots = [];

let els = {};

function createDefaultSlotState() {
  const focusMinutes = 25;
  return {
    mode: "focus", // "focus" | "break" | "longBreak"
    completedFocusCount: 0,
    running: false,
    intervalId: null,
    shared: false,
    settings: {
      focusMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      cyclesUntilLongBreak: 4
    },
    totalSeconds: focusMinutes * 60,
    remainingSeconds: focusMinutes * 60
  };
}

function serializeSlotState(slot) {
  return {
    mode: slot.mode,
    totalSeconds: slot.totalSeconds,
    remainingSeconds: slot.remainingSeconds,
    running: slot.running,
    updatedAt: Date.now(),
    completedFocusCount: slot.completedFocusCount,
    settings: slot.settings
  };
}

function clearSlotInterval(slot) {
  if (slot.intervalId) {
    clearInterval(slot.intervalId);
    slot.intervalId = null;
  }
}

function broadcastIfShared(slotIndex) {
  const slot = timerSlots[slotIndex];
  if (slot && slot.shared) {
    sendTimerState(slotIndex, serializeSlotState(slot));
  }
}

// 他の参加者からの共用タイマー状態を、自分のローカル状態へ反映する
function applyRemoteTimerState(slotIndex, data) {
  const slot = timerSlots[slotIndex];
  if (!slot) return;

  clearSlotInterval(slot); // ブロードキャストはせず、ローカルのintervalだけ止める

  slot.mode = data.mode;
  slot.totalSeconds = data.totalSeconds;
  slot.completedFocusCount = data.completedFocusCount || 0;
  if (data.settings) slot.settings = data.settings;

  // 送信時刻からの経過分を差し引いて、参加者間でずれないようにする
  const elapsed = data.running ? (Date.now() - data.updatedAt) / 1000 : 0;
  const remaining = Math.max(0, data.remainingSeconds - elapsed);
  slot.remainingSeconds = remaining;

  if (data.running && remaining > 0) {
    slot.running = true;
    slot.intervalId = setInterval(() => tick(slotIndex), 1000);
  } else {
    slot.running = false;
  }

  if (slotIndex === currentSlotIndex) renderTimerUI();
}

function getDurationForMode(slot, mode) {
  if (mode === "focus") return slot.settings.focusMinutes * 60;
  if (mode === "longBreak") return slot.settings.longBreakMinutes * 60;
  return slot.settings.breakMinutes * 60;
}

function formatTime(totalSeconds) {
  const m = Math.max(0, Math.floor(totalSeconds / 60));
  const s = Math.max(0, Math.floor(totalSeconds % 60));
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseLabel(mode) {
  if (mode === "focus") return "集中";
  if (mode === "longBreak") return "長い休憩";
  return "休憩";
}

function advancePhase(slot) {
  if (slot.mode === "focus") {
    slot.completedFocusCount++;
    if (slot.completedFocusCount % slot.settings.cyclesUntilLongBreak === 0) {
      slot.mode = "longBreak";
    } else {
      slot.mode = "break";
    }
  } else {
    slot.mode = "focus";
  }
  slot.totalSeconds = getDurationForMode(slot, slot.mode);
  slot.remainingSeconds = slot.totalSeconds;
}

function tick(slotIndex) {
  const slot = timerSlots[slotIndex];
  if (!slot) return;
  slot.remainingSeconds--;

  if (slot.remainingSeconds <= 0) {
    advancePhase(slot);
    try {
      // 簡易通知音（対応ブラウザのみ、失敗しても無視）
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(audioCtx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); audioCtx.close(); }, 200);
    } catch (e) {}
    broadcastIfShared(slotIndex);
  }

  if (slotIndex === currentSlotIndex) {
    renderTimerUI();
  }
}

function startTimer(slotIndex) {
  const slot = timerSlots[slotIndex];
  if (!slot || slot.running) return;
  slot.running = true;
  slot.intervalId = setInterval(() => tick(slotIndex), 1000);
  broadcastIfShared(slotIndex);
}

function stopTimer(slotIndex) {
  const slot = timerSlots[slotIndex];
  if (!slot || !slot.running) return;
  slot.running = false;
  clearSlotInterval(slot);
  broadcastIfShared(slotIndex);
}

function resetTimer(slotIndex) {
  const slot = timerSlots[slotIndex];
  if (!slot) return;
  slot.running = false;
  clearSlotInterval(slot);
  slot.mode = "focus";
  slot.completedFocusCount = 0;
  slot.totalSeconds = slot.settings.focusMinutes * 60;
  slot.remainingSeconds = slot.totalSeconds;
  broadcastIfShared(slotIndex);
}

function renderTimerUI() {
  const slot = timerSlots[currentSlotIndex];
  if (!slot || !els.timeText) return;

  els.scopeLabel.textContent = slot.shared ? "共用" : "個人用";
  els.timeText.textContent = formatTime(slot.remainingSeconds);
  els.phaseLabel.textContent = phaseLabel(slot.mode);

  const fractionRemaining = slot.totalSeconds > 0 ? slot.remainingSeconds / slot.totalSeconds : 0;
  const offset = RING_CIRCUMFERENCE * (1 - fractionRemaining);
  els.ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  els.ringProgress.style.strokeDashoffset = `${offset}`;
  els.ringProgress.classList.toggle("mode-break", slot.mode === "break");
  els.ringProgress.classList.toggle("mode-longBreak", slot.mode === "longBreak");

  els.startStopBtn.textContent = slot.running ? "停止" : "スタート";
  els.startStopBtn.classList.toggle("running", slot.running);

  els.focusInput.value = slot.settings.focusMinutes;
  els.breakInput.value = slot.settings.breakMinutes;
  els.longBreakInput.value = slot.settings.longBreakMinutes;
  els.cyclesInput.value = slot.settings.cyclesUntilLongBreak;

  els.dots.forEach((dot, i) => {
    dot.classList.toggle("active", i === currentSlotIndex);
  });
}

function applySettingChange(field, value) {
  const slot = timerSlots[currentSlotIndex];
  const num = parseInt(value, 10);
  if (!slot || isNaN(num) || num <= 0) return;

  slot.settings[field] = num;

  // タイマーが停止中で、かつ今表示中のモードに対応する設定が変わった場合は、
  // 残り時間にもすぐ反映する(動作中は現在のカウントを崩さないようそのまま)
  if (!slot.running) {
    const relevantField =
      slot.mode === "focus" ? "focusMinutes" :
      slot.mode === "longBreak" ? "longBreakMinutes" : "breakMinutes";
    if (field === relevantField) {
      slot.totalSeconds = num * 60;
      slot.remainingSeconds = slot.totalSeconds;
    }
  }
  renderTimerUI();
  broadcastIfShared(currentSlotIndex);
}

export function initPomodoroTimers() {
  els = {
    prevBtn: document.getElementById("timerPrevBtn"),
    nextBtn: document.getElementById("timerNextBtn"),
    dots: Array.from(document.querySelectorAll(".timer-dot")),
    scopeLabel: document.getElementById("timerScopeLabel"),
    timeText: document.getElementById("timerTimeText"),
    phaseLabel: document.getElementById("timerPhaseLabel"),
    ringProgress: document.getElementById("timerRingProgress"),
    startStopBtn: document.getElementById("timerStartStopBtn"),
    resetBtn: document.getElementById("timerResetBtn"),
    focusInput: document.getElementById("focusMinutesInput"),
    breakInput: document.getElementById("breakMinutesInput"),
    longBreakInput: document.getElementById("longBreakMinutesInput"),
    cyclesInput: document.getElementById("cyclesInput")
  };

  if (!els.timeText) return; // このページにタイマーUIが無ければ何もしない

  timerSlots = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const slot = createDefaultSlotState();
    slot.shared = SHARED_SLOT_INDICES.includes(i);
    return slot;
  });

  SHARED_SLOT_INDICES.forEach((slotIndex) => {
    listenTimerState(slotIndex, (data) => applyRemoteTimerState(slotIndex, data));
  });

  els.ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  els.ringProgress.style.strokeDashoffset = "0";

  if (els.prevBtn) {
    els.prevBtn.addEventListener("click", () => {
      currentSlotIndex = (currentSlotIndex - 1 + SLOT_COUNT) % SLOT_COUNT;
      renderTimerUI();
    });
  }
  if (els.nextBtn) {
    els.nextBtn.addEventListener("click", () => {
      currentSlotIndex = (currentSlotIndex + 1) % SLOT_COUNT;
      renderTimerUI();
    });
  }
  els.dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      currentSlotIndex = parseInt(dot.dataset.slot, 10) || 0;
      renderTimerUI();
    });
  });

  if (els.startStopBtn) {
    els.startStopBtn.addEventListener("click", () => {
      const slot = timerSlots[currentSlotIndex];
      if (slot.running) stopTimer(currentSlotIndex);
      else startTimer(currentSlotIndex);
      renderTimerUI();
    });
  }
  if (els.resetBtn) {
    els.resetBtn.addEventListener("click", () => {
      resetTimer(currentSlotIndex);
      renderTimerUI();
    });
  }

  if (els.focusInput) els.focusInput.addEventListener("change", (e) => applySettingChange("focusMinutes", e.target.value));
  if (els.breakInput) els.breakInput.addEventListener("change", (e) => applySettingChange("breakMinutes", e.target.value));
  if (els.longBreakInput) els.longBreakInput.addEventListener("change", (e) => applySettingChange("longBreakMinutes", e.target.value));
  if (els.cyclesInput) els.cyclesInput.addEventListener("change", (e) => applySettingChange("cyclesUntilLongBreak", e.target.value));

  renderTimerUI();
}
