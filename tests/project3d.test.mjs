import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint, linearDepth } from '../mode3d/project.js';

const camera = { fov: 90, aspect: 1, near: 1, far: 10 };
test('perspective shrinks equal offsets with increasing distance', () => {
  assert.equal(projectPoint({x: 1, y: 0, z: -2}, camera).x, 0.75);
  assert.equal(projectPoint({x: 1, y: 0, z: -4}, camera).x, 0.625);
});
test('rejects behind-camera and clipped points', () => {
  for (const z of [1, -0.5, -11]) assert.equal(projectPoint({x: 0, y: 0, z}, camera), null);
});
test('maps visible camera-space depth near white, far above black background', () => {
  assert.equal(linearDepth(1, camera), 255);
  assert.equal(linearDepth(10, camera), 1);
  assert.equal(linearDepth(11, camera), 0);
});

test('camera height classification follows camera pitch to target', async () => {
  const { cameraHeight } = await import('../mode3d/project.js');
  assert.equal(cameraHeight([0, 2, 4], [0, 0, 0], 0.3), 'high');
  assert.equal(cameraHeight([0, -2, 4], [0, 0, 0], 0.3), 'low');
  assert.equal(cameraHeight([0, 0, 4], [0, 0, 0], 0.3), 'eye');
});
test('relative 3D depth is positive for nearer endpoint and clamps', async () => {
  const { relativeDepth } = await import('../mode3d/project.js');
  assert.equal(relativeDepth(1, 2, 1), 1);
  assert.equal(relativeDepth(3, 2, 1), -1);
  assert.equal(relativeDepth(0.5, 2, 1), 1);
});
test('surface depth bounds are clipped to camera planes', async () => {
  const { depthRange } = await import('../mode3d/project.js');
  assert.deepEqual(depthRange([{near:0.5, far:2}, {near:3, far:12}], camera), {near:1, far:10});
  assert.deepEqual(depthRange([{near:2, far:4}], camera), {near:2, far:4});
});
test('head outline bounds come from projected extremities', async () => {
  const { outlineBounds } = await import('../mode3d/project.js');
  assert.deepEqual(outlineBounds([{x:1,y:3},{x:5,y:7},{x:3,y:4}]), {x:3,y:5,rx:2,ry:2});
  assert.equal(outlineBounds([{x:1,y:2}, null]), null);
});
test('projected head hull encloses diagonal silhouette vertices', async () => {
  const { convexHull } = await import('../mode3d/project.js');
  const hull = convexHull([{x:0,y:1},{x:1,y:0},{x:2,y:1},{x:1,y:2},{x:1,y:1}]);
  assert.equal(hull.length, 4);
  assert.ok(hull.some(p => p.x === 2 && p.y === 1));
});
