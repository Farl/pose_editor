import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePoseImage } from '../aiService.js';
import { createDefaultPose } from '../pose.js';
import { normalizeView } from '../poseView.js';
import { applyHandGesture, fingerStates, handContact } from '../handPoses.js';
import { facesCamera } from '../mode3d/semantics.js';

async function capture(pose, options) {
  let request;
  globalThis.websim = { imageGen: async payload => { request = payload; return { url:'stub://result' }; } };
  try { await generatePoseImage('data:image/png;base64,AA==',pose,'data:image/png;base64,AQ==',options); return request; }
  finally { delete globalThis.websim; }
}

test('3D request uses world hand states and retains strong camera/depth with verified orientation', async () => {
  const pose=createDefaultPose(); applyHandGesture(pose.joints,'r','fist');
  const world=structuredClone(pose.joints); for(const p of Object.values(world))p.z=0;
  const request=await capture(pose,{includeHands:true,worldJoints:world,depthMode:'3d',surfaceFacing:{ankle_r:true},view:normalizeView({camera:'low',depth:{ankle_r:1}})});
  assert.equal(request.image_inputs.length,2);
  assert.match(request.prompt,/closed fist/); assert.match(request.prompt,/worm's-eye/);
  assert.match(request.prompt,/showing the sole/);
  const back=await capture(pose,{depthMode:'3d',surfaceFacing:{ankle_r:false},view:normalizeView({depth:{ankle_r:1}})});
  assert.doesNotMatch(back.prompt,/showing the sole/); assert.match(back.prompt,/draw it larger/);
});

test('clipped joints do not throw or invent hand/contact/depth assertions',async()=>{
  const pose=createDefaultPose(); for(const key of Object.keys(pose.joints))pose.joints[key]=null;
  const request=await capture(pose,{includeHands:true,view:normalizeView({camera:'low',depth:{ankle_r:1}})});
  assert.doesNotMatch(request.prompt,/HAND SHAPES AND CONTACTS/);
  assert.doesNotMatch(request.prompt,/The image-left foot/);
});

test('partly clipped body and fingers can still generate a safe prompt',async()=>{
  const pose=createDefaultPose();pose.joints.nose=null;pose.joints.eye_r=null;pose.joints.index2_r=null;
  const request=await capture(pose,{includeHands:true,view:normalizeView({depth:{wrist_r:1}})});
  assert.equal(request.image_inputs.length,2);
});

test('world finger classification is invariant under rigid 3D rotation',()=>{
  const pose=createDefaultPose();applyHandGesture(pose.joints,'r','fist');
  const j=structuredClone(pose.joints),rot=structuredClone(j);
  for(const [key,p] of Object.entries(j)){p.z=0;rot[key]={x:p.x,y:0,z:p.y};}
  assert.deepEqual(fingerStates(j,'r'),fingerStates(rot,'r'));
});

test('projected overlap with separated world depth is not body contact',()=>{
  const j=createDefaultPose().joints;
  for(const [key,p]of Object.entries(j))p.z=/(_r|_l)$/.test(key)&&/wrist|thumb|index|middle|ring|pinky/.test(key)?1000:0;
  for(const key of Object.keys(j).filter(k=>/wrist_r|(?:thumb|index|middle|ring|pinky)\d_r/.test(k))){j[key].x=j.nose.x;j[key].y=j.nose.y;}
  assert.equal(handContact(j,'r'),null);
});

test('same near surface facing front versus back changes orientation verdict',()=>{
  const o=[0,0,0],long=[0,-1,0],side=[-1,0,0];
  assert.equal(facesCamera(o,long,side,[0,0,3],'r'),true);
  assert.equal(facesCamera(o,long,side,[0,0,-3],'r'),false);
  assert.equal(facesCamera(o,long,side,[3,0,0],'r'),false);
});

test('2D equal-x wrists retain the original stable left/right labels',async()=>{
 const pose=createDefaultPose();pose.joints.wrist_l.x=pose.joints.wrist_r.x;
 const {prompt}=await capture(pose,{includeHands:true});
 assert.match(prompt,/The image-left hand:/);assert.match(prompt,/The image-right hand:/);
});

test('review minimum reproduction: only right wrist clipped, positive depth, 3D mode',async()=>{
 const pose=createDefaultPose();pose.joints.wrist_r=null;
 const request=await capture(pose,{includeHands:true,depthMode:'3d',view:normalizeView({depth:{wrist_r:1}})});
 assert.equal(request.image_inputs.length,2);
 assert.doesNotMatch(request.prompt,/The image-left hand is thrust/);
});
