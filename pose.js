import { CANVAS_CENTER, HANDS } from "./editorConfig.js";
import { FINGERS, FINGER_JOINTS, handKey, fingerKeys, placeHand } from "./handPoses.js";

/// Posing rig: every joint the editor knows, independent of how a style draws
/// it (poseStyles.js maps rig joints to OpenPose keypoints and colours).
///
/// Sides: "_r" / "_l" are the figure's right and left. The default figure
/// faces the viewer, so its right side is on the image's left, as OpenPose
/// expects. "waist" has no OpenPose keypoint; it exists so the torso can bend.

const SIDES = ["r", "l"];

/// Body hierarchy with one side written out; "<s>" is filled in per side.
/// Dragging a joint rotates the bone from its parent; the pelvis is the root.
const BODY_PARENT_TEMPLATE = {
  pelvis: null,
  waist: "pelvis",
  neck: "waist",
  nose: "neck",
  "eye_<s>": "nose",
  "ear_<s>": "nose",
  "shoulder_<s>": "neck",
  "elbow_<s>": "shoulder_<s>",
  "wrist_<s>": "elbow_<s>",
  "hip_<s>": "pelvis",
  "knee_<s>": "hip_<s>",
  "ankle_<s>": "knee_<s>",
  "heel_<s>": "ankle_<s>",
  "big_toe_<s>": "ankle_<s>",
  "small_toe_<s>": "ankle_<s>",
};

const forSides = (template) => SIDES.map((s) => template.replaceAll("<s>", s));

/// Parent of every rig joint (null for the root).
export const JOINT_PARENT = (() => {
  const parent = {};
  for (const [key, par] of Object.entries(BODY_PARENT_TEMPLATE)) {
    const keys = key.includes("<s>") ? forSides(key) : [key];
    keys.forEach((k, i) => {
      parent[k] = par && par.includes("<s>") ? par.replaceAll("<s>", SIDES[i]) : par;
    });
  }
  for (const side of SIDES) {
    for (const f of FINGERS) {
      for (let n = 1; n <= FINGER_JOINTS; n++) {
        parent[handKey(f, n, side)] = n === 1 ? `wrist_${side}` : handKey(f, n - 1, side);
      }
    }
  }
  return parent;
})();

/// All rig joints: body first, then hands. Also the default stacking order.
export const JOINT_KEYS = Object.keys(JOINT_PARENT);

/// Side of a joint: "r", "l", or "c" for the centre line.
export const sideOf = (key) => (key.endsWith("_r") ? "r" : key.endsWith("_l") ? "l" : "c");

/// True for finger joints (keypoints 1-20 of a hand).
export const isFingerJoint = (key) => FINGERS.some((f) => key.startsWith(f));

/// Two-bone IK chains keyed by their end effector: [root, mid, end].
/// These ends are the "grab a hand or a foot" handles and the only pinnable joints.
export const IK_CHAINS = Object.fromEntries(
  SIDES.flatMap((s) => [
    [`wrist_${s}`, [`shoulder_${s}`, `elbow_${s}`, `wrist_${s}`]],
    [`ankle_${s}`, [`hip_${s}`, `knee_${s}`, `ankle_${s}`]],
  ])
);

/// Joints that turn as one piece around their shared parent: grabbing any
/// member rotates all of them (with their children). Keyed by member.
///   palm  finger bases around the wrist, so the hand turns as a whole
///   foot  heel and toes around the ankle
export const RIGID_GROUP_OF = (() => {
  const groups = SIDES.flatMap((s) => [
    FINGERS.map((f) => handKey(f, 1, s)),
    [`heel_${s}`, `big_toe_${s}`, `small_toe_${s}`],
  ]);
  return Object.fromEntries(groups.flatMap((members) => members.map((m) => [m, members])));
})();

/// Simple hand detail (HANDS.details.simple): the only finger joints you can
/// grab, and what they move. Each handle measures its rotation around
/// `pivot`, then turns every [joint, around] pair by that angle.
///   middle1  palm: handled by RIGID_GROUP_OF (no entry needed)
///   thumb4   whole thumb from its base
///   middle4  all four fingers bend together at the knuckles
export const SIMPLE_HAND_HANDLES = Object.fromEntries(
  SIDES.flatMap((s) => [
    [handKey("middle", 1, s), null],
    [handKey("thumb", 4, s), { pivot: handKey("thumb", 1, s), turns: [[handKey("thumb", 2, s), handKey("thumb", 1, s)]] }],
    [
      handKey("middle", 4, s),
      {
        pivot: handKey("middle", 1, s),
        turns: FINGERS.filter((f) => f !== "thumb").map((f) => [handKey(f, 2, s), handKey(f, 1, s)]),
      },
    ],
  ])
);

/// Left/right counterparts, used by mirroring and side copying.
export const SIDE_PAIRS = JOINT_KEYS.filter((k) => k.endsWith("_l")).map((k) => [k, k.replace(/_l$/, "_r")]);

/// Neutral standing pose, figure's right side only, as offsets from the canvas
/// centre (pelvis). Left joints mirror these; hands come from HANDS.defaultGesture.
const DEFAULT_OFFSETS = {
  pelvis: [0, 0],
  waist: [0, -90],
  neck: [0, -180],
  nose: [0, -215],
  eye_r: [-11, -224],
  ear_r: [-25, -218],
  shoulder_r: [-70, -180],
  elbow_r: [-110, -110],
  wrist_r: [-130, -40],
  hip_r: [-45, 20],
  knee_r: [-40, 120],
  ankle_r: [-35, 220],
  heel_r: [-37, 232],
  big_toe_r: [-27, 249],
  small_toe_r: [-47, 245],
};

const at = ([dx, dy]) => ({ x: CANVAS_CENTER.x + dx, y: CANVAS_CENTER.y + dy });

/// Default hand for `side`: palm continues the forearm, sized from it.
function placeDefaultHand(joints, side) {
  const elbow = joints[`elbow_${side}`];
  const wrist = joints[`wrist_${side}`];
  const forearm = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const dir = { x: (wrist.x - elbow.x) / forearm, y: (wrist.y - elbow.y) / forearm };
  placeHand(joints, side, HANDS.defaultGesture, dir, forearm * HANDS.palmToForearm);
}

export function createDefaultPose() {
  const joints = {};
  for (const [key, [dx, dy]] of Object.entries(DEFAULT_OFFSETS)) {
    joints[key] = at([dx, dy]);
    if (key.endsWith("_r")) joints[key.replace(/_r$/, "_l")] = at([-dx, dy]);
  }
  for (const side of SIDES) placeDefaultHand(joints, side);
  return { joints };
}

/// Joints renamed since earlier versions: old key -> current key.
const LEGACY_KEYS = { head: "nose" };

/// Bring a saved pose up to the current rig: rename legacy joints, and add
/// any missing joint at its default offset from its parent (missing hands get
/// the default gesture). Returns a new pose; the input is left alone.
///
/// Poses from before this rig (they have a "head" joint) used "_l" for the
/// image's left; their sides are swapped so the figure faces the viewer,
/// matching the head, feet and hands added here.
export function normalizePose(pose) {
  const source = pose.joints || {};
  const joints = {};
  for (const [key, p] of Object.entries(source)) {
    joints[LEGACY_KEYS[key] || key] = { x: p.x, y: p.y };
  }
  if ("head" in source) swapSides(joints);
  const defaults = createDefaultPose().joints;
  for (const side of SIDES) {
    if (joints[`wrist_${side}`] && fingerKeys(side).some((k) => !joints[k])) {
      if (!joints[`elbow_${side}`]) continue;
      placeDefaultHand(joints, side);
    }
  }
  for (const key of JOINT_KEYS) {
    if (joints[key]) continue;
    const parentKey = JOINT_PARENT[key];
    const parent = parentKey && joints[parentKey];
    joints[key] = parent
      ? { x: parent.x + defaults[key].x - defaults[parentKey].x, y: parent.y + defaults[key].y - defaults[parentKey].y }
      : { ...defaults[key] };
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
