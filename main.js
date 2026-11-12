import { createDefaultPose, normalizePose, clonePose, mirrorPose, copySide } from "./pose.js";
import { HAND_GESTURES, applyHandGesture } from "./handPoses.js";
import { POSE_STYLES, styleDrawsHands } from "./poseStyles.js";
import { SkeletonCanvas, isValidDrawOrder } from "./skeletonCanvas.js";
import { initSidebar } from "./sidebar.js";
import { POSE_PRESETS, buildPresetPose } from "./posePresets.js";
import { createDefaultView, normalizeView, isDefaultView, mirrorView, DEPTH_ENDS, isHand } from "./poseView.js";
import {
  SHORTCUTS,
  DRAG_MODES,
  DEFAULT_DRAG_MODE,
  DEFAULT_POSE_STYLE,
  DISPLAY_DEFAULTS,
  HANDS,
  VIEW,
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
const MODE3D_STORAGE_KEY = "poseEditor3d_v1";
let scene3d = null;
let mode3d = false;
let guide3d = null;
let render3dGuide = null;


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
/// Depth and camera (poseView.js). Editor state, like pins.
let view = createDefaultView();

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
  view = normalizeView(savedState.view);
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
  view,
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
  view: {
    cameras: Object.entries(VIEW.cameras).map(([value, { label }]) => ({ value, label })),
    sliders: [
      { key: "headScale", label: "Head size", ...VIEW.head },
      ...DEPTH_ENDS.map((key, i) => ({
        key,
        label: depthLabel(key),
        ...VIEW.depth,
        note: i === 0 ? "Hands and feet: + toward the camera, - away" : undefined,
      })),
    ],
    onCameraChange: (camera) => setView({ ...view, camera }),
    onSliderChange: (key, value) =>
      setView(key === "headScale" ? { ...view, headScale: value } : { ...view, depth: { ...view.depth, [key]: value } }),
    onReset: () => {
      setView(createDefaultView());
      showView();
    },
  },
});

updateUndoRedoState();
sidebar.setDragMode(dragMode);
sidebar.setStyle(styleId);
sidebar.setHandDetail(handDetail);
restoreApiKey();
sidebar.setPinCount(skeleton.getPins().length);
showView({ open: !isDefaultView(view) });
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

/// 3D is loaded only on request; the 2D pose and history remain untouched.
const sceneHost = document.getElementById("scene3d");
const mode2dButton = document.getElementById("mode2dBtn");
const mode3dButton = document.getElementById("mode3dBtn");
const depthButton = document.getElementById("depth3dBtn");
const reset3dButton = document.getElementById("reset3dBtn");
const frame = poseCanvas.parentElement;
function save3d() {
  if (scene3d) localStorage.setItem(MODE3D_STORAGE_KEY, JSON.stringify(scene3d.state()));
}
async function set3d(enabled) {
  if (enabled && !scene3d) {
    try {
      const { createScene } = await import("./mode3d/scene.js");
      ({ render3dGuide } = await import("./mode3d/guide.js"));
      const { FIGURE } = await import("./mode3d/config.js");
      const input = document.getElementById("fov3dInput");
      input.min = FIGURE.camera.minFov; input.max = FIGURE.camera.maxFov; input.step = FIGURE.camera.fovStep;
      const raw = localStorage.getItem(MODE3D_STORAGE_KEY);
      let saved = null; try { saved = raw && JSON.parse(raw); } catch { /* Ignore invalid saved 3D state. */ }
      scene3d = await createScene(sceneHost, save3d, saved);
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;left:-10000px;top:0";
      const canvas = document.createElement("canvas"); container.appendChild(canvas); document.body.appendChild(container);
      guide3d = new SkeletonCanvas(canvas, { joints: scene3d.project() }, { styleId: "body25hands", jointRadius, minorAxisScale: linkScale });
    } catch (error) { setAiStatus(`Could not load 3D mode: ${error.message}`); return; }
  }
  mode3d = enabled;
  const exportsHost = enabled ? document.getElementById('controls3dPanel') : document.querySelector('.tool-group-end');
  exportsHost.appendChild(document.getElementById('downloadBtn'));
  document.querySelector('.tool-group-end').hidden = enabled;
  document.getElementById("controls3dPanel").hidden = !enabled;
  if (scene3d) scene3d.setActive(enabled);
  document.getElementById("app").dataset.mode = enabled ? "3d" : "2d";
  sceneHost.hidden = !enabled;
  frame.querySelectorAll("#poseCanvas, .pose-grid, .pose-overlay").forEach((el) => { el.hidden = enabled; });
  depthButton.hidden = !enabled;
  document.getElementById("fov3dRow").hidden = !enabled;
  if (enabled) {
    const input = document.getElementById("fov3dInput"); input.value = scene3d.state().camera.fov;
    input.nextElementSibling.textContent = input.value;
  }
  document.getElementById("state3dBtn").hidden = !enabled;
  reset3dButton.hidden = !enabled;
  document.getElementById("finger3dBtn").hidden = !enabled;
  document.getElementById("preset3dSelect").hidden = !enabled;
  document.getElementById("transform3dGroup").hidden = !enabled;
  document.querySelectorAll("#dragModeGroup, #undoBtn, #redoBtn, #resetBtn, #pose2dPanel, #viewPanel").forEach((el) => { el.hidden = enabled; });
  document.querySelectorAll("#styleSelect, #handDetailGroup, #handDetailLabel").forEach((el) => { el.hidden = enabled; });
  mode2dButton.setAttribute("aria-pressed", String(!enabled));
  mode3dButton.setAttribute("aria-pressed", String(enabled));
  setAiStatus(enabled ? (scene3d.modelError || "Move hands, feet or hips; rotate joints to pose. Orbit by dragging empty space. Hidden joints remain in the guide.") : "");
}
mode2dButton.addEventListener("click", () => set3d(false));
mode3dButton.addEventListener("click", () => set3d(true));
depthButton.addEventListener("click", () => downloadData(scene3d.depthPNG(), "depth"));
document.getElementById("state3dBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(scene3d.state(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `pose-3d-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
reset3dButton.addEventListener("click", () => {
  scene3d.reset(); const input = document.getElementById("fov3dInput");
  input.value = scene3d.state().camera.fov; input.nextElementSibling.textContent = input.value;
});
document.getElementById("fov3dInput").addEventListener("input", (event) => {
  scene3d.setFov(event.target.value); event.target.nextElementSibling.textContent = event.target.value;
});
const preset3dSelect = document.getElementById("preset3dSelect");
const presetPlaceholder = document.createElement("option");
presetPlaceholder.value = ""; presetPlaceholder.textContent = "3D preset"; preset3dSelect.appendChild(presetPlaceholder);
for (const [id, preset] of Object.entries(POSE_PRESETS)) {
  const option = document.createElement("option"); option.value = id; option.textContent = preset.label; preset3dSelect.appendChild(option);
}
preset3dSelect.addEventListener("change", () => { if (preset3dSelect.value) scene3d.applyPreset(preset3dSelect.value); preset3dSelect.value = ""; });
document.getElementById("finger3dBtn").addEventListener("click", (event) => {
  const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(enabled)); scene3d.setFingerHandles(enabled);
});
for (const [id, mode] of [["move3dBtn", "translate"], ["rotate3dBtn", "rotate"]]) {
  document.getElementById(id).addEventListener("click", () => {
    scene3d.setMode(mode);
    document.getElementById("move3dBtn").setAttribute("aria-pressed", String(mode === "translate"));
    document.getElementById("rotate3dBtn").setAttribute("aria-pressed", String(mode === "rotate"));
  });
}
function current3dGuide() {
  return render3dGuide(scene3d, guide3d, jointRadius, linkScale);
}
function downloadData(url, name) {
  const link = document.createElement("a"); link.download = `${name}-${Date.now()}.png`; link.href = url;
  document.body.appendChild(link); link.click(); link.remove();
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
      styleId,
      handDetail,
      drawOrder,
      pins,
      view,
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
  setView(mirrorView(view));
  showView();
  commitPose(mirrorPose(pose));
}

/// Slider label for a depth end, by the figure's side like the hand menu: "Right hand".
function depthLabel(key) {
  const side = key.endsWith("_r") ? "Right" : "Left";
  return `${side} ${isHand(key) ? "hand" : "foot"}`;
}

function setView(next) {
  view = next;
  skeleton.setView(view);
  saveState();
}

/// Show the current view in the panel (after a change not made there).
function showView(options) {
  sidebar.setView({ camera: view.camera, values: { headScale: view.headScale, ...view.depth } }, options);
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
    if (mode3d || (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]"))) return;
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
  downloadData(mode3d ? current3dGuide().image : skeleton.toDataURL("image/png"), "pose");
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
    const guide = mode3d ? current3dGuide() : { pose, image: skeleton.toDataURL("image/png") };
    const semantics = mode3d ? scene3d.semanticState() : {};
    const url = await generatePoseImage(currentImageDataUrl, guide.pose, guide.image, {
      includeHands: mode3d || styleDrawsHands(styleId),
      worldJoints: semantics.worldJoints || null,
      surfaceFacing: semantics.surfaceFacing || {},
      view: mode3d ? guide.view : view,
      depthMode: mode3d ? "3d" : "2d",
    });
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