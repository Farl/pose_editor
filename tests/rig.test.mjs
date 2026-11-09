// Run with: node --test tests/*.test.mjs
// Head, waist, feet, hands, hand gestures, rendering styles and pose migration.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDrag, isGrabbable, grabbableJoints } from "../poseRig.js";
import {
  createDefaultPose,
  normalizePose,
  mirrorPose,
  JOINT_KEYS,
  JOINT_PARENT,
  SIDE_PAIRS,
  sideOf,
} from "../pose.js";
import { fingerKeys, applyHandGesture, fingerStates, HAND_GESTURES } from "../handPoses.js";
import { POSE_STYLES, buildRenderList, styleDrawsHands } from "../poseStyles.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, eps = 1e-6) => assert.ok(dist(a, b) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test("rig has head points, waist, feet and 21-point hands on both sides", () => {
  for (const k of ["nose", "waist", "eye_r", "ear_l", "heel_r", "big_toe_l", "small_toe_r"]) {
    assert.ok(JOINT_KEYS.includes(k), k);
  }
  for (const side of ["r", "l"]) assert.equal(fingerKeys(side).length, 20);
  assert.equal(JOINT_PARENT.neck, "waist");
  assert.equal(JOINT_PARENT.waist, "pelvis");
  assert.equal(JOINT_PARENT.thumb1_r, "wrist_r");
  assert.equal(JOINT_PARENT.index4_l, "index3_l");
});

test("every left joint has a right counterpart", () => {
  assert.equal(SIDE_PAIRS.length * 2, JOINT_KEYS.filter((k) => sideOf(k) !== "c").length);
});

test("default figure faces the viewer: its right side is on the image's left", () => {
  const { joints } = createDefaultPose();
  for (const k of ["shoulder_r", "wrist_r", "eye_r", "ankle_r", "thumb4_r"]) {
    assert.ok(joints[k].x < joints.pelvis.x, k);
  }
});

test("bending the waist leans the upper body; the legs stay", () => {
  const start = createDefaultPose();
  const { waist, neck } = start.joints;
  const out = applyDrag(start, "neck", { x: neck.x + 60, y: neck.y + 20 }, { mode: "fk" });
  near(out.joints.waist, waist);
  near(out.joints.ankle_l, start.joints.ankle_l);
  assert.ok(out.joints.nose.x > start.joints.nose.x, "head goes with the neck");
  assert.ok(Math.abs(dist(out.joints.neck, waist) - dist(neck, waist)) < 1e-6);
});

test("grabbing a toe turns the whole foot around the ankle", () => {
  const start = createDefaultPose();
  const { ankle_r, big_toe_r } = start.joints;
  const out = applyDrag(start, "big_toe_r", { x: big_toe_r.x - 20, y: big_toe_r.y - 10 });
  near(out.joints.ankle_r, ankle_r);
  for (const k of ["heel_r", "small_toe_r"]) {
    assert.ok(dist(out.joints[k], start.joints[k]) > 1, `${k} moved with the foot`);
    assert.ok(Math.abs(dist(out.joints[k], ankle_r) - dist(start.joints[k], ankle_r)) < 1e-6);
  }
});

test("grabbing the palm turns the whole hand around the wrist", () => {
  const start = createDefaultPose();
  const { wrist_l, middle1_l } = start.joints;
  const out = applyDrag(start, "middle1_l", { x: middle1_l.x + 30, y: middle1_l.y });
  near(out.joints.wrist_l, wrist_l);
  for (const k of fingerKeys("l")) {
    assert.ok(Math.abs(dist(out.joints[k], wrist_l) - dist(start.joints[k], wrist_l)) < 1e-6, k);
  }
  assert.ok(dist(out.joints.pinky4_l, start.joints.pinky4_l) > 1);
});

test("simple hands: fingertip handle bends all four fingers together, thumb stays", () => {
  const start = createDefaultPose();
  const tip = start.joints.middle4_r;
  const out = applyDrag(start, "middle4_r", { x: tip.x + 15, y: tip.y }, { handDetail: "simple" });
  for (const f of ["index", "middle", "ring", "pinky"]) {
    near(out.joints[`${f}1_r`], start.joints[`${f}1_r`]);
    assert.ok(dist(out.joints[`${f}4_r`], start.joints[`${f}4_r`]) > 1, `${f} bent`);
  }
  near(out.joints.thumb4_r, start.joints.thumb4_r);
});

test("simple hands offer only wrist, palm, thumb tip and fingertips", () => {
  const grabbable = new Set(grabbableJoints("simple"));
  for (const k of ["wrist_r", "middle1_r", "thumb4_r", "middle4_r"]) assert.ok(grabbable.has(k), k);
  for (const k of ["index2_r", "thumb2_l", "pinky4_l"]) assert.ok(!isGrabbable(k, "simple"), k);
  assert.equal(grabbableJoints("full").length, JOINT_KEYS.length);
});

test("hand gestures keep palm size and direction", () => {
  const pose = createDefaultPose();
  const { wrist_r, middle1_r } = pose.joints;
  for (const id of Object.keys(HAND_GESTURES)) {
    applyHandGesture(pose.joints, "r", id);
    near(pose.joints.middle1_r, middle1_r, 1e-6);
    near(pose.joints.wrist_r, wrist_r);
  }
});

test("mirroring keeps each hand's thumb on the outside", () => {
  const out = mirrorPose(createDefaultPose());
  const { thumb4_r, pinky4_r, thumb4_l, pinky4_l } = out.joints;
  assert.ok(thumb4_r.x < pinky4_r.x, "right thumb outward (image left)");
  assert.ok(thumb4_l.x > pinky4_l.x, "left thumb outward (image right)");
});

test("old saved poses gain the new joints; head becomes nose", () => {
  const old = createDefaultPose();
  const legacy = { joints: {} };
  for (const k of ["neck", "shoulder_r", "elbow_r", "wrist_r", "pelvis", "hip_l", "knee_l", "ankle_l"]) {
    legacy.joints[k] = old.joints[k];
  }
  legacy.joints.head = { x: 400, y: 170 };
  const out = normalizePose(legacy);
  for (const k of JOINT_KEYS) assert.ok(Number.isFinite(out.joints[k]?.x), k);
  near(out.joints.nose, { x: 400, y: 170 });
  assert.equal(out.joints.head, undefined);
  // Old poses used "_l" for the image's left: sides are swapped on load.
  near(out.joints.shoulder_l, legacy.joints.shoulder_r);
  near(out.joints.ankle_r, legacy.joints.ankle_l);
});

test("OpenPose styles draw the reference keypoint and limb counts", () => {
  const count = (id) => {
    const { segments, points } = buildRenderList(id, 4, 1);
    return [new Set(points.map((p) => p.key)).size, segments.length];
  };
  assert.deepEqual(count("coco18"), [18, 17]);
  assert.deepEqual(count("body25"), [25, 24]);
  assert.deepEqual(count("full"), [18 + 40, 17 + 40]);
});

test("every style only references rig joints", () => {
  const rig = new Set(JOINT_KEYS);
  for (const id of Object.keys(POSE_STYLES)) {
    const { segments, points } = buildRenderList(id, 4, 1);
    for (const s of segments) assert.ok(rig.has(s.a) && rig.has(s.b), `${id}: ${s.a}-${s.b}`);
    for (const p of points) assert.ok(rig.has(p.key), `${id}: ${p.key}`);
  }
});

test("COCO-18 uses the reference colours: neck red, right shoulder limb orange-ish", () => {
  const { points, segments } = buildRenderList("coco18", 4, 1);
  assert.equal(points.find((p) => p.key === "nose").color, "rgb(255, 0, 0)");
  assert.equal(points.find((p) => p.key === "neck").color, "rgb(255, 85, 0)");
  // Limb 0 (neck - right shoulder) is colour 0 at 60 %.
  assert.equal(segments[0].color, "rgb(153, 0, 0)");
});

test("finger states read each gesture's extended and curled fingers", () => {
  const pose = createDefaultPose();
  const extendedFingers = (id) => {
    applyHandGesture(pose.joints, "l", id);
    const states = fingerStates(pose.joints, "l");
    return Object.keys(states).filter((f) => states[f]);
  };
  assert.deepEqual(extendedFingers("open"), ["thumb", "index", "middle", "ring", "pinky"]);
  assert.deepEqual(extendedFingers("fist"), []);
  assert.deepEqual(extendedFingers("point"), ["index"]);
  assert.deepEqual(extendedFingers("peace"), ["index", "middle"]);
});

test("finger keypoints are drawn by the full and left/right styles", () => {
  assert.deepEqual(
    Object.keys(POSE_STYLES).filter(styleDrawsHands),
    ["full", "sides"]
  );
});
