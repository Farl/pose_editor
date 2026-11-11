import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePoseImage } from '../aiService.js';
import { createDefaultPose } from '../pose.js';
import { normalizeView } from '../poseView.js';

test('3D reference request retains two-image boundary and omits inferred hand contacts', async () => {
  let request;
  globalThis.websim = { imageGen: async (payload) => { request = payload; return {url: 'stub://result'}; } };
  try {
    const result = await generatePoseImage('data:image/png;base64,AA==', createDefaultPose(), 'data:image/png;base64,AQ==', {
      includeHands: false, view: normalizeView({camera:'low', depth:{ankle_r:1}}), depthMode: '3d',
    });
    assert.equal(result, 'stub://result');
    assert.deepEqual(request.image_inputs.map(x => x.url), ['data:image/png;base64,AA==','data:image/png;base64,AQ==']);
    assert.match(request.prompt, /low angle/);
    assert.doesNotMatch(request.prompt, /HAND SHAPES AND CONTACTS/);
    assert.match(request.prompt, /closer to the camera than the torso/);
    assert.doesNotMatch(request.prompt, /points straight at the camera/);
    assert.doesNotMatch(request.prompt, /legs and feet closer and larger/);
  } finally { delete globalThis.websim; }
});
