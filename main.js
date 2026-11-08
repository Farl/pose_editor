import { createDefaultPose, normalizePose, clonePose, mirrorPose, copySide } from "./pose.js";
import { HAND_GESTURES, applyHandGesture } from "./handPoses.js";
import { POSE_STYLES } from "./poseStyles.js";
import { SkeletonCanvas, isValidDrawOrder } from "./skeletonCanvas.js";
import { initSidebar } from "./sidebar.js";
import { POSE_PRESETS, buildPresetPose } from "./posePresets.js";
import {
  SHORTCUTS,
  DRAG_MODES,
  DEFAULT_DRAG_MODE,
  DEFAULT_POSE_STYLE,
  DISPLAY_DEFAULTS,
  HANDS,
} from "./editorConfig.js";
import {
  fetchImageModels,
  filterImageModelsByCapability,
  generatePoseImage,
  setSelectedImageModel,
  setApiKey,
  POLLINATIONS_KEY_URL,
} from "./aiService.js";

const STORAGE_KEY = "poseEditorState_v1";

const poseCanvas = document.getElementById("poseCanvas");
const resultImageEl = document.getElementById("resultImage");
const aiStatusEl = document.getElementById("aiStatus");
const generateImageBtn = document.getElementById("generateImageBtn");
const inputImageEl = document.getElementById("inputImagePreview");
const imageModelSelect = document.getElementById("imageModelSelect");
const allowPaidModelsInput = document.getElementById("allowPaidModels");

const IMAGE_MODEL_STORAGE_KEY = "poseEditorImageModel_v1";
const INCLUDE_PAID_STORAGE_KEY = "poseEditorIncludePaidModels_v1";
/// The user's own Pollinations key. Stays in this browser; sent only to Pollinations.
const API_KEY_STORAGE_KEY = "poseEditorPollinationsKey_v1";

/// Hand pose menu targets: both hands, or one (figure's sides).
const HAND_TARGETS = [
  { label: "Both hands", sides: ["r", "l"] },
  { label: "Right hand", sides: ["r"] },
  { label: "Left hand", sides: ["l"] },
];

let pose = createDefaultPose();
let jointRadius = DISPLAY_DEFAULTS.jointRadius;
let linkScale = DISPLAY_DEFAULTS.linkScale;
/// How joints drag: "ik", "fk" or "free" (DRAG_MODES).
let dragMode = DEFAULT_DRAG_MODE;
/// Rendering style (POSE_STYLES) and hand detail (HANDS.details).
let styleId = DEFAULT_POSE_STYLE;
let handDetail = HANDS.defaultDetail;
/// Joint stacking, bottom to top (see SkeletonCanvas); null = default order.
let drawOrder = null;
/// Pinned IK ends (hands/feet). Editor state, not part of the pose or undo history.
let pins = [];

// Load saved state from localStorage, if any
const savedState = loadState();
if (savedState && savedState.pose && savedState.pose.joints) {
  pose = normalizePose(savedState.pose);
  if (typeof savedState.jointRadius === "number") {
    jointRadius = savedState.jointRadius;
  }
  if (typeof savedState.linkScale === "number") {
    linkScale = savedState.linkScale;
  }
  if (savedState.dragMode in DRAG_MODES) {
    dragMode = savedState.dragMode;
  }
  if (savedState.styleId in POSE_STYLES) {
    styleId = savedState.styleId;
  }
  if (savedState.handDetail in HANDS.details) {
    handDetail = savedState.handDetail;
  }
  if (isValidDrawOrder(savedState.drawOrder)) {
    drawOrder = savedState.drawOrder;
  }
  if (Array.isArray(savedState.pins)) {
    pins = savedState.pins;
  }
}

let history = [clonePose(pose)];
let historyIndex = 0;

let currentImageDataUrl = null;
let isGeneratingImage = false;
let allImageModels = [];

const savedAllowPaid = localStorage.getItem(INCLUDE_PAID_STORAGE_KEY);
if (allowPaidModelsInput && savedAllowPaid !== null) {
  allowPaidModelsInput.checked = savedAllowPaid === "1";
}

const skeleton = new SkeletonCanvas(poseCanvas, pose, {
  jointRadius,
  minorAxisScale: linkScale,
  dragMode,
  styleId,
  handDetail,
  drawOrder: drawOrder || undefined,
  pins,
  onChange: (newPose) => {
    pose = newPose;
  },
  onChangeEnd: (finalPose) => {
    pose = finalPose;
    pushHistory(finalPose);
    saveState();
  },
  onDrawOrderChange: (newOrder) => {
    drawOrder = newOrder;
    saveState();
  },
  onPinsChange: (newPins) => {
    pins = newPins;
    sidebar.setPinCount(pins.length);
    saveState();
  },
});

const sidebar = initSidebar({
  onReset: handleReset,
  onUndo: handleUndo,
  onRedo: handleRedo,
  onMirror: handleMirror,
  onDownload: handleDownload,
  onJointSizeChange: (v) => {
    jointRadius = v;
    skeleton.setJointRadius(v);
    saveState();
  },
  onLinkScaleChange: (v) => {
    linkScale = v;
    skeleton.setMinorAxisScale(linkScale);
    saveState();
  },
  onImageFileChange: handleImageFile,
  onGenerateImageClick: handleGenerateImage,
  dragModes: Object.entries(DRAG_MODES).map(([id, { label, title }]) => ({ id, label, title })),
  onDragModeChange: setDragMode,
  styles: Object.entries(POSE_STYLES).map(([value, { label }]) => ({ value, label })),
  onStyleChange: (id) => {
    styleId = id;
    skeleton.setStyle(id);
    saveState();
  },
  handDetails: Object.entries(HANDS.details).map(([id, { label }]) => ({ id, label })),
  onHandDetailChange: setHandDetail,
  handPoseGroups: HAND_TARGETS.map(({ label, sides }) => ({
    label,
    options: Object.entries(HAND_GESTURES).map(([id, g]) => ({ value: `${sides.join("")}:${id}`, label: g.label })),
  })),
  onHandPoseSelect: (value) => {
    const [sides, gestureId] = value.split(":");
    const next = clonePose(pose);
    for (const side of sides) applyHandGesture(next.joints, side, gestureId);
    commitPose(next);
  },
  apiKeyUrl: POLLINATIONS_KEY_URL,
  onApiKeyChange: (key) => {
    setApiKey(key);
    try {
      if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key);
      else localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch {
      // Private mode: the key still works for this session.
    }
  },
  presets: Object.entries(POSE_PRESETS).map(([value, { label }]) => ({ value, label })),
  onPresetSelect: (id) => commitPose(buildPresetPose(id, pose)),
  onCopySide: (side) => commitPose(copySide(pose, side)),
  onUnpinAll: () => skeleton.clearPins(),
});

updateUndoRedoState();
sidebar.setDragMode(dragMode);
sidebar.setStyle(styleId);
sidebar.setHandDetail(handDetail);
restoreApiKey();
sidebar.setPinCount(skeleton.getPins().length);
bindShortcuts();

// Allow pasting an image from the clipboard as the reference image
window.addEventListener("paste", (event) => {
  if (isGeneratingImage) return;
  const clipboardData = event.clipboardData || window.clipboardData;
  if (!clipboardData || !clipboardData.items) return;

  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        handleImageFile(file);
      }
      break;
    }
  }
});

// Sync sliders with loaded state
sidebar.setRangeValue("jointSizeInput", jointRadius);
sidebar.setRangeValue("linkScaleInput", linkScale);
initImageModelPicker();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState() {
  try {
    const state = {
      pose,
      jointRadius,
      linkScale,
      dragMode,
      styleId,
      handDetail,
      drawOrder,
      pins,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore write errors
  }
}

function updateUndoRedoState() {
  sidebar.setUndoRedoState(historyIndex > 0, historyIndex < history.length - 1);
}

function pushHistory(newPose) {
  const snapshot = clonePose(newPose);
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  historyIndex = history.length - 1;
  updateUndoRedoState();
}

/// Show `newPose` on the canvas and persist it, without touching history.
function showPose(newPose) {
  pose = newPose;
  skeleton.setPose(pose);
  saveState();
}

/// Apply a whole-pose edit (button, preset, shortcut) as one undoable step.
function commitPose(newPose) {
  showPose(newPose);
  pushHistory(pose);
}

/// Reset is undoable like any other edit, so the R shortcut is safe to hit.
/// It also restores the default joint stacking (not part of undo history).
function handleReset() {
  skeleton.resetDrawOrder();
  commitPose(createDefaultPose());
}

function stepHistory(delta) {
  const next = historyIndex + delta;
  if (next < 0 || next >= history.length) return;
  historyIndex = next;
  showPose(clonePose(history[historyIndex]));
  updateUndoRedoState();
}

function handleUndo() {
  stepHistory(-1);
}

function handleRedo() {
  stepHistory(1);
}

function setHandDetail(detail) {
  handDetail = detail;
  skeleton.setHandDetail(detail);
  sidebar.setHandDetail(detail);
  saveState();
}

function restoreApiKey() {
  let key = "";
  try {
    key = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    // Storage blocked: start empty.
  }
  setApiKey(key);
  sidebar.setApiKey(key);
}

function setDragMode(mode) {
  dragMode = mode;
  skeleton.setDragMode(mode);
  sidebar.setDragMode(mode);
  saveState();
}

function handleMirror() {
  commitPose(mirrorPose(pose));
}

/// Keyboard shortcuts from editorConfig.SHORTCUTS. Ignored while typing in a
/// form field so they never steal keystrokes from inputs.
function bindShortcuts() {
  const actions = {
    undo: handleUndo,
    redo: handleRedo,
    mirror: handleMirror,
    reset: handleReset,
    dragMode: setDragMode,
    togglePin: () => skeleton.togglePin(skeleton.focusJoint()),
  };

  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const shortcut = SHORTCUTS.find(
      (s) => s.key === key && s.mod === mod && s.shift === e.shiftKey && !e.altKey
    );
    if (!shortcut || !actions[shortcut.action]) return;
    e.preventDefault();
    actions[shortcut.action](shortcut.arg);
  });
}

function handleDownload() {
  const link = document.createElement("a");
  link.download = `pose-${Date.now()}.png`;
  link.href = skeleton.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function setAiStatus(text) {
  if (aiStatusEl) {
    aiStatusEl.textContent = text || "";
  }
}

function setGenerateButtonDisabled(disabled) {
  if (generateImageBtn) {
    generateImageBtn.disabled = !!disabled;
  }
}

function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  setAiStatus("Loading image…");
  setGenerateButtonDisabled(true);

  reader.onload = () => {
    const result = reader.result;
    if (typeof result === "string") {
      currentImageDataUrl = result;
      if (inputImageEl) {
        inputImageEl.src = result;
        inputImageEl.hidden = false;
      }
      if (resultImageEl) {
        resultImageEl.hidden = true;
        resultImageEl.src = "";
      }
      setAiStatus("");
      setGenerateButtonDisabled(false);
    } else {
      setAiStatus("Could not read that file. Use a PNG, JPEG or WebP image.");
      setGenerateButtonDisabled(true);
    }
  };

  reader.onerror = () => {
    setAiStatus("Could not read that file. Use a PNG, JPEG or WebP image.");
    setGenerateButtonDisabled(true);
  };

  reader.readAsDataURL(file);
}

async function handleGenerateImage() {
  if (!currentImageDataUrl || isGeneratingImage) {
    return;
  }

  isGeneratingImage = true;
  setAiStatus("Rendering…");
  setGenerateButtonDisabled(true);

  try {
    const poseImageDataUrl = skeleton.toDataURL("image/png");
    const url = await generatePoseImage(currentImageDataUrl, pose, poseImageDataUrl);
    if (url && resultImageEl) {
      resultImageEl.src = url;
      resultImageEl.hidden = false;
      setAiStatus("");
    } else {
      setAiStatus("Render failed. Try another model.");
    }
  } catch (e) {
    console.error(e);
    setAiStatus(`Render failed: ${e?.message || "unknown error"}. Try another model.`);
  } finally {
    isGeneratingImage = false;
    // Re-enable only if we still have a source image
    setGenerateButtonDisabled(!currentImageDataUrl);
  }
}

function getAllowPaidModels() {
  return !!(allowPaidModelsInput && allowPaidModelsInput.checked);
}

function renderImageModelOptions() {
  if (!imageModelSelect) return;

  const filtered = filterImageModelsByCapability(allImageModels, {
    requiresImageInput: true,
    allowPaid: getAllowPaidModels(),
  });

  const selectedBefore = imageModelSelect.value || localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
  imageModelSelect.innerHTML = "";

  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.value = "kontext";
    opt.textContent = "kontext (fallback)";
    imageModelSelect.appendChild(opt);
    imageModelSelect.value = "kontext";
    setSelectedImageModel("kontext");
    return;
  }

  filtered.forEach((model) => {
    const opt = document.createElement("option");
    opt.value = model.value;
    opt.textContent = model.label;
    imageModelSelect.appendChild(opt);
  });

  const selected = filtered.some((m) => m.value === selectedBefore)
    ? selectedBefore
    : filtered[0].value;

  imageModelSelect.value = selected;
  setSelectedImageModel(selected);
  localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, selected);
}

async function initImageModelPicker() {
  if (!imageModelSelect) return;

  imageModelSelect.innerHTML = "";
  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = "Loading models...";
  imageModelSelect.appendChild(loadingOption);
  imageModelSelect.disabled = true;

  try {
    allImageModels = await fetchImageModels();
  } catch {
    allImageModels = [];
  }

  imageModelSelect.disabled = false;
  renderImageModelOptions();

  imageModelSelect.addEventListener("change", () => {
    const model = imageModelSelect.value || "kontext";
    setSelectedImageModel(model);
    localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, model);
  });

  if (allowPaidModelsInput) {
    allowPaidModelsInput.addEventListener("change", () => {
      localStorage.setItem(INCLUDE_PAID_STORAGE_KEY, allowPaidModelsInput.checked ? "1" : "0");
      renderImageModelOptions();
    });
  }
}