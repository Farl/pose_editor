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

export function createDefaultPose() {
  const centerX = 400;
  const centerY = 400;
  const pose = {
    joints: {},
  };

  pose.joints.head = { x: centerX, y: centerY - 220 };
  pose.joints.neck = { x: centerX, y: centerY - 180 };
  pose.joints.shoulder_l = { x: centerX - 70, y: centerY - 180 };
  pose.joints.shoulder_r = { x: centerX + 70, y: centerY - 180 };
  pose.joints.elbow_l = { x: centerX - 110, y: centerY - 110 };
  pose.joints.elbow_r = { x: centerX + 110, y: centerY - 110 };
  pose.joints.wrist_l = { x: centerX - 130, y: centerY - 40 };
  pose.joints.wrist_r = { x: centerX + 130, y: centerY - 40 };
  pose.joints.pelvis = { x: centerX, y: centerY };
  pose.joints.hip_l = { x: centerX - 45, y: centerY + 20 };
  pose.joints.hip_r = { x: centerX + 45, y: centerY + 20 };
  pose.joints.knee_l = { x: centerX - 40, y: centerY + 120 };
  pose.joints.knee_r = { x: centerX + 40, y: centerY + 120 };
  pose.joints.ankle_l = { x: centerX - 35, y: centerY + 220 };
  pose.joints.ankle_r = { x: centerX + 35, y: centerY + 220 };

  return pose;
}

export function clonePose(pose) {
  return JSON.parse(JSON.stringify(pose));
}

export function mirrorPose(pose, centerX = 400) {
  const mirrored = clonePose(pose);
  const pairs = [
    ["shoulder_r", "shoulder_l"],
    ["elbow_r", "elbow_l"],
    ["wrist_r", "wrist_l"],
    ["hip_r", "hip_l"],
    ["knee_r", "knee_l"],
    ["ankle_r", "ankle_l"],
  ];

  Object.keys(mirrored.joints).forEach((k) => {
    const j = mirrored.joints[k];
    mirrored.joints[k] = { x: centerX + (centerX - j.x), y: j.y };
  });

  pairs.forEach(([r, l]) => {
    const tmp = mirrored.joints[r];
    mirrored.joints[r] = mirrored.joints[l];
    mirrored.joints[l] = tmp;
  });

  return mirrored;
}