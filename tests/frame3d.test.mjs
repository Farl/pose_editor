import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFrame } from '../mode3d/frame.js';
test('palm roll changes its normal while the long axis stays fixed', () => {
  const flat = surfaceFrame([0,0,0], [0,1,0], [1,1,0]);
  const rolled = surfaceFrame([0,0,0], [0,1,0], [0,1,1]);
  assert.deepEqual(flat.y, rolled.y);
  assert.ok(Math.abs(flat.z[2]) > 0.99);
  assert.ok(Math.abs(rolled.z[0]) > 0.99);
});
test('degenerate landmarks do not create non-finite basis vectors', () => {
  const basis = surfaceFrame([0,0,0], [0,0,0], [0,0,0]);
  assert.ok([...basis.x,...basis.y,...basis.z].every(Number.isFinite));
});
