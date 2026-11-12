/// The procedural mannequin is deliberately separate from external model assets.
export const FIGURE = Object.freeze({
  rigDerivation: { earEyeSpan: 0.5, heelLength: 0.2, outerToeWidth: 0.3 },
  surfaceNormalSign: { palm: -1, sole: 1 },
  surfaceFacingCosine: 0.7,
  model: {
    url: "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/models/fbx/Samba%20Dancing.fbx",
    unitScale: 0.01,
    headWeight: 0.4,
  },
  scale: 0.005,
  cameraPitchThreshold: 0.3,
  head: [0.16, 0.22, 0.15],
  torso: [0.25, 0.38, 0.13],
  pelvis: [0.21, 0.14, 0.13],
  limbRadius: 0.07,
  fingerRadius: 0.012,
  fingerHandleRadius: 0.024,
  palm: [0.07, 0.1, 0.025],
  foot: [0.12, 0.18, 0.05],
  footRigScale: 2,
  jointRadius: 0.045,
  handleRadius: 0.065,
  camera: { fov: 38, minFov: 20, maxFov: 100, fovStep: 1, near: 0.1, far: 20, position: [0, 1, 5], target: [0, 0, 0] },
});

/// Camera and selection controls of the 3D view (scene.js, axisGizmo.js).
export const CONTROLS = Object.freeze({
  /// Directions from the orbit target toward the camera; the figure faces +Z.
  /// The view keys (SHORTCUTS "view3d") use these ids; the axis gizmo snaps
  /// to any world axis. Straight up or down leans `verticalLean` toward +Z,
  /// as a camera looking straight down has no defined "up" for the orbit.
  views: { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0] },
  verticalLean: 1e-3,
  /// Framing (F, 0): the joints fill the view with this much margin (radius
  /// multiplier), never tighter than `frameMinRadius` world units.
  framePad: 1.25,
  frameMinRadius: 0.15,
  /// Camera moves to a view or a framing over this many milliseconds.
  transitionMs: 250,
  /// Orbit inertia (OrbitControls dampingFactor; 0 turns damping off).
  damping: 0.15,
  /// A press that moves less than this (CSS px) is a click: it selects what
  /// is under it, or clears the selection on empty space.
  tapSlopPx: 6,
  /// Depth tool: world units per CSS px of vertical drag, as a multiple of
  /// what one pixel spans at the joint's distance (so it tracks the pointer).
  depthDragGain: 1,
  /// Handle colours: normal and selected.
  handleColor: 0x60b9eb,
  selectedColor: 0xffffff,
  /// Corner axis gizmo: overall size, axis length and end-dot radii (CSS px),
  /// and the colour of each world axis.
  gizmo: {
    sizePx: 76,
    axisPx: 28,
    endPx: 8,
    negativeEndPx: 5,
    colors: { x: "#ef4444", y: "#22c55e", z: "#3b82f6" },
  },
});
