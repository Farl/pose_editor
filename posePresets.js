/// Preset poses, defined as bone directions rather than coordinates so they
/// work with whatever proportions the current figure has.
///
/// Each preset lists overrides of the *standing* pose: joint -> direction (in
/// degrees) of the bone from its parent to that joint, in canvas space
/// (0 = right, 90 = down, -90 = up). Joints not listed keep their standing
/// direction. The figure is rebuilt from the root with the source pose's bone
/// lengths, then dropped so its lowest ankle sits on the standing ground line.

import { JOINT_PARENT, createDefaultPose } from "./pose.js";
import { ROOT_JOINT, getSubtree } from "./poseRig.js";

export const POSE_PRESETS = {
  stand: { label: "Stand", angles: {} },
  tpose: {
    label: "T-pose",
    angles: { elbow_l: 180, wrist_l: 180, elbow_r: 0, wrist_r: 0 },
  },
  armsUp: {
    label: "Arms up",
    angles: { elbow_l: -120, wrist_l: -105, elbow_r: -60, wrist_r: -75 },
  },
  walk: {
    label: "Walk",
    angles: {
      elbow_l: 100, wrist_l: 85, elbow_r: 80, wrist_r: 60,
      knee_l: 95, ankle_l: 100, knee_r: 85, ankle_r: 75,
    },
  },
  run: {
    label: "Run",
    angles: {
      neck: -75, head: -80,
      elbow_l: 125, wrist_l: 60, elbow_r: 60, wrist_r: -20,
      knee_l: 115, ankle_l: 160, knee_r: 30, ankle_r: 100,
    },
  },
  sit: {
    label: "Sit",
    angles: {
      elbow_l: 105, wrist_l: 75, elbow_r: 75, wrist_r: 105,
      knee_l: 150, ankle_l: 90, knee_r: 30, ankle_r: 90,
    },
  },
  squat: {
    label: "Squat",
    angles: {
      elbow_l: 100, wrist_l: 20, elbow_r: 80, wrist_r: 160,
      knee_l: 175, ankle_l: 105, knee_r: 5, ankle_r: 75,
    },
  },
};

const RAD = Math.PI / 180;
const ANKLES = ["ankle_l", "ankle_r"];

/// Joints ordered parent-before-child, so each can be placed from its parent.
const BUILD_ORDER = getSubtree(ROOT_JOINT);

const STAND = createDefaultPose();
const STAND_GROUND_Y = Math.max(...ANKLES.map((k) => STAND.joints[k].y));
const STAND_ANGLES = Object.fromEntries(
  BUILD_ORDER.filter((k) => JOINT_PARENT[k]).map((k) => {
    const p = STAND.joints[JOINT_PARENT[k]];
    const c = STAND.joints[k];
    return [k, Math.atan2(c.y - p.y, c.x - p.x) / RAD];
  })
);

/// New pose for preset `id`, using `source`'s bone lengths and horizontal position.
export function buildPresetPose(id, source) {
  const angles = { ...STAND_ANGLES, ...POSE_PRESETS[id].angles };
  const src = source.joints;
  const joints = { [ROOT_JOINT]: { x: src[ROOT_JOINT].x, y: src[ROOT_JOINT].y } };

  for (const key of BUILD_ORDER) {
    const parentKey = JOINT_PARENT[key];
    if (!parentKey) continue;
    const length = Math.hypot(src[key].x - src[parentKey].x, src[key].y - src[parentKey].y);
    const a = angles[key] * RAD;
    const p = joints[parentKey];
    joints[key] = { x: p.x + length * Math.cos(a), y: p.y + length * Math.sin(a) };
  }

  const dy = STAND_GROUND_Y - Math.max(...ANKLES.map((k) => joints[k].y));
  for (const j of Object.values(joints)) j.y += dy;
  return { joints };
}
