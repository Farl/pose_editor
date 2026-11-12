// Run with: node --test tests/*.test.mjs
// Waist bend: measured from the spine, spelled out in the prompt only when bent.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDefaultPose, mirrorPose, torsoBend } from "../pose.js";
import { getSubtree } from "../poseRig.js";
import { buildPresetPose, POSE_PRESETS } from "../posePresets.js";
import { generatePoseImage } from "../aiService.js";
import { TORSO } from "../editorConfig.js";

/// Prompt that generatePoseImage would send, captured through the websim provider path.
async function promptFor(pose, options = {}) {
  let prompt = null;
  globalThis.websim = { imageGen: async (req) => ((prompt = req.prompt), { url: "stub" }) };
  try {
    await generatePoseImage("img", pose, "guide", options);
  } finally {
    delete globalThis.websim;
  }
  return prompt;
}

/// Turn `keys` by `degrees` (positive = clockwise on screen) around `pivot`.
function rotate(joints, keys, pivot, degrees) {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  for (const k of keys) {
    const dx = joints[k].x - pivot.x;
    const dy = joints[k].y - pivot.y;
    joints[k] = { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
  }
}

/// Default figure with the upper body (neck and everything on it) bent at the waist.
function bentPose(degrees) {
  const pose = createDefaultPose();
  const { waist } = pose.joints;
  rotate(pose.joints, getSubtree("neck"), { ...waist }, degrees);
  return pose;
}

/// Default figure with the whole spine turned at the pelvis (dragging the waist).
function leanPose(degrees) {
  const pose = createDefaultPose();
  const { pelvis } = pose.joints;
  rotate(pose.joints, getSubtree("waist"), { ...pelvis }, degrees);
  return pose;
}

/// Turn the face to profile: nose moved by dx to one side of the ears, as far as a profile puts it.
function profile(pose, dx) {
  pose.joints.nose = { x: pose.joints.nose.x + dx, y: pose.joints.nose.y };
  return pose;
}

test("standing figure and presets: no bend, no torso text", async () => {
  assert.equal(torsoBend(createDefaultPose().joints), null);
  const stand = createDefaultPose();
  for (const id of Object.keys(POSE_PRESETS)) {
    const pose = buildPresetPose(id, stand);
    assert.equal(torsoBend(pose.joints), null, id);
    assert.ok(!(await promptFor(pose)).includes("TORSO"), id);
  }
});

test("a bend below the threshold is not mentioned", () => {
  assert.equal(torsoBend(bentPose(TORSO.bendMin - 1).joints), null);
});

test("frontal face: the bend is sideways, toward the image side it goes", () => {
  const left = torsoBend(bentPose(-60).joints);
  assert.equal(left.kind, "side");
  assert.equal(left.toward, "image-left");
  assert.ok(Math.abs(left.degrees - 60) < 1e-6);
  assert.equal(torsoBend(bentPose(60).joints).toward, "image-right");
});

test("turning the spine at the pelvis counts like bending at the waist", () => {
  const bend = torsoBend(leanPose(-50).joints);
  assert.equal(bend.toward, "image-left");
  assert.ok(Math.abs(bend.degrees - 50) < 1e-6);
  // Both together add up.
  const pose = leanPose(-30);
  rotate(pose.joints, getSubtree("neck"), { ...pose.joints.waist }, -30);
  assert.ok(Math.abs(torsoBend(pose.joints).degrees - 60) < 1e-6);
});

test("hips in profile: the lower spine is the reference", () => {
  const pose = bentPose(-40);
  pose.joints.hip_r = { ...pose.joints.hip_l };
  assert.ok(Math.abs(torsoBend(pose.joints).degrees - 40) < 1e-6);
});

test("profile face: bending toward it is forward, away from it backward", () => {
  // Face looking toward image-left.
  assert.equal(torsoBend(profile(bentPose(-60), -30).joints).kind, "forward");
  assert.equal(torsoBend(profile(bentPose(30), -30).joints).kind, "backward");
});

test("mirroring flips the bend side, not its kind", () => {
  const pose = profile(bentPose(-60), -30);
  const mirrored = torsoBend(mirrorPose(pose).joints);
  assert.equal(mirrored.kind, "forward");
  assert.equal(mirrored.toward, "image-right");
});

test("prompt: a TORSO section with the rounded angle, before the hands", async () => {
  const prompt = await promptFor(profile(bentPose(-62), -30), { includeHands: true });
  assert.match(prompt, /TORSO \(follow exactly\):\n- The upper body bends forward at the waist, toward image-left, by about 60 degrees/);
  assert.ok(prompt.indexOf("TORSO") < prompt.indexOf("HAND SHAPES"));
});
