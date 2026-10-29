// Run with: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDrag, solveTwoBoneIK, bendSign, getSubtree, ROOT_JOINT } from "../poseRig.js";
import { createDefaultPose, copySide, mirrorPose, JOINT_KEYS, IK_CHAINS } from "../pose.js";
import { buildPresetPose, POSE_PRESETS } from "../posePresets.js";

const EPS = 1e-6;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, eps = EPS) => assert.ok(dist(a, b) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

function boneLengths(pose) {
  const out = {};
  for (const [end, [root, mid]] of Object.entries(IK_CHAINS)) {
    out[`${root}-${mid}`] = dist(pose.joints[root], pose.joints[mid]);
    out[`${mid}-${end}`] = dist(pose.joints[mid], pose.joints[end]);
  }
  return out;
}

function assertSameLengths(a, b) {
  const la = boneLengths(a);
  const lb = boneLengths(b);
  for (const k of Object.keys(la)) assert.ok(Math.abs(la[k] - lb[k]) < 1e-6, `bone ${k} changed length`);
}

test("pelvis is the root and its subtree is the whole skeleton", () => {
  assert.equal(ROOT_JOINT, "pelvis");
  assert.deepEqual(new Set(getSubtree(ROOT_JOINT)), new Set(JOINT_KEYS));
});

test("two-bone IK reaches a reachable target and keeps lengths", () => {
  const root = { x: 0, y: 0 };
  const mid = { x: 10, y: 0 };
  const end = { x: 20, y: 0 };
  const target = { x: 12, y: 8 };
  for (const sign of [1, -1]) {
    const r = solveTwoBoneIK(root, mid, end, target, sign);
    near(r.end, target);
    assert.ok(Math.abs(dist(root, r.mid) - 10) < EPS);
    assert.ok(Math.abs(dist(r.mid, r.end) - 10) < EPS);
    assert.equal(bendSign(root, r.mid, r.end), sign);
  }
});

test("two-bone IK straightens toward an out-of-reach target", () => {
  const r = solveTwoBoneIK({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 100 }, 1);
  near(r.end, { x: 0, y: 20 });
});

test("dragging a wrist uses IK: hand reaches target, arm keeps lengths and bend, rest untouched", () => {
  const start = createDefaultPose();
  const target = { x: start.joints.wrist_r.x + 30, y: start.joints.wrist_r.y - 60 };
  const out = applyDrag(start, "wrist_r", target);
  near(out.joints.wrist_r, target);
  near(out.joints.shoulder_r, start.joints.shoulder_r);
  near(out.joints.wrist_l, start.joints.wrist_l);
  assertSameLengths(start, out);
  const s = ["shoulder_r", "elbow_r", "wrist_r"];
  assert.equal(bendSign(...s.map((k) => out.joints[k])), bendSign(...s.map((k) => start.joints[k])));
});

test("dragging the pelvis moves the whole figure", () => {
  const start = createDefaultPose();
  const out = applyDrag(start, "pelvis", { x: start.joints.pelvis.x + 25, y: start.joints.pelvis.y + 40 });
  for (const k of JOINT_KEYS) near(out.joints[k], { x: start.joints[k].x + 25, y: start.joints[k].y + 40 });
});

test("dragging the pelvis down with pinned feet bends the knees and keeps the feet", () => {
  const start = createDefaultPose();
  const pins = ["ankle_l", "ankle_r"];
  const out = applyDrag(start, "pelvis", { x: start.joints.pelvis.x, y: start.joints.pelvis.y + 50 }, { pins });
  for (const k of pins) near(out.joints[k], start.joints[k]);
  assertSameLengths(start, out);
  assert.ok(out.joints.hip_l.y > start.joints.hip_l.y);
});

test("FK: rotating the elbow swings the forearm, children follow, lengths kept", () => {
  const start = createDefaultPose();
  const { shoulder_l } = start.joints;
  const out = applyDrag(start, "elbow_l", { x: shoulder_l.x - 100, y: shoulder_l.y });
  near(out.joints.shoulder_l, shoulder_l);
  assert.ok(Math.abs(out.joints.elbow_l.y - shoulder_l.y) < EPS);
  assertSameLengths(start, out);
});

test("pinned hand stays put while the torso leans toward it (default arm is near full reach)", () => {
  const start = createDefaultPose();
  const { pelvis, neck } = start.joints;
  const out = applyDrag(start, "neck", { x: neck.x - 40, y: neck.y + 10 }, { pins: ["wrist_l"] });
  near(out.joints.wrist_l, start.joints.wrist_l);
  assert.notDeepEqual(out.joints.neck, neck);
  near(out.joints.pelvis, pelvis);
});

test("free move only moves the grabbed joint", () => {
  const start = createDefaultPose();
  const out = applyDrag(start, "pelvis", { x: 1, y: 2 }, { freeMove: true, pins: ["ankle_l"] });
  near(out.joints.pelvis, { x: 1, y: 2 });
  near(out.joints.neck, start.joints.neck);
});

test("copySide makes the right limbs mirror the left across the spine", () => {
  const start = applyDrag(createDefaultPose(), "wrist_l", { x: 250, y: 150 });
  const out = copySide(start, "l");
  const axisX = out.joints.pelvis.x;
  near(out.joints.wrist_r, { x: 2 * axisX - out.joints.wrist_l.x, y: out.joints.wrist_l.y });
});

test("mirror twice is identity", () => {
  const start = applyDrag(createDefaultPose(), "wrist_l", { x: 250, y: 150 });
  const out = mirrorPose(mirrorPose(start));
  for (const k of JOINT_KEYS) near(out.joints[k], start.joints[k]);
});

test("every preset builds a full pose with the source's bone lengths, feet on the ground", () => {
  const source = createDefaultPose();
  const groundY = Math.max(source.joints.ankle_l.y, source.joints.ankle_r.y);
  for (const id of Object.keys(POSE_PRESETS)) {
    const out = buildPresetPose(id, source);
    for (const k of JOINT_KEYS) assert.ok(Number.isFinite(out.joints[k].x), `${id}.${k}`);
    assertSameLengths(source, out);
    assert.ok(Math.abs(Math.max(out.joints.ankle_l.y, out.joints.ankle_r.y) - groundY) < EPS, id);
  }
});

test("stand preset reproduces the default pose", () => {
  const source = createDefaultPose();
  const out = buildPresetPose("stand", source);
  for (const k of JOINT_KEYS) near(out.joints[k], source.joints[k], 1e-6);
});

test("straight legs bend outward symmetrically when the hips drop onto pinned feet", () => {
  const start = createDefaultPose();
  const out = applyDrag(start, "pelvis", { x: start.joints.pelvis.x, y: start.joints.pelvis.y + 50 }, {
    pins: ["ankle_l", "ankle_r"],
  });
  const { knee_l, knee_r, pelvis } = out.joints;
  assert.ok(knee_l.x < start.joints.knee_l.x, "left knee goes out to the left");
  assert.ok(knee_r.x > start.joints.knee_r.x, "right knee goes out to the right");
  assert.ok(Math.abs(pelvis.x - knee_l.x - (knee_r.x - pelvis.x)) < 1e-6, "symmetric");
});
