// Run with: node --test tests/*.test.mjs
// Depth and camera view: defaults change nothing; set values reach the guide and the prompt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDefaultPose, mirrorPose } from "../pose.js";
import {
  createDefaultView,
  normalizeView,
  isDefaultView,
  mirrorView,
  depthScale,
  jointDepth,
  headCircle,
} from "../poseView.js";
import { generatePoseImage } from "../aiService.js";
import { VIEW } from "../editorConfig.js";

/// Prompt that generatePoseImage would send, captured through the websim provider path.
async function promptFor(pose, options) {
  let prompt = null;
  globalThis.websim = { imageGen: async (req) => ((prompt = req.prompt), { url: "stub" }) };
  try {
    await generatePoseImage("img", pose, "guide", options);
  } finally {
    delete globalThis.websim;
  }
  return prompt;
}

test("default view: nothing scaled, no head outline, prompt unchanged", async () => {
  const pose = createDefaultPose();
  const view = createDefaultView();
  assert.ok(isDefaultView(view));
  for (const k of Object.keys(pose.joints)) assert.equal(depthScale(view, k), 1, k);
  assert.equal(headCircle(pose.joints, view), null);
  const base = await promptFor(pose, { includeHands: true });
  assert.equal(await promptFor(pose, { includeHands: true, view }), base);
  assert.ok(!base.includes("CAMERA, DEPTH"));
});

test("depth follows the limb: none at the shoulder, half at the elbow, all of it in the hand", () => {
  const view = createDefaultView();
  view.depth.wrist_r = 1;
  assert.equal(jointDepth(view, "shoulder_r"), 0);
  assert.equal(jointDepth(view, "elbow_r"), 0.5);
  assert.equal(jointDepth(view, "wrist_r"), 1);
  assert.equal(jointDepth(view, "index4_r"), 1);
  assert.equal(jointDepth(view, "wrist_l"), 0);
  assert.equal(depthScale(view, "wrist_r"), 2 ** VIEW.depthWidthGain);
});

test("saved views are clamped and completed; mirroring swaps hand and foot depths", () => {
  const view = normalizeView({ camera: "nope", depth: { wrist_r: 5, ankle_l: -0.4 }, headScale: 0 });
  assert.equal(view.camera, VIEW.defaultCamera);
  assert.equal(view.depth.wrist_r, VIEW.depth.max);
  assert.equal(view.depth.wrist_l, 0);
  assert.equal(view.headScale, VIEW.head.min);
  const mirrored = mirrorView(view);
  assert.equal(mirrored.depth.wrist_l, VIEW.depth.max);
  assert.equal(mirrored.depth.ankle_r, -0.4);
  assert.equal(mirrored.depth.wrist_r, 0);
});

test("big head: outline above the neck, larger with the head size", () => {
  const { joints } = createDefaultPose();
  const view = { ...createDefaultView(), headScale: 2 };
  const head = headCircle(joints, view);
  assert.ok(head.y < joints.neck.y, "above the neck");
  assert.ok(head.y - head.radius < joints.eye_r.y, "covers the face and above");
  const bigger = headCircle(joints, { ...view, headScale: 2.5 });
  assert.ok(bigger.radius > head.radius);
});

test("prompt names the camera, near and far limbs by image side, and the head size", async () => {
  const pose = createDefaultPose();
  const view = { ...createDefaultView(), camera: "low", headScale: 1.8 };
  view.depth.wrist_r = 1; // figure's right = image-left
  view.depth.ankle_l = -0.5; // image-right
  view.depth.ankle_r = 0.1; // below VIEW.depthNear: not mentioned
  const prompt = await promptFor(pose, { view });
  assert.match(prompt, /CAMERA, DEPTH AND PROPORTIONS/);
  assert.match(prompt, /Camera: low angle/);
  assert.match(prompt, /The image-left hand is thrust straight at the camera/);
  assert.match(prompt, /The image-right foot is further from the camera/);
  assert.ok(!/image-left foot/.test(prompt));
  assert.match(prompt, /about 1\.8 times a realistic adult head/);
  // After mirroring both, the near hand is on the other image side.
  const mirrored = await promptFor(mirrorPose(pose), { view: mirrorView(view) });
  assert.match(mirrored, /The image-right hand is thrust straight at the camera/);
});
