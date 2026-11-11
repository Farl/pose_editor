import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize3dState } from '../mode3d/state.js';
test('3D serialization preserves camera, pose, and independent depth range', () => {
  const positions = { wrist_r:[1,2,3] }, camera={position:[0,1,5],target:[0,0,0],fov:38,near:0.1,far:20};
  const result = serialize3dState(positions,camera,{near:1,far:4});
  positions.wrist_r[0]=9; camera.position[0]=8;
  const restored=JSON.parse(JSON.stringify(result));
  assert.equal(restored.version,1);
  assert.deepEqual(restored.positions.wrist_r,[1,2,3]);
  assert.deepEqual(restored.camera.position,[0,1,5]);
  assert.deepEqual(restored.depthRange,{near:1,far:4});
  assert.equal(restored.depthEncoding,'linear-camera-z-near-white-background-black');
});
