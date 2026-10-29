/// Posing solver: turns "drag this joint to here" into a whole-skeleton update,
/// the way Marionette-style tools let you grab a hand, a foot or the hips and
/// have the body follow. Pure functions over pose objects, no DOM, so they can
/// be unit-tested in Node (see tests/poseRig.test.mjs).
///
/// Drag behaviour (chosen automatically from the grabbed joint):
///   - root (pelvis)        -> translate the whole figure
///   - IK end (wrist/ankle) -> two-bone IK, elbow/knee keeps its bend direction
///   - any other joint      -> FK: rotate the bone from its parent, children follow
///   - freeMove             -> move only that joint (legacy behaviour)
/// After the drag, pinned ends are re-solved back to where they were, so
/// "whatever you place stays put".

import { JOINT_PARENT, IK_CHAINS, clonePose } from "./pose.js";

/// Minimum reach of a chain, as a fraction of its total length. Keeps the IK
/// away from the fully-folded singularity.
const MIN_REACH_RATIO = 0.02;

export const ROOT_JOINT = Object.keys(JOINT_PARENT).find((k) => JOINT_PARENT[k] === null);

const CHILDREN = Object.entries(JOINT_PARENT).reduce((acc, [key, parent]) => {
  if (parent) (acc[parent] ||= []).push(key);
  return acc;
}, {});

/// Joint plus everything below it in the hierarchy.
export function getSubtree(key) {
  const out = [key];
  for (let i = 0; i < out.length; i++) out.push(...(CHILDREN[out[i]] || []));
  return out;
}

export function isPinnable(key) {
  return key in IK_CHAINS;
}

// ---- 2D vector helpers ----------------------------------------------------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleOf = (v) => Math.atan2(v.y, v.x);
const cross = (u, v) => u.x * v.y - u.y * v.x;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const polar = (origin, length, angle) => ({
  x: origin.x + length * Math.cos(angle),
  y: origin.y + length * Math.sin(angle),
});

function rotateAround(p, pivot, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}

/// Below this |sin| between root->end and root->mid a limb counts as straight,
/// i.e. it has no bend direction of its own.
const STRAIGHT_SIN = 1e-3;

/// Which side of the root->end line the mid joint sits on: +1 or -1, or 0 when
/// the chain is (nearly) straight.
export function bendSign(root, mid, end) {
  const u = sub(end, root);
  const v = sub(mid, root);
  const c = cross(u, v);
  const scale = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (!scale || Math.abs(c) <= STRAIGHT_SIN * scale) return 0;
  return c < 0 ? -1 : 1;
}

/// Bend direction for the chain ending at `endKey`: its current bend, or for a
/// straight limb, away from the body (the side opposite the chain root's
/// parent, e.g. the pelvis for a leg). Keeps straight left/right limbs symmetric.
function chainBendSign(joints, endKey) {
  const [rootKey, midKey] = IK_CHAINS[endKey];
  const root = joints[rootKey];
  const end = joints[endKey];
  const sign = bendSign(root, joints[midKey], end);
  if (sign) return sign;
  return cross(sub(end, root), sub(joints[JOINT_PARENT[rootKey]], root)) < 0 ? 1 : -1;
}

// ---- Primitive operations (mutate `joints`) -------------------------------

export function rotateSubtree(joints, key, pivot, angle) {
  for (const k of getSubtree(key)) joints[k] = rotateAround(joints[k], pivot, angle);
}

export function translateSubtree(joints, key, dx, dy) {
  for (const k of getSubtree(key)) joints[k] = { x: joints[k].x + dx, y: joints[k].y + dy };
}

/// Analytic two-bone IK. Keeps both bone lengths, puts the end as close to
/// `target` as reach allows, and bends the mid joint toward `sign` (see bendSign).
/// Returns { mid, end }.
export function solveTwoBoneIK(root, mid, end, target, sign) {
  const l1 = dist(root, mid);
  const l2 = dist(mid, end);
  const maxReach = l1 + l2;
  const minReach = Math.max(Math.abs(l1 - l2), maxReach * MIN_REACH_RATIO);
  const toTarget = sub(target, root);
  const baseAngle = Math.hypot(toTarget.x, toTarget.y) > 0 ? angleOf(toTarget) : angleOf(sub(end, root));
  const d = clamp(dist(root, target), minReach, maxReach);
  // Law of cosines: angle at the root between root->end and root->mid.
  const cosA = l1 > 0 ? clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1) : 1;
  const midAngle = baseAngle + sign * Math.acos(cosA);
  return { mid: polar(root, l1, midAngle), end: polar(root, d, baseAngle) };
}

/// Run IK on the chain ending at `endKey`, moving the end's subtree with it.
function solveChain(joints, endKey, target, sign) {
  const [rootKey, midKey] = IK_CHAINS[endKey];
  const oldEnd = joints[endKey];
  const { mid, end } = solveTwoBoneIK(joints[rootKey], joints[midKey], oldEnd, target, sign);
  joints[midKey] = mid;
  translateSubtree(joints, endKey, end.x - oldEnd.x, end.y - oldEnd.y);
}

// ---- Drag entry point -----------------------------------------------------

/// Pose that results from dragging `key` (as it was in `startPose`) to `target`.
/// Always computed from the drag-start pose so long drags don't accumulate drift.
///
/// options.freeMove  move only the grabbed joint, ignoring pins
/// options.pins      iterable of pinned IK end keys
export function applyDrag(startPose, key, target, { freeMove = false, pins = [] } = {}) {
  const pose = clonePose(startPose);
  const j = pose.joints;
  const start = startPose.joints;

  if (freeMove) {
    j[key] = { x: target.x, y: target.y };
    return pose;
  }

  if (key === ROOT_JOINT) {
    translateSubtree(j, key, target.x - start[key].x, target.y - start[key].y);
  } else if (IK_CHAINS[key]) {
    solveChain(j, key, target, chainBendSign(start, key));
  } else {
    const pivot = j[JOINT_PARENT[key]];
    const angle = angleOf(sub(target, pivot)) - angleOf(sub(j[key], pivot));
    rotateSubtree(j, key, pivot, angle);
  }

  for (const pinKey of pins) {
    if (pinKey === key || !IK_CHAINS[pinKey]) continue;
    const [rootKey, midKey] = IK_CHAINS[pinKey];
    const pinTarget = start[pinKey];
    // Grabbing the elbow/knee of a pinned limb picks which way it bends;
    // otherwise keep the bend the limb had when the drag started.
    const sign = (midKey === key && bendSign(j[rootKey], target, pinTarget)) || chainBendSign(start, pinKey);
    solveChain(j, pinKey, pinTarget, sign);
  }

  return pose;
}
