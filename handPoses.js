/// Hand rig and hand gestures (OpenPose hand model, 21 keypoints per hand).
///
/// Keypoint 0 is the wrist (the body's wrist_<side> joint); 1-20 are four
/// joints per finger, base to tip, in this finger order. Keys are
/// "<finger><1-4>_<side>", e.g. index3_l, so side handling stays uniform with
/// the body joints. Depends only on editorConfig, so pose.js can build the
/// default hands from here without an import cycle.

import { HANDS } from "./editorConfig.js";

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
export const FINGER_JOINTS = 4;

export const handKey = (finger, n, side) => `${finger}${n}_${side}`;

/// The 20 finger keys of one hand in OpenPose order (keypoints 1-20).
export function fingerKeys(side) {
  return FINGERS.flatMap((f) => Array.from({ length: FINGER_JOINTS }, (_, i) => handKey(f, i + 1, side)));
}

/// Gestures as keypoints 1-20 in a palm frame: origin at the wrist, +y from the
/// wrist to the middle-finger knuckle (length 1), +x toward the thumb. Drawn
/// as seen from the back of the hand; placeHand() scales, rotates and mirrors.
const g = (...pts) => pts;
export const HAND_GESTURES = {
  relaxed: {
    label: "Relaxed",
    points: g(
      [0.3, 0.22], [0.48, 0.42], [0.55, 0.62], [0.55, 0.8],
      [0.25, 0.95], [0.25, 1.3], [0.22, 1.5], [0.18, 1.62],
      [0, 1], [0, 1.36], [-0.02, 1.58], [-0.04, 1.72],
      [-0.22, 0.95], [-0.24, 1.28], [-0.25, 1.47], [-0.26, 1.6],
      [-0.4, 0.86], [-0.44, 1.1], [-0.46, 1.25], [-0.47, 1.36],
    ),
  },
  open: {
    label: "Open",
    points: g(
      [0.35, 0.25], [0.6, 0.45], [0.8, 0.62], [0.98, 0.78],
      [0.3, 0.95], [0.36, 1.32], [0.4, 1.55], [0.43, 1.75],
      [0, 1], [0, 1.42], [0, 1.68], [0, 1.9],
      [-0.25, 0.95], [-0.3, 1.33], [-0.33, 1.57], [-0.35, 1.76],
      [-0.47, 0.85], [-0.58, 1.12], [-0.65, 1.3], [-0.7, 1.45],
    ),
  },
  fist: {
    label: "Fist",
    points: g(
      [0.3, 0.22], [0.45, 0.45], [0.38, 0.68], [0.2, 0.78],
      [0.27, 0.95], [0.3, 1.15], [0.27, 0.98], [0.25, 0.85],
      [0, 1], [0.02, 1.2], [0, 1.02], [-0.01, 0.88],
      [-0.22, 0.95], [-0.24, 1.13], [-0.23, 0.97], [-0.22, 0.84],
      [-0.42, 0.86], [-0.45, 1.02], [-0.43, 0.9], [-0.4, 0.8],
    ),
  },
  point: {
    label: "Point",
    points: g(
      [0.3, 0.22], [0.42, 0.45], [0.3, 0.66], [0.12, 0.75],
      [0.27, 0.95], [0.3, 1.35], [0.32, 1.6], [0.33, 1.82],
      [0, 1], [0.02, 1.2], [0, 1.02], [-0.01, 0.88],
      [-0.22, 0.95], [-0.24, 1.13], [-0.23, 0.97], [-0.22, 0.84],
      [-0.42, 0.86], [-0.45, 1.02], [-0.43, 0.9], [-0.4, 0.8],
    ),
  },
  peace: {
    label: "Peace",
    points: g(
      [0.3, 0.22], [0.42, 0.45], [0.3, 0.66], [0.12, 0.75],
      [0.27, 0.95], [0.4, 1.33], [0.48, 1.57], [0.54, 1.77],
      [0, 1], [0.05, 1.42], [0.08, 1.68], [0.1, 1.9],
      [-0.22, 0.95], [-0.24, 1.13], [-0.23, 0.97], [-0.22, 0.84],
      [-0.42, 0.86], [-0.45, 1.02], [-0.43, 0.9], [-0.4, 0.8],
    ),
  },
};

/// Place hand `side` in `joints` (mutated) from gesture `gestureId`.
/// `dir` is the unit vector from the wrist toward the knuckles and `palmLen`
/// the wrist-to-middle-knuckle distance. The thumb goes to the figure's
/// outside for a front-facing figure: image-left for the right hand.
export function placeHand(joints, side, gestureId, dir, palmLen) {
  const wrist = joints[`wrist_${side}`];
  const thumbSide = side === "r" ? 1 : -1;
  const xAxis = { x: -dir.y * thumbSide, y: dir.x * thumbSide };
  fingerKeys(side).forEach((key, i) => {
    const [gx, gy] = HAND_GESTURES[gestureId].points[i];
    joints[key] = {
      x: wrist.x + (gx * xAxis.x + gy * dir.x) * palmLen,
      y: wrist.y + (gx * xAxis.y + gy * dir.y) * palmLen,
    };
  });
}

/// Extended (true) or curled (false) for each finger of hand `side`, judged
/// by how straight the finger's chain is (HANDS.extendedStraightness).
export function fingerStates(joints, side) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return Object.fromEntries(
    FINGERS.map((f) => {
      const points = Array.from({ length: FINGER_JOINTS }, (_, i) => joints[handKey(f, i + 1, side)]);
      let length = 0;
      for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
      const straight = length ? dist(points[0], points[points.length - 1]) / length : 1;
      return [f, straight >= HANDS.extendedStraightness];
    })
  );
}

/// Re-pose an existing hand, keeping its size and the way the palm points.
export function applyHandGesture(joints, side, gestureId) {
  const wrist = joints[`wrist_${side}`];
  const knuckle = joints[handKey("middle", 1, side)];
  const palmLen = Math.hypot(knuckle.x - wrist.x, knuckle.y - wrist.y) || HANDS.minPalmLength;
  const dir = { x: (knuckle.x - wrist.x) / palmLen, y: (knuckle.y - wrist.y) / palmLen };
  placeHand(joints, side, gestureId, dir, palmLen);
}
