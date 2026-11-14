import { FIGURE } from "./config.js";
/// Exact Mixamo suffixes (FBXLoader may remove ':'), not substring matching:
/// RightShoulder is the collar bone; RightArm is the shoulder joint.
const CENTRE = { Hips: "pelvis", Spine: "waist", Neck: "neck", Head: "nose", RightEye: "eye_r", LeftEye: "eye_l" };
const LIMB = {
  Arm: "shoulder",
  ForeArm: "elbow",
  Hand: "wrist",
  UpLeg: "hip",
  Leg: "knee",
  Foot: "ankle",
  ToeBase: "big_toe",
};
export function jointForBone(name) {
  const suffix = name.replace(/^mixamorig:?/i, "");
  if (CENTRE[suffix]) return CENTRE[suffix];
  const match = /^(Right|Left)(.+)$/.exec(suffix);
  if (!match) return null;
  const side = match[1] === "Right" ? "r" : "l",
    part = match[2];
  if (LIMB[part]) return `${LIMB[part]}_${side}`;
  const finger = /^Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/.exec(part);
  return finger ? `${finger[1].toLowerCase()}${finger[2]}_${side}` : null;
}

/// Pure Mixamo-to-66 mapping. Bone positions are in model world units. Eyes and
/// fingers use actual bones; ears and heel/outer-toe landmarks are derived.
export function rigFromBonePositions(bones) {
  const rig = {};
  for (const [name, p] of Object.entries(bones)) {
    const key = jointForBone(name);
    if (key) rig[key] = [...p];
  }
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const eyes = mid(rig.eye_r, rig.eye_l);
  rig.nose = [...eyes];
  for (const side of ["r", "l"]) {
    const other = side === "r" ? "l" : "r",
      eye = rig[`eye_${side}`],
      twin = rig[`eye_${other}`];
    rig[`ear_${side}`] = eye.map((v, i) => v + (v - twin[i]) * FIGURE.rigDerivation.earEyeSpan);
    const ankle = rig[`ankle_${side}`],
      toe = rig[`big_toe_${side}`];
    rig[`heel_${side}`] = ankle.map((v, i) => v + (v - toe[i]) * FIGURE.rigDerivation.heelLength);
    const hip = rig[`hip_${side}`],
      otherHip = rig[`hip_${other}`];
    const axis = hip.map((v, i) => v - otherHip[i]),
      length = Math.hypot(...axis) || 1;
    const width = Math.hypot(...toe.map((v, i) => v - ankle[i])) * FIGURE.rigDerivation.outerToeWidth;
    rig[`small_toe_${side}`] = toe.map((v, i) => v + (axis[i] / length) * width);
  }
  const origin = rig.pelvis;
  return Object.fromEntries(Object.entries(rig).map(([key, p]) => [key, p.map((v, i) => v - origin[i])]));
}

/// Mixamo bones with no rig joint that ride on a rig bone, by suffix:
/// [from, to] joints of that bone. Each keeps its bind-pose place on the bone
/// (carryPoint), so the chest skin stays below the neck and turns with the spine.
export const CARRIED_BONES = { Spine1: ["waist", "neck"], Spine2: ["waist", "neck"] };

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(...a);

/// `point` on the bind bone `bindFrom`-`bindTo`, carried onto the current bone
/// `from`-`to`: turned by the shortest swing between the two bone directions
/// (Rodrigues) and scaled by their length ratio. All [x, y, z] arrays.
export function carryPoint(point, bindFrom, bindTo, from, to) {
  const a = sub(bindTo, bindFrom),
    b = sub(to, from);
  const scale = norm(b) / norm(a) || 1;
  const u = a.map((v) => v / norm(a)),
    w = b.map((v) => v / (norm(b) || 1));
  const axis = cross(u, w),
    sin = norm(axis),
    cos = dot(u, w);
  let p = sub(point, bindFrom);
  if (sin > 1e-12) {
    const k = axis.map((v) => v / sin);
    const kxp = cross(k, p),
      kp = dot(k, p);
    p = p.map((v, i) => v * cos + kxp[i] * sin + k[i] * kp * (1 - cos));
  }
  return p.map((v, i) => from[i] + v * scale);
}
