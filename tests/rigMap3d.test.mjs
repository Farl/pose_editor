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

import { CARRIED_BONES, carryPoint } from "../mode3d/rigMap.js";
// Samba r164 rest pose, pelvis origin (model units): spine bones between the
// waist and neck joints, which the rig has no joints for.
const SAMBA_REST = {
  waist: [0, 0.099, -0.012],
  Spine1: [0, 0.216, -0.026],
  Spine2: [0, 0.349, -0.043],
  neck: [0, 0.5, -0.035],
};
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
/// `p` turned by `angle` around the X axis through `pivot`.
const tiltX = (p, pivot, angle) => {
  const [y, z] = [p[1] - pivot[1], p[2] - pivot[2]];
  return [p[0], pivot[1] + y * Math.cos(angle) - z * Math.sin(angle), pivot[2] + y * Math.sin(angle) + z * Math.cos(angle)];
};
const carry = (name, rig) => {
  const [from, to] = CARRIED_BONES[name];
  return carryPoint(SAMBA_REST[name], SAMBA_REST[from], SAMBA_REST[to], rig[from], rig[to]);
};

test("spine bones keep their rest place in the rest pose (the chest is not pulled up to the neck)", () => {
  for (const name of ["Spine1", "Spine2"]) {
    assert.ok(dist(carry(name, SAMBA_REST), SAMBA_REST[name]) < 1e-9, name);
  }
});

test("bending the waist-neck bone carries the spine bones with it, lengths kept, chest below the neck", () => {
  for (const angle of [0.6, -0.9, 1.4]) {
    const rig = { waist: SAMBA_REST.waist, neck: tiltX(SAMBA_REST.neck, SAMBA_REST.waist, angle) };
    const chain = [rig.waist, carry("Spine1", rig), carry("Spine2", rig), rig.neck];
    const rest = [SAMBA_REST.waist, SAMBA_REST.Spine1, SAMBA_REST.Spine2, SAMBA_REST.neck];
    for (let i = 1; i < chain.length; i++) {
      assert.ok(Math.abs(dist(chain[i - 1], chain[i]) - dist(rest[i - 1], rest[i])) < 1e-9, `segment ${i} at ${angle}`);
    }
    // The chest stays between the waist and neck along the bone, never past the neck (onto the head).
    const axis = rig.neck.map((v, i) => v - rig.waist[i]);
    const along = (p) => p.reduce((s, v, i) => s + (v - rig.waist[i]) * axis[i], 0) / dist(rig.neck, rig.waist) ** 2;
    assert.ok(along(chain[2]) > 0 && along(chain[2]) < 1, `chest along ${along(chain[2])}`);
  }
});
