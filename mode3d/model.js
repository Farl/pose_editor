import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { jointForBone, rigFromBonePositions } from "./rigMap.js";
import { surfaceFrame } from "./frame.js";
import { FIGURE } from "./config.js";

/// Runtime-only pinned upstream asset. No FBX or texture is repackaged here.
export async function loadBody(scene) {
  const model = await new FBXLoader().loadAsync(FIGURE.model.url);
  model.scale.setScalar(FIGURE.model.unitScale);
  scene.add(model);
  model.updateMatrixWorld(true);
  const bones = [];
  model.traverse((node) => {
    if (node.isBone) bones.push(node);
  });
  const rest = new Map(
    bones.map((b) => [b, { position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() }]),
  );
  const meshes = [];
  model.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  const bonePositions = {};
  for (const bone of bones)
    if (bone.parent.name !== bone.name) bonePositions[bone.name] = bone.getWorldPosition(new THREE.Vector3()).toArray();
  const bindRig = rigFromBonePositions(bonePositions);
  const frameQuaternion = (rig, key) => {
    const side = key.endsWith("_r") ? "r" : "l",
      foot = key.startsWith("ankle");
    const points = foot
      ? [rig[`heel_${side}`], rig[`big_toe_${side}`], rig[`small_toe_${side}`]]
      : [rig[`wrist_${side}`], rig[`index1_${side}`], rig[`pinky1_${side}`]];
    const { x, y, z } = surfaceFrame(...points.map((p) => (p.isVector3 ? p.toArray() : p)));
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)),
    );
  };
  const restWorld = new Map(bones.map((b) => [b, b.getWorldQuaternion(new THREE.Quaternion())]));
  const sourceOrigin = new THREE.Vector3(
    ...bonePositions[Object.keys(bonePositions).find((n) => jointForBone(n) === "pelvis")],
  );
  const headBone = bones.find((b) => b.parent.name !== b.name && jointForBone(b.name) === "nose");
  const headOffset = headBone
    .getWorldPosition(new THREE.Vector3())
    .sub(sourceOrigin)
    .sub(new THREE.Vector3(...bindRig.nose));
  const targetFor = (bone, positions) => {
    const joint = jointForBone(bone.name);
    // Head is a neck-side pivot, not the visible nose. Preserve its bind
    // offset instead of translating the entire head mesh onto the face point.
    if (joint === "nose") return positions.nose.clone().add(headOffset);
    if (joint) return positions[joint];
    const suffix = bone.name.replace(/^mixamorig:?/i, "");
    if (suffix === "Spine1") return positions.waist.clone().lerp(positions.neck, 0.5);
    if (suffix === "Spine2") return positions.neck.clone();
    if (suffix === "HeadTop_End") return positions.nose.clone().add(positions.nose.clone().sub(positions.neck));
    return null;
  };
  function sync(positions) {
    for (const bone of bones) {
      const r = rest.get(bone);
      bone.position.copy(r.position);
      bone.quaternion.copy(r.quaternion);
      bone.scale.copy(r.scale);
    }
    model.updateMatrixWorld(true);
    // Preorder bones: transform parents first, then place each child at the
    // target joint. This retargets bind-pose bone lengths to the editor rig.
    for (const bone of bones) {
      // Samba contains same-name leaf bones used by skin clusters. They must
      // inherit the animated parent, not cancel its world rotation.
      if (bone.parent.name === bone.name) continue;
      const target = targetFor(bone, positions);
      if (!target) continue;
      bone.position.copy(bone.parent.worldToLocal(target.clone()));
      bone.updateWorldMatrix(true, true);
      const mapped = jointForBone(bone.name);
      if (mapped && /^(wrist|ankle)_/.test(mapped)) {
        const desired = frameQuaternion(positions, mapped)
          .multiply(frameQuaternion(bindRig, mapped).invert())
          .multiply(restWorld.get(bone));
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
        bone.updateWorldMatrix(true, true);
        continue;
      }
      const child = bone.children.find((c) => c.isBone && c.name !== bone.name && targetFor(c, positions));
      if (child) {
        const from = child.getWorldPosition(new THREE.Vector3()).sub(target);
        const to = targetFor(child, positions).clone().sub(target);
        if (from.lengthSq() && to.lengthSq()) {
          const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
          const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
          bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
          bone.updateWorldMatrix(true, true);
        }
      }
    }
    for (const mesh of meshes) if (mesh.isSkinnedMesh) mesh.skeleton.update();
  }
  function surfaceVertices(headOnly = false) {
    const out = [],
      vertex = new THREE.Vector3();
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute("position");
      const indices = mesh.geometry.getAttribute("skinIndex"),
        weights = mesh.geometry.getAttribute("skinWeight");
      const headBones = mesh.isSkinnedMesh
        ? new Set(mesh.skeleton.bones.map((b, i) => (/Head|Eye/.test(b.name) ? i : -1)).filter((i) => i >= 0))
        : new Set();
      for (let i = 0; i < positions.count; i++) {
        if (headOnly) {
          if (!indices || !weights) continue;
          let headWeight = 0;
          for (let n = 0; n < 4; n++)
            if (headBones.has([indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)][n]))
              headWeight += [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)][n];
          if (headWeight < FIGURE.model.headWeight) continue;
        }
        mesh.getVertexPosition(i, vertex);
        out.push(vertex.clone().applyMatrix4(mesh.matrixWorld));
      }
    }
    return out;
  }
  function alignment(positions) {
    return bones
      .filter((b) => b.parent.name !== b.name && jointForBone(b.name))
      .map((b) => ({
        bone: b.name,
        joint: jointForBone(b.name),
        error: b.getWorldPosition(new THREE.Vector3()).distanceTo(targetFor(b, positions)),
      }));
  }
  return {
    alignment,
    sync,
    surfaceVertices,
    model,
    bindRig,
    dispose() {
      model.traverse((n) => {
        if (n.isMesh) {
          n.geometry.dispose();
          for (const m of Array.isArray(n.material) ? n.material : [n.material]) m.dispose();
        }
      });
      model.removeFromParent();
    },
  };
}
