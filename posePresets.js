/// Preset poses, defined as bone directions rather than coordinates so they
/// work with whatever proportions the current figure has.
///
/// Each preset lists overrides of the *standing* pose: joint -> direction (in
/// degrees) of the bone from its parent to that joint, in canvas space
/// (0 = right, 90 = down, -90 = up). Joints not listed keep their standing
/// angle *relative to their parent bone*, so hands, feet and the head follow
/// the limb they hang from. The figure is rebuilt from the root with the
/// source pose's bone lengths, then dropped so its lowest foot point sits on
/// the standing ground line.
///
/// Sides are the figure's: "_r" is its right, on the image's left.

import { JOINT_PARENT, createDefaultPose } from "./pose.js";
import { ROOT_JOINT, getSubtree } from "./poseRig.js";

export const POSE_PRESETS = {
  stand: { label: "Stand", angles: {} },
  tpose: {
    label: "T-pose",
    angles: { elbow_r: 180, wrist_r: 180, elbow_l: 0, wrist_l: 0 },
  },
  armsUp: {
    label: "Arms up",
    angles: { elbow_r: -120, wrist_r: -105, elbow_l: -60, wrist_l: -75 },
  },
  walk: {
    label: "Walk",
    angles: {
      elbow_r: 100, wrist_r: 85, elbow_l: 80, wrist_l: 60,
      knee_r: 95, ankle_r: 100, knee_l: 85, ankle_l: 75,
    },
  },
  run: {
    label: "Run",
    angles: {
      waist: -82, neck: -75, nose: -80,
      elbow_r: 125, wrist_r: 60, elbow_l: 60, wrist_l: -20,
      knee_r: 115, ankle_r: 160, knee_l: 30, ankle_l: 100,
    },
  },
  sit: {
    label: "Sit",
    angles: {
      elbow_r: 105, wrist_r: 75, elbow_l: 75, wrist_l: 105,
      knee_r: 150, ankle_r: 90, knee_l: 30, ankle_l: 90,
    },
  },
  squat: {
    label: "Squat",
    angles: {
      elbow_r: 100, wrist_r: 20, elbow_l: 80, wrist_l: 160,
      knee_r: 175, ankle_r: 105, knee_l: 5, ankle_l: 75,
    },
  },
};

const RAD = Math.PI / 180;

/// Points that can touch the ground; the lowest one lands on the ground line.
const FOOT_POINTS = ["ankle", "heel", "big_toe", "small_toe"].flatMap((k) => [`${k}_r`, `${k}_l`]);
const lowestY = (joints) => Math.max(...FOOT_POINTS.map((k) => joints[k].y));

/// Joints ordered parent-before-child, so each can be placed from its parent.
const BUILD_ORDER = getSubtree(ROOT_JOINT);

const STAND = createDefaultPose();
const STAND_GROUND_Y = lowestY(STAND.joints);
const STAND_ANGLES = Object.fromEntries(
  BUILD_ORDER.filter((k) => JOINT_PARENT[k]).map((k) => {
    const p = STAND.joints[JOINT_PARENT[k]];
    const c = STAND.joints[k];
    return [k, Math.atan2(c.y - p.y, c.x - p.x) / RAD];
  })
);

/// New pose for preset `id`, using `source`'s bone lengths and horizontal position.
export function buildPresetPose(id, source) {
  const overrides = POSE_PRESETS[id].angles;
  const src = source.joints;
  const joints = { [ROOT_JOINT]: { x: src[ROOT_JOINT].x, y: src[ROOT_JOINT].y } };
  /// Bone direction (degrees) chosen for each placed joint.
  const angles = {};

  for (const key of BUILD_ORDER) {
    const parentKey = JOINT_PARENT[key];
    if (!parentKey) continue;
    const parentBone = angles[parentKey];
    angles[key] =
      key in overrides
        ? overrides[key]
        : parentBone === undefined
          ? STAND_ANGLES[key]
          : parentBone + STAND_ANGLES[key] - STAND_ANGLES[parentKey];
    const length = Math.hypot(src[key].x - src[parentKey].x, src[key].y - src[parentKey].y);
    const a = angles[key] * RAD;
    const p = joints[parentKey];
    joints[key] = { x: p.x + length * Math.cos(a), y: p.y + length * Math.sin(a) };
  }

  const dy = STAND_GROUND_Y - lowestY(joints);
  for (const j of Object.values(joints)) j.y += dy;
  return { joints };
}
