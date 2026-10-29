import { CANVAS_CENTER } from "./editorConfig.js";

/// OpenPose-style 15-point skeleton. Order matters: it drives joint colours.
export const JOINT_KEYS = [
  "head",
  "neck",
  "shoulder_l",
  "shoulder_r",
  "elbow_l",
  "elbow_r",
  "wrist_l",
  "wrist_r",
  "hip_l",
  "hip_r",
  "knee_l",
  "knee_r",
  "ankle_l",
  "ankle_r",
  "pelvis",
];

/// Drawn links. The first joint of each pair picks the link colour, so this is
/// a render table and intentionally independent of JOINT_PARENT below.
export const BONES = [
  ["head", "neck"],
  ["neck", "shoulder_l"],
  ["neck", "shoulder_r"],
  ["shoulder_l", "elbow_l"],
  ["elbow_l", "wrist_l"],
  ["shoulder_r", "elbow_r"],
  ["elbow_r", "wrist_r"],
  ["neck", "pelvis"],
  ["pelvis", "hip_l"],
  ["pelvis", "hip_r"],
  ["hip_l", "knee_l"],
  ["knee_l", "ankle_l"],
  ["hip_r", "knee_r"],
  ["knee_r", "ankle_r"],
];

/// Rig hierarchy used for posing: dragging a joint rotates the bone from its
/// parent, and everything below it follows. The pelvis is the root (null).
export const JOINT_PARENT = {
  pelvis: null,
  neck: "pelvis",
  head: "neck",
  shoulder_l: "neck",
  shoulder_r: "neck",
  elbow_l: "shoulder_l",
  elbow_r: "shoulder_r",
  wrist_l: "elbow_l",
  wrist_r: "elbow_r",
  hip_l: "pelvis",
  hip_r: "pelvis",
  knee_l: "hip_l",
  knee_r: "hip_r",
  ankle_l: "knee_l",
  ankle_r: "knee_r",
};

/// Two-bone IK chains keyed by their end effector: [root, mid, end].
/// These ends are the "grab a hand or a foot" handles and the only pinnable joints.
export const IK_CHAINS = {
  wrist_l: ["shoulder_l", "elbow_l", "wrist_l"],
  wrist_r: ["shoulder_r", "elbow_r", "wrist_r"],
  ankle_l: ["hip_l", "knee_l", "ankle_l"],
  ankle_r: ["hip_r", "knee_r", "ankle_r"],
};

/// Left/right counterparts, used by mirroring and side copying.
export const SIDE_PAIRS = [
  ["shoulder_l", "shoulder_r"],
  ["elbow_l", "elbow_r"],
  ["wrist_l", "wrist_r"],
  ["hip_l", "hip_r"],
  ["knee_l", "knee_r"],
  ["ankle_l", "ankle_r"],
];

/// Neutral standing pose, as offsets from the canvas centre (pelvis).
const DEFAULT_OFFSETS = {
  head: [0, -220],
  neck: [0, -180],
  shoulder_l: [-70, -180],
  shoulder_r: [70, -180],
  elbow_l: [-110, -110],
  elbow_r: [110, -110],
  wrist_l: [-130, -40],
  wrist_r: [130, -40],
  pelvis: [0, 0],
  hip_l: [-45, 20],
  hip_r: [45, 20],
  knee_l: [-40, 120],
  knee_r: [40, 120],
  ankle_l: [-35, 220],
  ankle_r: [35, 220],
};

export function createDefaultPose() {
  const joints = {};
  for (const [key, [dx, dy]] of Object.entries(DEFAULT_OFFSETS)) {
    joints[key] = { x: CANVAS_CENTER.x + dx, y: CANVAS_CENTER.y + dy };
  }
  return { joints };
}

export function clonePose(pose) {
  return JSON.parse(JSON.stringify(pose));
}

/// Swap every left/right pair in place.
function swapSides(joints) {
  for (const [l, r] of SIDE_PAIRS) {
    [joints[l], joints[r]] = [joints[r], joints[l]];
  }
}

/// Flip the whole figure horizontally around a vertical axis.
export function mirrorPose(pose, centerX = CANVAS_CENTER.x) {
  const mirrored = clonePose(pose);
  for (const key of Object.keys(mirrored.joints)) {
    const j = mirrored.joints[key];
    mirrored.joints[key] = { x: 2 * centerX - j.x, y: j.y };
  }
  swapSides(mirrored.joints);
  return mirrored;
}

/// Reflect point p across the line through a and b.
function reflectAcrossLine(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

/// Make one side's limbs the mirror image of the other's, reflected across the
/// spine (pelvis to neck) so it stays symmetric even when the torso leans.
/// `fromSide` is "l" or "r": the side that is copied.
export function copySide(pose, fromSide) {
  const copied = clonePose(pose);
  const { pelvis, neck } = copied.joints;
  for (const [l, r] of SIDE_PAIRS) {
    const [src, dst] = fromSide === "l" ? [l, r] : [r, l];
    copied.joints[dst] = reflectAcrossLine(copied.joints[src], pelvis, neck);
  }
  return copied;
}
