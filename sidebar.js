import { SHORTCUTS, GESTURES } from "./editorConfig.js";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/// Human-readable key combo for a SHORTCUTS entry, e.g. "Cmd+Shift+Z" or "M".
function formatKeys({ key, mod, shift }) {
  return [mod && (IS_MAC ? "Cmd" : "Ctrl"), shift && "Shift", key.toUpperCase()]
    .filter(Boolean)
    .join("+");
}

/// SHORTCUTS grouped by command label: [{ label, keys: ["Cmd+Shift+Z", ...] }].
function groupShortcuts() {
  const groups = new Map();
  for (const s of SHORTCUTS) {
    if (!groups.has(s.label)) groups.set(s.label, []);
    groups.get(s.label).push(formatKeys(s));
  }
  return [...groups].map(([label, keys]) => ({ label, keys }));
}

/// First shortcut bound to `action` (and `arg`, if given), or undefined.
function findShortcut(action, arg) {
  return SHORTCUTS.find((s) => s.action === action && (arg === undefined || s.arg === arg));
}

/// Name a control for tooltips and screen readers: "Undo  Cmd+Z".
/// Icon buttons have no text, so the tooltip is how they explain themselves.
function nameControl(el, name, shortcut) {
  el.setAttribute("aria-label", name);
  el.dataset.tip = shortcut ? `${name}  ${formatKeys(shortcut)}` : name;
  if (shortcut) el.setAttribute("aria-keyshortcuts", formatKeys(shortcut).replace("Cmd", "Meta"));
}

/// Wire a button id to a handler, ignoring ids missing from the page. Buttons
/// with data-action get their tooltip from the matching shortcut.
function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return el;
  if (handler) el.addEventListener("click", () => handler());
  const shortcut = el.dataset.action && findShortcut(el.dataset.action);
  if (shortcut) nameControl(el, shortcut.label, shortcut);
  return el;
}

/// Show a range input's value in its <output for="id">, with as many
/// decimals as its step (step 0.1 shows "1.0", not "1").
function showRangeValue(el) {
  const out = document.querySelector(`output[for="${el.id}"]`);
  const decimals = (el.step.split(".")[1] || "").length;
  if (out) out.textContent = Number(el.value).toFixed(decimals);
}

/// Wire a range input to a numeric handler, falling back when the value is invalid.
function bindRange(id, handler) {
  const el = document.getElementById(id);
  if (!el) return el;
  const fallback = Number(el.defaultValue);
  showRangeValue(el);
  el.addEventListener("input", () => {
    showRangeValue(el);
    if (handler) handler(Number(el.value) || fallback);
  });
  return el;
}

/// Accept an image dropped onto `zone`, in addition to its file input.
function bindImageDrop(zone, onFile) {
  if (!zone || !onFile) return;
  const setOver = (over) => zone.classList.toggle("is-over", over);
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    setOver(true);
  });
  zone.addEventListener("dragleave", () => setOver(false));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    setOver(false);
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) onFile(file);
  });
}

/// Fill the shortcuts panel from SHORTCUTS and GESTURES.
function renderShortcutList(list) {
  if (!list) return;
  const rows = [
    ...groupShortcuts().map(({ label, keys }) => [keys.join(", "), label]),
    ...GESTURES.map(({ input, label }) => [input, label]),
  ];
  for (const [keys, label] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = keys;
    list.append(dt, dd);
  }
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

  bindRange("jointSizeInput", onJointSizeChange);
  bindRange("linkScaleInput", onLinkScaleChange);

  const imageInput = document.getElementById("imageInput");
  if (imageInput) {
    imageInput.addEventListener("change", (e) => {
      const file = e.target?.files?.[0];
      if (file && onImageFileChange) onImageFileChange(file);
    });
  }
  bindImageDrop(document.getElementById("imageDrop"), onImageFileChange);

  renderShortcutList(document.getElementById("shortcutList"));

  // Drag mode: one toggle button per mode, the active one marked aria-pressed.
  const dragModeGroup = document.getElementById("dragModeGroup");
  const dragModeButtons = dragModes.map(({ id, label, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-btn";
    btn.textContent = label;
    btn.dataset.mode = id;
    nameControl(btn, title, findShortcut("dragMode", id));
    btn.addEventListener("click", () => onDragModeChange && onDragModeChange(id));
    return btn;
  });
  if (dragModeGroup) dragModeGroup.append(...dragModeButtons);

  // Preset picker acts like a menu: choosing an entry applies it, then the
  // select returns to its placeholder so the same preset can be re-applied.
  const presetSelect = document.getElementById("presetSelect");
  if (presetSelect) {
    const placeholder = new Option("Preset pose", "");
    placeholder.disabled = true;
    presetSelect.append(placeholder, ...presets.map(({ id, label }) => new Option(label, id)));
    presetSelect.value = "";
    presetSelect.addEventListener("change", () => {
      const id = presetSelect.value;
      presetSelect.value = "";
      if (id && onPresetSelect) onPresetSelect(id);
    });
  }

  function setDragMode(mode) {
    for (const btn of dragModeButtons) btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  }

  function setUndoRedoState(canUndo, canRedo) {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  /// "Unpin all" only exists while something is pinned.
  function setPinCount(count) {
    if (!unpinAllBtn) return;
    unpinAllBtn.hidden = count === 0;
    unpinAllBtn.textContent = `Unpin all (${count})`;
  }

  /// Set a slider from saved state and show its value.
  function setRangeValue(id, value) {
    const el = document.getElementById(id);
    if (!el || typeof value !== "number") return;
    el.value = String(value);
    showRangeValue(el);
  }

  return {
    setDragMode,
    setUndoRedoState,
    setPinCount,
    setRangeValue,
  };
}
