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
  /// On-screen backdrop behind the grid (exports use EXPORT_BACKGROUND).
  background: "#101215",
};

export const CANVAS_CENTER = { x: CANVAS.size / 2, y: CANVAS.size / 2 };

/// Starting values for the Display sliders (the user's choice is saved).
export const DISPLAY_DEFAULTS = {
  jointRadius: 6,
  linkScale: 1,
};

/// Hands (see handPoses.js).
export const HANDS = {
  /// Default wrist-to-middle-knuckle length as a fraction of the forearm.
  palmToForearm: 0.4,
  defaultGesture: "relaxed",
  /// Guards against a zero-length palm when re-posing a collapsed hand.
  minPalmLength: 1,
  /// Finger joints are drawn and picked at this fraction of the joint size.
  pointScale: 0.5,
  /// How much of the hand is posable on the canvas. Both keep all 21
  /// keypoints, so OpenPose-full output always has complete hands.
  ///   full    every finger joint
  ///   simple  wrist, palm (middle knuckle), thumb tip and fingertips
  ///           (the fingertip handle bends all four fingers together)
  details: {
    simple: { label: "Simple" },
    full: { label: "Full" },
  },
  defaultDetail: "simple",
  /// A finger counts as extended when its base-to-tip distance is at least
  /// this fraction of its joint chain's length (1 = perfectly straight).
  /// Used to spell hand shapes out in the AI prompt.
  extendedStraightness: 0.85,
  /// A hand counts as touching a body landmark when any of its keypoints is
  /// within this fraction of the torso length (neck to pelvis) of it.
  /// Used to spell hand contacts out in the AI prompt.
  contactDistance: 0.15,
};

/// Depth and camera (poseView.js): what a flat 2D skeleton cannot show. Every
/// setting defaults to "off", which leaves the guide and the prompt exactly as
/// without it. Set ones are drawn into the guide and spelled out in the prompt.
export const VIEW = {
  /// Camera height (the prompt wording is in aiService.js).
  cameras: {
    eye: { label: "Eye level" },
    low: { label: "Low angle" },
    high: { label: "High angle" },
  },
  defaultCamera: "eye",
  /// Per hand / foot distance from the body plane: -1 far, 0 level, +1 toward the camera.
  depth: { min: -1, max: 1, step: 0.1 },
  /// Limbs are drawn thicker when near: width x 2^(gain x depth), so +1 doubles, -1 halves.
  depthWidthGain: 1,
  /// |depth| from which a hand or foot is mentioned in the prompt, and from which
  /// it is described as thrust right at the camera.
  depthNear: 0.3,
  depthStrong: 0.7,
  /// Head size as a multiple of a realistic adult head; above 1 the guide draws
  /// a head outline and the prompt asks for that head-to-body ratio.
  head: { min: 1, max: 2.5, step: 0.1 },
  /// Realistic head radius as a fraction of the torso (neck to pelvis).
  headRadiusToTorso: 0.22,
  /// Head centre sits this many head radii from the neck toward the face.
  headCenterFromNeck: 1.1,
  /// Head outline colour (neutral, not an OpenPose limb colour) and its line
  /// width as a fraction of the joint size.
  headColor: "rgb(153, 153, 153)",
  headLineToJoint: 0.5,
};

/// Pose rendering styles live in poseStyles.js; this picks the default.
export const DEFAULT_POSE_STYLE = "coco18";

/// Exported images (Download PNG, AI pose guide) are drawn on this colour,
/// as OpenPose/ControlNet expect. The on-screen grid is never exported.
export const EXPORT_BACKGROUND = "#000000";

/// Colours for the side-coded style: figure's right, left and centre line.
export const SIDE_COLORS = {
  r: "#ef4444",
  l: "#3b82f6",
  c: "#22c55e",
};

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
  /// Rig joints the current style doesn't draw (e.g. the waist in OpenPose
  /// styles) still get a hollow handle so they can be grabbed.
  handleColor: "rgba(255,255,255,0.7)",
  handleWidth: 1.5,
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
