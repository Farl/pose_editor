/// Wire a button id to a handler, ignoring ids missing from the page.
function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el && handler) el.addEventListener("click", () => handler());
  return el;
}

/// Wire a range input to a numeric handler, falling back when the value is invalid.
function bindRange(id, handler, fallback) {
  const el = document.getElementById(id);
  if (el && handler) {
    el.addEventListener("input", (e) => handler(Number(e.target.value) || fallback));
  }
  return el;
}

export function initSidebar({
  onReset,
  onUndo,
  onRedo,
  onMirror,
  onDownload,
  onJointSizeChange,
  onLinkScaleChange,
  onImageFileChange,
  onGenerateImageClick,
  dragModes = [],
  onDragModeChange,
  presets = [],
  onPresetSelect,
  onCopySide,
  onUnpinAll,
}) {
  const undoBtn = bindClick("undoBtn", onUndo);
  const redoBtn = bindClick("redoBtn", onRedo);
  bindClick("resetBtn", onReset);
  bindClick("mirrorBtn", onMirror);
  bindClick("downloadBtn", onDownload);
  bindClick("generateImageBtn", onGenerateImageClick);
  bindClick("copyLeftBtn", onCopySide && (() => onCopySide("l")));
  bindClick("copyRightBtn", onCopySide && (() => onCopySide("r")));
  const unpinAllBtn = bindClick("unpinAllBtn", onUnpinAll);

  const jointSizeInput = document.getElementById("jointSizeInput");
  bindRange("jointSizeInput", onJointSizeChange, Number(jointSizeInput?.defaultValue));
  const linkScaleInput = document.getElementById("linkScaleInput");
  bindRange("linkScaleInput", onLinkScaleChange, Number(linkScaleInput?.defaultValue));

  const imageInput = document.getElementById("imageInput");
  if (imageInput) {
    imageInput.addEventListener("change", (e) => {
      const file = e.target?.files?.[0];
      if (file && onImageFileChange) onImageFileChange(file);
    });
  }

  // Drag mode: one toggle button per mode, the active one marked aria-pressed.
  const dragModeGroup = document.getElementById("dragModeGroup");
  const dragModeButtons = dragModes.map(({ id, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary segmented-btn";
    btn.textContent = label;
    btn.dataset.mode = id;
    btn.addEventListener("click", () => onDragModeChange && onDragModeChange(id));
    return btn;
  });
  if (dragModeGroup) dragModeGroup.append(...dragModeButtons);

  // Preset picker acts like a menu: choosing an entry applies it, then the
  // select returns to its placeholder so the same preset can be re-applied.
  const presetSelect = document.getElementById("presetSelect");
  if (presetSelect) {
    const placeholder = new Option("Choose a preset...", "");
    presetSelect.append(placeholder, ...presets.map(({ id, label }) => new Option(label, id)));
    presetSelect.addEventListener("change", () => {
      const id = presetSelect.value;
      presetSelect.value = "";
      if (id && onPresetSelect) onPresetSelect(id);
    });
  }

  function setUndoRedoState(canUndo, canRedo) {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  function setPinCount(count) {
    if (!unpinAllBtn) return;
    unpinAllBtn.disabled = count === 0;
    unpinAllBtn.textContent = count ? `Unpin all (${count})` : "Unpin all";
  }

  function setDragMode(mode) {
    for (const btn of dragModeButtons) btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  }

  return {
    setDragMode,
    setUndoRedoState,
    setPinCount,
  };
}
