// 3D camera framing math (mode3d/views.js).
import test from "node:test";
import assert from "node:assert/strict";
import { boundingSphere, frameDistance, viewPosition } from "../mode3d/views.js";

test("bounding sphere: box centre, furthest point, minimum radius", () => {
  const { center, radius } = boundingSphere([[0, 0, 0], [2, 0, 0], [1, 1, 0]]);
  assert.deepEqual(center, [1, 0.5, 0]);
  assert.equal(radius, Math.hypot(1, 0.5));
  assert.equal(boundingSphere([[3, 3, 3]], 0.2).radius, 0.2);
});

test("frame distance fits the sphere in the field of view", () => {
  assert.ok(Math.abs(frameDistance(1, 60) - 2) < 1e-12);
  assert.ok(Math.abs(frameDistance(1, 60, 1.5) - 3) < 1e-12);
});

test("view position: along the direction at the distance; straight down leans toward +Z", () => {
  assert.deepEqual(viewPosition([1, 1, 0], [0, 0, 2], 3), [1, 1, 3]);
  const top = viewPosition([0, 0, 0], [0, 1, 0], 2, 1e-3);
  assert.ok(top[2] > 0 && Math.abs(Math.hypot(...top) - 2) < 1e-12);
});
