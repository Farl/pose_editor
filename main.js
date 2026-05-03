import { createDefaultPose, clonePose, mirrorPose } from "./pose.js";
import { SkeletonCanvas } from "./skeletonCanvas.js";
import { initSidebar } from "./sidebar.js";
import { generatePoseImage } from "./aiService.js";

const STORAGE_KEY = "poseEditorState_v1";

const poseCanvas = document.getElementById("poseCanvas");
const instructionsEl = document.getElementById("instructions");
const closeInstructionsBtn = document.getElementById("closeInstructions");
const resultImageEl = document.getElementById("resultImage");
const aiStatusEl = document.getElementById("aiStatus");
const generateImageBtn = document.getElementById("generateImageBtn");
const inputImageEl = document.getElementById("inputImagePreview");
const posePreviewEl = document.getElementById("posePreview");

let pose = createDefaultPose();
let jointRadius = 8;
let linkScale = 1;

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
}

let history = [clonePose(pose)];
let historyIndex = 0;

let currentImageDataUrl = null;
let isGeneratingImage = false;

const skeleton = new SkeletonCanvas(poseCanvas, pose, {
  jointRadius,
  minorAxisScale: linkScale,
  onChange: (newPose) => {
    pose = newPose;
  },
  onChangeEnd: (finalPose) => {
    pushHistory(finalPose);
    saveState();
    updatePosePreview();
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
});

sidebar.setUndoRedoState(historyIndex > 0, historyIndex < history.length - 1);

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

function pushHistory(newPose) {
  const snapshot = clonePose(newPose);
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  historyIndex = history.length - 1;
  sidebar.setUndoRedoState(historyIndex > 0, historyIndex < history.length - 1);
}

function handleReset() {
  pose = createDefaultPose();
  skeleton.setPose(pose);
  history = [clonePose(pose)];
  historyIndex = 0;
  sidebar.setUndoRedoState(false, false);
  saveState();
  updatePosePreview();
}

function handleUndo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  pose = clonePose(history[historyIndex]);
  skeleton.setPose(pose);
  sidebar.setUndoRedoState(historyIndex > 0, historyIndex < history.length - 1);
  saveState();
  updatePosePreview();
}

function handleRedo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  pose = clonePose(history[historyIndex]);
  skeleton.setPose(pose);
  sidebar.setUndoRedoState(historyIndex > 0, historyIndex < history.length - 1);
  saveState();
  updatePosePreview();
}

function handleMirror() {
  pose = mirrorPose(pose);
  skeleton.setPose(pose);
  pushHistory(pose);
  saveState();
  updatePosePreview();
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
    setAiStatus("Error while generating image.");
  } finally {
    isGeneratingImage = false;
    // Re-enable only if we still have a source image
    setGenerateButtonDisabled(!currentImageDataUrl);
  }
}