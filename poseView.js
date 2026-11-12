/// Depth and camera: the third dimension a 2D OpenPose skeleton leaves out.
///
/// A view is editor state next to the pose (saved, not part of undo):
///   camera     "eye" | "low" | "high"  (VIEW.cameras)
///   depth      { jointKey: -1 far .. +1 toward the camera }. Hands and feet
///              (DEPTH_ENDS) are always listed; any other body joint is listed
///              only once its depth is set on its own (the Depth tool), and
///              otherwise follows the joints around it (jointDepth)
///   headScale  head size as a multiple of a realistic adult head (1 = normal)
///
/// SkeletonCanvas draws it into the guide (near limbs thicker and on top, a head
/// outline for big heads) and aiService spells it out in the prompt. The
/// default view changes neither, so posing without it works as before.

import { VIEW } from "./editorConfig.js";
import { IK_CHAINS, JOINT_KEYS, JOINT_PARENT, SIDE_PAIRS, isFingerJoint, createDefaultPose } from "./pose.js";

/// True for a hand's depth end (its wrist); the other ends are feet (ankles).
export const isHand = (key) => key.startsWith("wrist");

/// Hands and feet that take a depth: the IK chain ends, hands first.
export const DEPTH_ENDS = Object.keys(IK_CHAINS).sort((a, b) => isHand(b) - isHand(a));

/// Joints that can hold a depth of their own: every body joint. A finger
/// takes its hand's depth (depthKey).
export const DEPTH_JOINTS = JOINT_KEYS.filter((k) => !isFingerJoint(k));

/// The joint whose depth `key` shows and sets: the wrist for a finger, else itself.
export function depthKey(key) {
  let k = key;
  while (isFingerJoint(k)) k = JOINT_PARENT[k];
  return k;
}

export function createDefaultView() {
  return {
    camera: VIEW.defaultCamera,
    depth: Object.fromEntries(DEPTH_ENDS.map((k) => [k, 0])),
    headScale: VIEW.head.min,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const numberOr = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/// A saved view brought into range, with defaults for anything missing.
export function normalizeView(saved) {
  const view = createDefaultView();
  if (!saved || typeof saved !== "object") return view;
  if (saved.camera in VIEW.cameras) view.camera = saved.camera;
  for (const k of DEPTH_JOINTS) {
    const v = saved.depth?.[k];
    if (k in view.depth || typeof v === "number") view.depth[k] = clamp(numberOr(v, 0), VIEW.depth.min, VIEW.depth.max);
  }
  view.headScale = clamp(numberOr(saved.headScale, VIEW.head.min), VIEW.head.min, VIEW.head.max);
  return view;
}

/// True when the view adds nothing to the guide or the prompt.
export function isDefaultView(view) {
  const def = createDefaultView();
  return (
    view.camera === def.camera &&
    view.headScale === def.headScale &&
    Object.values(view.depth).every((d) => d === 0)
  );
}

/// Left/right counterpart of a joint (itself on the centre line).
const MIRROR_KEY = Object.fromEntries(SIDE_PAIRS.flatMap(([l, r]) => [[l, r], [r, l]]));

/// The view for a mirrored pose: every depth moves to the other side.
export function mirrorView(view) {
  const depth = Object.fromEntries(Object.entries(view.depth).map(([k, d]) => [MIRROR_KEY[k] || k, d]));
  return { ...view, depth };
}

/// Elbows and knees: [root, end] of their limb (IK_CHAINS).
const LIMB_OF_MID = Object.fromEntries(Object.values(IK_CHAINS).map(([root, mid, end]) => [mid, [root, end]]));

/// Depth `key` would have without a depth of its own: an elbow or knee lies
/// halfway between its shoulder / hip and its hand / foot; any other joint
/// follows its parent (the root, the pelvis, is at 0). So a hand's depth
/// carries its fingers and half its elbow, and a neck's carries the head and
/// shoulders.
export function derivedDepth(view, key) {
  const limb = LIMB_OF_MID[key];
  if (limb) return (jointDepth(view, limb[0]) + jointDepth(view, limb[1])) / 2;
  const parent = JOINT_PARENT[key];
  return parent ? jointDepth(view, parent) : 0;
}

/// Depth of any rig joint: its own if set in view.depth, else derivedDepth.
export function jointDepth(view, key) {
  return key in view.depth ? view.depth[key] : derivedDepth(view, key);
}

/// `view` with joint `key` (a DEPTH_JOINTS key) at depth `value`. A value
/// equal to what the joint would derive anyway drops its own entry, except
/// for hands and feet, which always keep one.
export function setJointDepth(view, key, value) {
  const depth = { ...view.depth };
  delete depth[key];
  if (DEPTH_ENDS.includes(key) || value !== derivedDepth({ ...view, depth }, key)) depth[key] = value;
  return { ...view, depth };
}

/// Drawing scale for a joint: near joints thicker, far ones thinner. Fingers
/// keep their size so a near hand's gesture stays readable.
export function depthScale(view, key) {
  return isFingerJoint(key) ? 1 : 2 ** (VIEW.depthWidthGain * jointDepth(view, key));
}

/// Drawing scale for a bone: the mean of its ends, but finger bones (palm
/// edges included) keep their width, like finger joints.
export function segmentDepthScale(view, a, b) {
  if (isFingerJoint(a) || isFingerJoint(b)) return 1;
  return (depthScale(view, a) + depthScale(view, b)) / 2;
}

const FACE_KEYS = ["nose", "eye_r", "eye_l", "ear_r", "ear_l"];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (joints, keys) => keys.slice(1).reduce((sum, k, i) => sum + dist(joints[keys[i]], joints[k]), 0);

/// Face centre and the head radius the face keypoints imply (VIEW.headRadiusToFaceSpan).
function faceHead(joints) {
  const face = FACE_KEYS.map((k) => joints[k]);
  const center = {
    x: face.reduce((s, p) => s + p.x, 0) / face.length,
    y: face.reduce((s, p) => s + p.y, 0) / face.length,
  };
  const span = Math.max(...face.flatMap((a) => face.map((b) => dist(a, b))));
  const reach = dist(center, joints.neck);
  return { center, reach, radius: Math.max(span * VIEW.headRadiusToFaceSpan, reach * VIEW.headRadiusToNeckReach) };
}

/// Body lengths that each predict a realistic head size. A pose foreshortens
/// some of them, so headCircle trusts whichever predicts the biggest head.
const BODY_MEASURES = [
  ["neck", "pelvis"],
  ["shoulder_r", "shoulder_l"],
  ...["r", "l"].flatMap((s) => [
    [`shoulder_${s}`, `elbow_${s}`, `wrist_${s}`],
    [`hip_${s}`, `knee_${s}`, `ankle_${s}`],
  ]),
];

/// Head radius per unit of each measure, taken from the default (realistic) figure.
const HEAD_PER_MEASURE = (() => {
  const { joints } = createDefaultPose();
  const head = faceHead(joints).radius;
  return BODY_MEASURES.map((keys) => head / pathLength(joints, keys));
})();

/// Realistic head radius for this body, from its least foreshortened measure.
function bodyHeadRadius(joints) {
  return Math.max(...BODY_MEASURES.map((keys, i) => pathLength(joints, keys) * HEAD_PER_MEASURE[i]));
}

/// Head outline for headScale > 1, or null: { x, y, radius }.
///   size      headScale x a realistic head for this body (bodyHeadRadius), so
///             a foreshortened torso doesn't shrink it; never smaller than the
///             head the face keypoints already draw (faceHead)
///   position  on the face, grown away from the neck with the chin kept in
///             place, so the face ends up in the lower half of a big head
export function headCircle(joints, view) {
  if (view.headScale <= VIEW.head.min) return null;
  const face = faceHead(joints);
  const radius = Math.max(view.headScale * bodyHeadRadius(joints), face.radius);
  const grow = face.reach ? (radius - face.radius) / face.reach : 0;
  const { center } = face;
  return {
    x: center.x + (center.x - joints.neck.x) * grow,
    y: center.y + (center.y - joints.neck.y) * grow,
    radius,
  };
}
