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

/// Wire a range input to a numeric handler. A range input always holds a
/// number within its min/max, so no validation is needed.
function bindRange(id, handler) {
  const el = document.getElementById(id);
  if (!el) return el;
  showRangeValue(el);
  el.addEventListener("input", () => {
    showRangeValue(el);
    if (handler) handler(Number(el.value));
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

/// Segmented toggle in container `groupId`: one button per {id, label, title},
/// the active one marked aria-pressed. Returns a setter for the active id.
/// `shortcutAction` names the SHORTCUTS action whose `arg` is the item id.
function bindSegmented(groupId, items, onChange, shortcutAction) {
  const group = document.getElementById(groupId);
  const buttons = items.map(({ id, label, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-btn";
    btn.textContent = label;
    btn.dataset.value = id;
    if (title) nameControl(btn, title, shortcutAction && findShortcut(shortcutAction, id));
    btn.addEventListener("click", () => onChange && onChange(id));
    return btn;
  });
  if (group) group.append(...buttons);
  return (value) => {
    for (const btn of buttons) btn.setAttribute("aria-pressed", String(btn.dataset.value === value));
  };
}

/// A <select> used as a menu: picking an entry calls `onSelect(value)`, then it
/// returns to its placeholder so the same entry can be picked again.
/// `groups` is [{ label?, options: [{ value, label }] }]; labelled groups
/// become <optgroup>s.
function bindMenuSelect(id, placeholder, groups, onSelect) {
  const select = document.getElementById(id);
  if (!select) return;
  const first = new Option(placeholder, "");
  first.disabled = true;
  select.append(first);
  for (const { label, options } of groups) {
    const opts = options.map((o) => new Option(o.label, o.value));
    if (label) {
      const group = document.createElement("optgroup");
      group.label = label;
      group.append(...opts);
      select.append(group);
    } else {
      select.append(...opts);
    }
  }
  select.value = "";
  select.addEventListener("change", () => {
    const value = select.value;
    select.value = "";
    if (value && onSelect) onSelect(value);
  });
}

/// A plain <select> holding a setting. Returns a setter for its value.
function bindSelect(id, options, onChange) {
  const select = document.getElementById(id);
  if (!select) return () => {};
  select.append(...options.map((o) => new Option(o.label, o.value)));
  select.addEventListener("change", () => onChange && onChange(select.value));
  return (value) => {
    select.value = value;
  };
}

/// Depth and camera panel (#viewPanel): the camera <select> plus one slider
/// per `sliders` entry ({ key, label, min, max, step, note? }); an entry with
/// a `note` starts a group under that caption. Returns a setter that shows a
/// view ({ camera, values: { key: number } }) and opens the panel when asked.
function bindViewPanel({ cameras, sliders, onCameraChange, onSliderChange, onReset }) {
  const panel = document.getElementById("viewPanel");
  const container = document.getElementById("viewSliders");
  const setCamera = bindSelect("cameraSelect", cameras, onCameraChange);
  bindClick("resetViewBtn", onReset);
  const inputs = {};
  for (const { key, label, min, max, step, note } of sliders) {
    if (note) {
      const caption = document.createElement("p");
      caption.className = "panel-note";
      caption.textContent = note;
      container?.append(caption);
    }
    const row = document.createElement("label");
    row.className = "slider-row";
    const name = document.createElement("span");
    name.textContent = label;
    const input = Object.assign(document.createElement("input"), { type: "range", id: `view-${key}`, min, max, step });
    const out = document.createElement("output");
    out.htmlFor = input.id;
    row.append(name, input, out);
    container?.append(row);
    inputs[key] = input;
  }
  // Bound after the rows are in the page, so the <output>s can be found.
  for (const [key, input] of Object.entries(inputs)) bindRange(input.id, (v) => onSliderChange?.(key, v));

  return ({ camera, values }, { open = false } = {}) => {
    setCamera(camera);
    for (const [key, input] of Object.entries(inputs)) {
      input.value = String(values[key]);
      showRangeValue(input);
    }
    if (panel && open) panel.open = true;
  };
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
  styles = [],
  onStyleChange,
  handDetails = [],
  onHandDetailChange,
  handPoseGroups = [],
  onHandPoseSelect,
  apiKeyUrl,
  onApiKeyChange,
  presets = [],
  onPresetSelect,
  onCopySide,
  onUnpinAll,
  view,
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

  const setDragMode = bindSegmented("dragModeGroup", dragModes, onDragModeChange, "dragMode");
  const setHandDetail = bindSegmented("handDetailGroup", handDetails, onHandDetailChange);
  const setStyle = bindSelect("styleSelect", styles, onStyleChange);
  bindMenuSelect("presetSelect", "Preset pose", [{ options: presets }], onPresetSelect);
  bindMenuSelect("handPoseSelect", "Hand pose", handPoseGroups, onHandPoseSelect);
  const setView = view ? bindViewPanel(view) : () => {};

  // API key: kept by the caller (this browser only), sent only to the provider.
  const apiKeyInput = document.getElementById("apiKeyInput");
  if (apiKeyInput && onApiKeyChange) {
    apiKeyInput.addEventListener("input", () => onApiKeyChange(apiKeyInput.value));
  }
  const apiKeyLink = document.getElementById("apiKeyLink");
  if (apiKeyLink && apiKeyUrl) apiKeyLink.href = apiKeyUrl;

  function setApiKey(key) {
    if (apiKeyInput) apiKeyInput.value = key || "";
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
    setHandDetail,
    setStyle,
    setApiKey,
    setUndoRedoState,
    setPinCount,
    setRangeValue,
    setView,
  };
}
