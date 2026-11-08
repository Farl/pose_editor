/// Editor tunables: the single source of truth for sizes, picking tolerances,
/// overlay styling and keyboard shortcuts. Modules import from here instead of
/// hardcoding numbers. (AI/provider settings live in config.runtime.js, which
/// the Pages workflow regenerates on deploy.)

/// Logical drawing surface. The <canvas> width/height attributes are set from
/// this at startup, so the pose coordinate space and the export size agree.
export const CANVAS = {
  size: 800,
  gridStep: 40,
  gridColor: "rgba(82,82,91,0.35)",
};

export const CANVAS_CENTER = { x: CANVAS.size / 2, y: CANVAS.size / 2 };

/// Pointer picking. Radii are in *screen* pixels so a joint stays easy to hit
/// whatever size the canvas is displayed at; touch gets a fingertip-sized area.
export const PICKING = {
  radiusPx: { mouse: 18, pen: 18, touch: 32 },
  /// Two presses on the same joint within this window toggle its pin.
  doubleTapMs: 350,
};

/// How dragging a joint behaves. The mode is a sidebar toggle plus a one-key
/// shortcut (`key`, added to SHORTCUTS below); it is saved with the editor state.
///   ik    hands/feet: the limb follows, elbow/knee keeps its bend side
///         elbows/knees: pick the bend side, hand/foot stays (knees in -> out)
///   fk    every joint rotates the bone from its parent, children follow
///   free  only the grabbed joint moves; bone lengths may change, which is how
///         foreshortening (perspective) is drawn
/// In ik/fk the hips move the whole body and head, neck and shoulders rotate.
export const DRAG_MODES = {
  ik: { label: "IK", title: "Inverse kinematics", key: "i" },
  fk: { label: "FK", title: "Forward kinematics", key: "f" },
  free: { label: "Free", title: "Free move", key: "g" },
};

export const DEFAULT_DRAG_MODE = "ik";

/// Holding this modifier while dragging is a temporary "free" mode drag, so a
/// quick foreshortening tweak doesn't need a mode switch.
export const FREE_MOVE_MODIFIER = "altKey";

/// Interaction overlay (hover / drag / pin markers). Drawn on a separate layer
/// so it never ends up in Download PNG or the AI pose guide.
export const OVERLAY = {
  hoverColor: "rgba(255,255,255,0.55)",
  activeColor: "#ffffff",
  pinColor: "#f97316",
  ringGap: 4,
  ringWidth: 2,
  pinBoxPad: 6,
  pinNeedleLength: 10,
  pinHeadRadius: 3,
};

/// Keyboard shortcuts. `mod` means Ctrl on Windows/Linux and Cmd on macOS.
/// `action` names map to handlers in main.js; `arg` is passed to the handler.
/// `label` names the command in tooltips and the shortcuts panel.
export const SHORTCUTS = [
  { key: "z", mod: true, shift: false, action: "undo", label: "Undo" },
  { key: "z", mod: true, shift: true, action: "redo", label: "Redo" },
  { key: "y", mod: true, shift: false, action: "redo", label: "Redo" },
  { key: "r", mod: false, shift: false, action: "reset", label: "Reset pose" },
  { key: "m", mod: false, shift: false, action: "mirror", label: "Mirror" },
  { key: "p", mod: false, shift: false, action: "togglePin", label: "Pin hovered hand or foot" },
  ...Object.entries(DRAG_MODES).map(([id, { key, title }]) => ({
    key,
    mod: false,
    shift: false,
    action: "dragMode",
    arg: id,
    label: title,
  })),
];

/// Pointer gestures, listed in the shortcuts panel next to SHORTCUTS.
export const GESTURES = [
  { input: "Double-click or double-tap", label: "Pin hand or foot" },
  { input: "Alt + drag", label: "Free move, once" },
];
