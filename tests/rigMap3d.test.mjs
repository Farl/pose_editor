import test from "node:test";
import assert from "node:assert/strict";
import { jointForBone } from "../mode3d/rigMap.js";
test("actual Samba Mixamo bone names preserve side and avoid collar/arm ambiguity", () => {
  assert.equal(jointForBone("mixamorig:RightArm"), "shoulder_r");
  assert.equal(jointForBone("mixamorigRightHandIndex4"), "index4_r");
  assert.equal(jointForBone("mixamorig:LeftFoot"), "ankle_l");
  assert.equal(jointForBone("mixamorig:RightShoulder"), null);
  assert.equal(jointForBone("unrelatedRightArm"), null);
});

import fs from "node:fs";
import { rigFromBonePositions } from "../mode3d/rigMap.js";
import { JOINT_KEYS, createDefaultPose } from "../pose.js";
test("actual r164 bone-name fixture maps or derives exactly the existing 66 joints", () => {
  const names = JSON.parse(fs.readFileSync(new URL("./fixtures/samba-r164-bones.json", import.meta.url)));
  const source = createDefaultPose().joints;
  const bones = Object.fromEntries(
    names.map((name) => {
      const p = source[jointForBone(name)] || { x: 0, y: 0 };
      return [name, [p.x, p.y, 0]];
    }),
  );
  const rig = rigFromBonePositions(bones);
  assert.deepEqual(Object.keys(rig).sort(), [...JOINT_KEYS].sort());
  assert.deepEqual(rig.pelvis, [0, 0, 0]);
  assert.ok(Object.values(rig).every((p) => p.every(Number.isFinite)));
});
