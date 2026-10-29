import { createDefaultPose, clonePose, mirrorPose, copySide } from "./pose.js";
import { SkeletonCanvas } from "./skeletonCanvas.js";
import { initSidebar } from "./sidebar.js";
import { POSE_PRESETS, buildPresetPose } from "./posePresets.js";
import { CANVAS, SHORTCUTS, DRAG_MODES, DEFAULT_DRAG_MODE } from "./editorConfig.js";
import {
  fetchImageModels,
  filterImageModelsByCapability,
  generatePoseImage,
  setSelectedImageModel,
} from "./aiService.js";

const STORAGE_KEY = "poseEditorState_v1";

const poseCanvas = document.getElementById("poseCanvas");
const instructionsEl = document.getElementById("instructions");
const closeInstructionsBtn = document.getElementById("closeInstructions");
const resultImageEl = document.getElementById("resultImage");
const aiStatusEl = document.getElementById("aiStatus");
const generateImageBtn = document.getElementById("generateImageBtn");
const inputImageEl = document.getElementById("inputImagePreview");
const posePreviewEl = document.getElementById("posePreview");
const imageModelSelect = document.getElementById("imageModelSelect");
const allowPaidModelsInput = document.getElementById("allowPaidModels");

const IMAGE_MODEL_STORAGE_KEY = "poseEditorImageModel_v1";
const INCLUDE_PAID_STORAGE_KEY = "poseEditorIncludePaidModels_v1";

let pose = createDefaultPose();
let jointRadius = 8;
let linkScale = 1;
/// How joints drag: "ik", "fk" or "free" (DRAG_MODES).
let dragMode = DEFAULT_DRAG_MODE;
/// Pinned IK ends (hands/feet). Editor state, not part of the pose or undo history.
let pins = [];

// Load saved state from localStorage, if any
const savedState = loadState();
if (savedState && savedState.pose && savedState.pose.joints) {
  pose = savedState.pose;
  if (typeof savedState.jointRadius === "number") {
    jointRadius = savedState.jointRadius;
  }
  if (typeof savedState.linkScale === "number") {
    linkScale = savedState.linkScale;
  }
  if (savedState.dragMode in DRAG_MODES) {
    dragMode = savedState.dragMode;
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
  pins,
  onChange: (newPose) => {
    pose = newPose;
  },
  onChangeEnd: (finalPose) => {
    pose = finalPose;
    pushHistory(finalPose);
    saveState();
    updatePosePreview();
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
  dragModes: Object.entries(DRAG_MODES).map(([id, { label }]) => ({ id, label })),
  onDragModeChange: setDragMode,
  presets: Object.entries(POSE_PRESETS).map(([id, { label }]) => ({ id, label })),
  onPresetSelect: (id) => commitPose(buildPresetPose(id, pose)),
  onCopySide: (side) => commitPose(copySide(pose, side)),
  onUnpinAll: () => skeleton.clearPins(),
});

updateUndoRedoState();
sidebar.setDragMode(dragMode);
sidebar.setPinCount(skeleton.getPins().length);
bindShortcuts();

const canvasMetaEl = document.getElementById("canvasMeta");
if (canvasMetaEl) canvasMetaEl.textContent = `Canvas: ${CANVAS.size} x ${CANVAS.size}`;

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
const jointSizeInput = document.getElementById("jointSizeInput");
if (jointSizeInput && typeof jointRadius === "number") {
  jointSizeInput.value = String(jointRadius);
}
const linkScaleInput = document.getElementById("linkScaleInput");
if (linkScaleInput && typeof linkScale === "number") {
  linkScaleInput.value = String(linkScale);
}

updatePosePreview();
initImageModelPicker();

if (closeInstructionsBtn) {
  closeInstructionsBtn.addEventListener("click", () => {
    if (instructionsEl) instructionsEl.style.display = "none";
  });
}

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
      pins,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore write errors
  }
}

function updatePosePreview() {
  if (!poseCanvas || !posePreviewEl) return;
  const dataUrl = poseCanvas.toDataURL("image/png");
  posePreviewEl.src = dataUrl;
  posePreviewEl.style.display = "block";
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
  updatePosePreview();
}

/// Apply a whole-pose edit (button, preset, shortcut) as one undoable step.
function commitPose(newPose) {
  showPose(newPose);
  pushHistory(pose);
}

/// Reset is undoable like any other edit, so the R shortcut is safe to hit.
function handleReset() {
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
  link.href = poseCanvas.toDataURL("image/png");
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
        inputImageEl.style.display = "block";
      }
      if (resultImageEl) {
        resultImageEl.style.display = "none";
        resultImageEl.src = "";
      }
      setAiStatus("Image loaded. Tap “Apply pose to image”.");
      setGenerateButtonDisabled(false);
    } else {
      setAiStatus("Could not read image.");
      setGenerateButtonDisabled(true);
    }
  };

  reader.onerror = () => {
    setAiStatus("Failed to load image.");
    setGenerateButtonDisabled(true);
  };

  reader.readAsDataURL(file);
}

async function handleGenerateImage() {
  if (!currentImageDataUrl || isGeneratingImage) {
    return;
  }

  isGeneratingImage = true;
  setAiStatus("Transforming pose with AI… (this can take a few seconds)");
  setGenerateButtonDisabled(true);

  try {
    const poseImageDataUrl = poseCanvas.toDataURL("image/png");
    const url = await generatePoseImage(currentImageDataUrl, pose, poseImageDataUrl);
    if (url && resultImageEl) {
      resultImageEl.src = url;
      resultImageEl.style.display = "block";
      setAiStatus("Done! Pose applied to image.");
    } else {
      setAiStatus("AI transform failed or is unavailable.");
    }
  } catch (e) {
    console.error(e);
    setAiStatus(`AI generation failed: ${e?.message || "unknown error"}`);
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
    setAiStatus(`Image model: ${model}`);
  });

  if (allowPaidModelsInput) {
    allowPaidModelsInput.addEventListener("change", () => {
      localStorage.setItem(INCLUDE_PAID_STORAGE_KEY, allowPaidModelsInput.checked ? "1" : "0");
      renderImageModelOptions();
    });
  }
}