import test from "node:test";
import assert from "node:assert/strict";
import { solveTwoBone } from "../mode3d/ik.js";
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
test("3D two-bone solve reaches target while retaining lengths", () => {
  const root = [0, 0, 0],
    mid = [1, 0, 0],
    end = [1, 1, 0],
    target = [0.5, 0.5, 1];
  const result = solveTwoBone(root, mid, end, target);
  assert.ok(distance(result.end, target) < 1e-8);
  assert.ok(Math.abs(distance(root, result.mid) - 1) < 1e-8);
  assert.ok(Math.abs(distance(result.mid, result.end) - 1) < 1e-8);
});
test("unreachable target clamps to total length", () => {
  const result = solveTwoBone([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 10]);
  assert.ok(Math.abs(distance([0, 0, 0], result.end) - 2) < 1e-8);
});
test("fully folded chain at the root stays finite", () => {
  const result = solveTwoBone([0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 0]);
  assert.ok([...result.mid, ...result.end].every(Number.isFinite));
  assert.ok(Math.abs(distance([0, 0, 0], result.mid) - 1) < 1e-8);
  assert.ok(Math.abs(distance(result.mid, result.end) - 1) < 1e-8);
});
test("a pole point picks the bend side without changing bone lengths", () => {
  const root = [0, 0, 0],
    mid = [1, 0, 0],
    end = [1, 1, 0];
  // Pole far away on -X / +Z: the elbow moves toward it, the hand stays.
  const pole = [-3, 0.5, 2];
  const result = solveTwoBone(root, mid, end, end, pole);
  assert.ok(distance(result.end, end) < 1e-8);
  assert.ok(Math.abs(distance(root, result.mid) - 1) < 1e-8);
  assert.ok(Math.abs(distance(result.mid, result.end) - 1) < 1e-8);
  assert.ok(result.mid[2] > 0.3 && result.mid[0] < 0.5, `elbow toward the pole: ${result.mid}`);
});
