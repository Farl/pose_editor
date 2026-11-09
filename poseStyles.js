/// Pose rendering styles: how the rig is drawn on the canvas and in exports.
///
/// Each style turns a pose into a flat render list,
///   segments: { a, b, color, shape: "ellipse" | "line", width }
///   points:   { key, color, radius }
/// in rig joint keys. SkeletonCanvas stacks them (last-adjusted on top) and
/// draws rig joints a style leaves out as hollow, non-exported handles.
///
/// Sizes are relative to the editor's joint size `r` and link scale `k`:
/// at r = 4, k = 1 the OpenPose styles match the reference renderers
/// (stick half-width 4 px, keypoint radius 4 px).
///
/// References
///   COCO-18  ControlNet / OpenPose Python draw_bodypose: 18 keypoints,
///            17 limbs, limb i coloured OPENPOSE_COLORS[i] at 60 %, keypoint
///            j coloured OPENPOSE_COLORS[j].
///   BODY_25  OpenPose C++ renderer: 25 keypoints incl. MidHip and feet;
///            a limb takes the colour of its second keypoint.
///   Full     DWPose / ControlNet openpose_full: COCO-18 body plus 21-point
///            hands, each hand edge coloured by hue (edge / 20), keypoints blue.
///   Sides    Animation / mocap convention, editor-friendly: figure's right
///            red, left blue, centre line green (SIDE_COLORS); draws every rig bone.

import { JOINT_PARENT, sideOf, isFingerJoint } from "./pose.js";
import { fingerKeys } from "./handPoses.js";
import { SIDE_COLORS, HANDS } from "./editorConfig.js";

const OPENPOSE_COLORS = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0],
  [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255],
  [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

/// COCO-18 keypoints in OpenPose order, as rig joints.
const COCO18_KEYPOINTS = [
  "nose", "neck",
  "shoulder_r", "elbow_r", "wrist_r", "shoulder_l", "elbow_l", "wrist_l",
  "hip_r", "knee_r", "ankle_r", "hip_l", "knee_l", "ankle_l",
  "eye_r", "eye_l", "ear_r", "ear_l",
];

/// COCO-18 limbs as keypoint index pairs (the reference limbSeq, 0-based,
/// without the two ear-to-shoulder limbs the reference never draws).
const COCO18_LIMBS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];

/// BODY_25 keypoints in OpenPose order, as rig joints (MidHip is the pelvis).
const BODY25_KEYPOINTS = [
  "nose", "neck",
  "shoulder_r", "elbow_r", "wrist_r", "shoulder_l", "elbow_l", "wrist_l",
  "pelvis", "hip_r", "knee_r", "ankle_r", "hip_l", "knee_l", "ankle_l",
  "eye_r", "eye_l", "ear_r", "ear_l",
  "big_toe_l", "small_toe_l", "heel_l", "big_toe_r", "small_toe_r", "heel_r",
];

const BODY25_LIMBS = [
  [1, 8], [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11],
  [8, 12], [12, 13], [13, 14], [1, 0], [0, 15], [15, 17], [0, 16], [16, 18],
  [14, 19], [19, 20], [14, 21], [11, 22], [22, 23], [11, 24],
];

/// BODY_25 keypoint colours (OpenPose POSE_BODY_25_COLORS_RENDER).
const BODY25_COLORS = [
  [255, 0, 85], [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0],
  [85, 255, 0], [0, 255, 0], [255, 0, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255],
  [0, 170, 255], [0, 85, 255], [0, 0, 255], [255, 0, 170], [170, 0, 255], [255, 0, 255],
  [85, 0, 255], [0, 0, 255], [0, 0, 255], [0, 0, 255], [0, 255, 255], [0, 255, 255],
  [0, 255, 255],
];

/// OpenPose hand: 20 edges, wrist to each fingertip, as keypoint index pairs.
const HAND_EDGES = Array.from({ length: 20 }, (_, i) => [i % 4 === 0 ? 0 : i, i + 1]);
const HAND_POINT_COLOR = [0, 0, 255];
/// Reference hand line width and keypoint radius, relative to body (2/4 and 4/4).
const HAND_LINE_RATIO = 0.5;

/// Side-coded style: bone half-width as a fraction of its joint radius.
const SIDES_BONE_RATIO = 0.5;

/// Body limbs drawn at this brightness in COCO-18 (the reference's 60 % blend on black).
const COCO18_LIMB_DIM = 0.6;

const rgb = ([r, g, b], scale = 1) =>
  `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;

/// HSV with full saturation and value, hue in [0, 1), as an RGB triple.
function hueToRgb(h) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function coco18Body({ r, k }) {
  const kp = COCO18_KEYPOINTS;
  return {
    segments: COCO18_LIMBS.map(([i, j], n) => ({
      a: kp[i], b: kp[j], color: rgb(OPENPOSE_COLORS[n], COCO18_LIMB_DIM), shape: "ellipse", width: r * k,
    })),
    points: kp.map((key, n) => ({ key, color: rgb(OPENPOSE_COLORS[n]), radius: r })),
  };
}

function body25({ r, k }) {
  const kp = BODY25_KEYPOINTS;
  return {
    segments: BODY25_LIMBS.map(([i, j]) => ({
      a: kp[i], b: kp[j], color: rgb(BODY25_COLORS[j]), shape: "line", width: r * k,
    })),
    points: kp.map((key, n) => ({ key, color: rgb(BODY25_COLORS[n]), radius: r })),
  };
}

function openposeHands({ r, k }) {
  const segments = [];
  const points = [];
  for (const side of ["r", "l"]) {
    const kp = [`wrist_${side}`, ...fingerKeys(side)];
    HAND_EDGES.forEach(([i, j], n) => {
      segments.push({
        a: kp[i], b: kp[j], color: rgb(hueToRgb(n / HAND_EDGES.length)), shape: "line", width: r * k * HAND_LINE_RATIO,
      });
    });
    for (const key of kp.slice(1)) points.push({ key, color: rgb(HAND_POINT_COLOR), radius: r * HANDS.pointScale });
  }
  return { segments, points };
}

function sides({ r, k }) {
  const radius = (key) => (isFingerJoint(key) ? r * HANDS.pointScale : r);
  const keys = Object.keys(JOINT_PARENT);
  return {
    segments: keys
      .filter((key) => JOINT_PARENT[key])
      .map((key) => ({
        a: JOINT_PARENT[key], b: key, color: SIDE_COLORS[sideOf(key)], shape: "ellipse",
        width: radius(key) * k * SIDES_BONE_RATIO,
      })),
    points: keys.map((key) => ({ key, color: SIDE_COLORS[sideOf(key)], radius: radius(key) })),
  };
}

const merge = (...lists) => ({
  segments: lists.flatMap((l) => l.segments),
  points: lists.flatMap((l) => l.points),
});

export const POSE_STYLES = {
  coco18: { label: "OpenPose COCO-18", build: coco18Body },
  body25: { label: "OpenPose BODY_25", build: body25 },
  full: { label: "OpenPose full (DWPose)", build: (o) => merge(coco18Body(o), openposeHands(o)) },
  sides: { label: "Left / right", build: sides },
};

/// True when `styleId` draws finger keypoints, i.e. its exports show hand shapes.
export function styleDrawsHands(styleId) {
  return buildRenderList(styleId, 1, 1).points.some((p) => isFingerJoint(p.key));
}

/// Render list for `styleId` at joint size `jointRadius` and link scale `linkScale`.
export function buildRenderList(styleId, jointRadius, linkScale) {
  const style = POSE_STYLES[styleId] || POSE_STYLES.coco18;
  return style.build({ r: jointRadius, k: linkScale });
}
