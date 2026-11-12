import { FIGURE } from './config.js';
/// Exact Mixamo suffixes (FBXLoader may remove ':'), not substring matching:
/// RightShoulder is the collar bone; RightArm is the shoulder joint.
const CENTRE = { Hips:'pelvis', Spine:'waist', Neck:'neck', Head:'nose', RightEye:'eye_r', LeftEye:'eye_l' };
const LIMB = { Arm:'shoulder', ForeArm:'elbow', Hand:'wrist', UpLeg:'hip', Leg:'knee', Foot:'ankle', ToeBase:'big_toe' };
export function jointForBone(name) {
  const suffix=name.replace(/^mixamorig:?/i,'');
  if (CENTRE[suffix]) return CENTRE[suffix];
  const match=/^(Right|Left)(.+)$/.exec(suffix);
  if (!match) return null;
  const side=match[1]==='Right'?'r':'l', part=match[2];
  if (LIMB[part]) return `${LIMB[part]}_${side}`;
  const finger=/^Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/.exec(part);
  return finger ? `${finger[1].toLowerCase()}${finger[2]}_${side}` : null;
}

/// Pure Mixamo-to-66 mapping. Bone positions are in model world units. Eyes and
/// fingers use actual bones; ears and heel/outer-toe landmarks are derived.
export function rigFromBonePositions(bones) {
  const rig={};
  for(const [name,p]of Object.entries(bones)){const key=jointForBone(name);if(key)rig[key]=[...p];}
  const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
  const eyes=mid(rig.eye_r,rig.eye_l);
  rig.nose=[...eyes];
  for(const side of ['r','l']){
    const other=side==='r'?'l':'r', eye=rig[`eye_${side}`],twin=rig[`eye_${other}`];
    rig[`ear_${side}`]=eye.map((v,i)=>v+(v-twin[i])*FIGURE.rigDerivation.earEyeSpan);
    const ankle=rig[`ankle_${side}`],toe=rig[`big_toe_${side}`];
    rig[`heel_${side}`]=ankle.map((v,i)=>v+(v-toe[i])*FIGURE.rigDerivation.heelLength);
    const hip=rig[`hip_${side}`],otherHip=rig[`hip_${other}`];
    const axis=hip.map((v,i)=>v-otherHip[i]), length=Math.hypot(...axis)||1;
    const width=Math.hypot(...toe.map((v,i)=>v-ankle[i]))*FIGURE.rigDerivation.outerToeWidth;
    rig[`small_toe_${side}`]=toe.map((v,i)=>v+axis[i]/length*width);
  }
  const origin=rig.pelvis;
  return Object.fromEntries(Object.entries(rig).map(([key,p])=>[key,p.map((v,i)=>v-origin[i])]));
}
