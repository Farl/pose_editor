import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { JOINT_PARENT, JOINT_KEYS, IK_CHAINS, createDefaultPose, isFingerJoint } from '../pose.js';
import { CANVAS } from '../editorConfig.js';
import { FIGURE } from './config.js';
import { buildPresetPose, POSE_PRESETS } from '../posePresets.js';
import { projectPoint, cameraHeight, relativeDepth, depthRange, convexHull } from './project.js';
import { solveTwoBone } from './ik.js';
import { surfaceFrame } from './frame.js';
import { serialize3dState } from './state.js';

/// A self-authored articulated volumetric mannequin. Joint coordinates are
/// world-space, and moving a joint carries its descendants; no external mesh or
/// implied finger tracking is involved. Geometry is rebuilt from the rig.
export function createScene(host, onChange, initialState) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CANVAS.size, CANVAS.size);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202632);
  const c = FIGURE.camera;
  const camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);
  camera.position.fromArray(c.position);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.fromArray(c.target);
  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform);
  transform.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value; });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606070, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2, 4, 5); scene.add(light);
  const body = new THREE.Group(); scene.add(body);
  const handles = new THREE.Group(); scene.add(handles);
  const material = new THREE.MeshStandardMaterial({ color: 0xc6cbd2, roughness: 0.8 });
  const handleMaterial = new THREE.MeshBasicMaterial({ color: 0x60b9eb });
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  let showFingers = false;
  const positions = {};
  const defaultJoints = createDefaultPose().joints;
  for (const key of JOINT_KEYS) {
    const p = defaultJoints[key];
    positions[key] = new THREE.Vector3((p.x - CANVAS.size / 2) * FIGURE.scale, (CANVAS.size / 2 - p.y) * FIGURE.scale, 0);
  }
  function scaleFeet() {
    for (const side of ['r', 'l']) for (const part of ['heel', 'big_toe', 'small_toe']) {
      const ankle = positions[`ankle_${side}`], footPoint = positions[`${part}_${side}`];
      footPoint.sub(ankle).multiplyScalar(FIGURE.footRigScale).add(ankle);
    }
  }
  scaleFeet();
  if (initialState?.positions) for (const key of JOINT_KEYS) {
    const p = initialState.positions[key];
    if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) positions[key].fromArray(p);
  }
  if (initialState?.camera?.position) camera.position.fromArray(initialState.camera.position);
  if (initialState?.camera?.target) orbit.target.fromArray(initialState.camera.target);
  if (Number.isFinite(initialState?.camera?.fov) && initialState.camera.fov > 1 && initialState.camera.fov < 179) {
    camera.fov = initialState.camera.fov; camera.updateProjectionMatrix();
  }
  const descendants = (key) => JOINT_KEYS.filter((candidate) => {
    for (let p = candidate; p; p = JOINT_PARENT[p]) if (p === key) return true;
    return false;
  });
  function ellipsoid(center, scale, target = body, mat = material) {
    const mesh = new THREE.Mesh(sphere, mat); mesh.position.copy(center); mesh.scale.set(...scale); target.add(mesh); return mesh;
  }
  let headMesh;
  function orientSurface(mesh, origin, longPoint, sidePoint) {
    const { x, y, z } = surfaceFrame(origin.toArray(), longPoint.toArray(), sidePoint.toArray());
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
  }
  function rebuild() {
    body.clear(); handles.clear();
    const midpoint = (a, b) => positions[a].clone().add(positions[b]).multiplyScalar(0.5);
    headMesh = ellipsoid(positions.nose, FIGURE.head);
    orientSurface(headMesh, positions.neck, positions.nose, positions.eye_r);
    const torsoDirection = positions.neck.clone().sub(positions.pelvis);
    const torso = ellipsoid(midpoint('neck', 'pelvis'), [FIGURE.torso[0], torsoDirection.length() / 2, FIGURE.torso[2]]);
    orientSurface(torso, positions.pelvis, positions.neck, positions.shoulder_r);
    const hips = ellipsoid(positions.pelvis, FIGURE.pelvis);
    orientSurface(hips, positions.pelvis, positions.waist, positions.hip_r);
    for (const key of JOINT_KEYS) {
      const parent = JOINT_PARENT[key];
      if (!parent || /^(heel|big_toe|small_toe)_/.test(key) || ['nose', 'eye_r', 'eye_l', 'ear_r', 'ear_l', 'waist'].includes(key)) continue;
      const a = positions[parent], b = positions[key], length = a.distanceTo(b);
      const radius = isFingerJoint(key) ? FIGURE.fingerRadius : FIGURE.limbRadius;
      const mesh = ellipsoid(a.clone().add(b).multiplyScalar(0.5), [radius, length / 2 + radius, radius]);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    for (const side of ['r', 'l']) {
      const ankle = positions[`ankle_${side}`], toe = positions[`big_toe_${side}`];
      const foot = ellipsoid(ankle.clone().add(toe).multiplyScalar(0.5), FIGURE.foot);
      orientSurface(foot, ankle, toe, positions[`small_toe_${side}`]);
      const wrist = positions[`wrist_${side}`], middle = positions[`middle1_${side}`];
      if (middle) {
        const palm = ellipsoid(wrist.clone().add(middle).multiplyScalar(0.5), FIGURE.palm);
        orientSurface(palm, wrist, middle, positions[`index1_${side}`]);
      }
    }
    for (const key of ['pelvis', 'neck', 'shoulder_r', 'elbow_r', 'wrist_r', 'shoulder_l', 'elbow_l', 'wrist_l', 'hip_r', 'knee_r', 'ankle_r', 'hip_l', 'knee_l', 'ankle_l']) {
      if (transform.mode === 'translate' && key !== 'pelvis' && !IK_CHAINS[key]) continue;
      const handle = ellipsoid(positions[key], Array(3).fill(FIGURE.handleRadius), handles, handleMaterial);
      handle.userData.key = key;
    }
    if (showFingers && transform.mode === 'rotate') for (const key of JOINT_KEYS.filter((key) => isFingerJoint(key) && !key.includes('4_'))) {
      const handle = ellipsoid(positions[key], Array(3).fill(FIGURE.fingerHandleRadius), handles, handleMaterial);
      handle.userData.key = key;
    }
  }
  const proxy = new THREE.Object3D(); scene.add(proxy);
  let selection = null, last = new THREE.Vector3(), lastRotation = new THREE.Quaternion();
  transform.addEventListener('objectChange', () => {
    if (!selection) return;
    const delta = proxy.position.clone().sub(last); last.copy(proxy.position);
    const chain = IK_CHAINS[selection];
    if (transform.mode === 'rotate') {
      const rotation = proxy.quaternion.clone().multiply(lastRotation.clone().invert());
      lastRotation.copy(proxy.quaternion);
      for (const key of descendants(selection)) {
        if (key !== selection) positions[key].sub(proxy.position).applyQuaternion(rotation).add(proxy.position);
      }
    } else if (chain) {
      const [root, mid, end] = chain;
      const result = solveTwoBone(positions[root].toArray(), positions[mid].toArray(), positions[end].toArray(), proxy.position.toArray());
      const endDelta = new THREE.Vector3().fromArray(result.end).sub(positions[end]);
      positions[mid].fromArray(result.mid);
      for (const key of descendants(end)) positions[key].add(endDelta);
    } else {
      for (const key of descendants(selection)) positions[key].add(delta);
    }
    rebuild(); onChange();
  });
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(handles.children)[0];
    if (!hit) return;
    selection = hit.object.userData.key; proxy.position.copy(positions[selection]); last.copy(proxy.position); proxy.quaternion.identity(); lastRotation.identity(); transform.attach(proxy);
  });
  function render() { orbit.update(); renderer.render(scene, camera); }
  let raf = null;
  function animate() { raf = requestAnimationFrame(animate); render(); }
  function setActive(active) {
    if (active && raf === null) animate();
    if (!active && raf !== null) { cancelAnimationFrame(raf); raf = null; }
  }
  rebuild(); setActive(true);
  orbit.addEventListener('end', onChange);
  function surfaceDepthRange() {
    camera.updateMatrixWorld(); body.updateWorldMatrix(true, true);
    const bounds = body.children.map((mesh) => {
      const matrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      const e = matrix.elements, distance = -e[14], radius = Math.hypot(e[2], e[6], e[10]);
      return { near: distance - radius, far: distance + radius };
    });
    return depthRange(bounds, camera);
  }
  function state() {
    return serialize3dState(Object.fromEntries(JOINT_KEYS.map(key => [key, positions[key].toArray()])),
      { position: camera.position.toArray(), target: orbit.target.toArray(), fov: camera.fov, near: camera.near, far: camera.far }, surfaceDepthRange());
  }
  function project() {
    camera.updateMatrixWorld();
    return Object.fromEntries(JOINT_KEYS.map((key) => {
      const p = positions[key].clone().applyMatrix4(camera.matrixWorldInverse);
      const projected = projectPoint(p, camera);
      return [key, projected && { x: projected.x * CANVAS.size, y: projected.y * CANVAS.size }];
    }));
  }
  /// Render the same camera and geometry as linear view-space depth. Values
  /// reserve zero for background; surface bounds map to 255 and 1. No lighting or tone mapping.
  function depthPNG() {
    const oldBackground = scene.background, oldOverride = scene.overrideMaterial;
    const bounds = surfaceDepthRange();
    const visible = handles.visible, transformVisible = transform.visible;
    const depthMaterial = new THREE.ShaderMaterial({
      uniforms: { near: { value: bounds.near }, far: { value: bounds.far } },
      vertexShader: `varying float distanceFromCamera; void main() { vec4 v = modelViewMatrix * vec4(position, 1.0); distanceFromCamera = -v.z; gl_Position = projectionMatrix * v; }`,
      fragmentShader: `uniform float near; uniform float far; varying float distanceFromCamera; void main() { float d = (1.0 + 254.0 * clamp((far - distanceFromCamera) / (far - near), 0.0, 1.0)) / 255.0; gl_FragColor = vec4(vec3(d), 1.0); }`,
    });
    handles.visible = false; transform.visible = false;
    scene.background = new THREE.Color(0x000000); scene.overrideMaterial = depthMaterial;
    renderer.render(scene, camera);
    const result = renderer.domElement.toDataURL('image/png');
    scene.background = oldBackground; scene.overrideMaterial = oldOverride;
    handles.visible = visible; transform.visible = transformVisible; depthMaterial.dispose(); render();
    return result;
  }
  function applyPreset(id) {
    if (!(id in POSE_PRESETS)) return;
    const preset = buildPresetPose(id, createDefaultPose()).joints;
    for (const key of JOINT_KEYS) {
      const p = preset[key];
      positions[key].set((p.x - CANVAS.size / 2) * FIGURE.scale, (CANVAS.size / 2 - p.y) * FIGURE.scale, 0);
    }
    scaleFeet(); transform.detach(); selection = null; rebuild(); onChange();
  }
  function reset() {
    camera.position.fromArray(c.position); orbit.target.fromArray(c.target);
    camera.fov = c.fov; camera.updateProjectionMatrix();
    applyPreset('stand');
  }
  function headBounds() {
    camera.updateMatrixWorld(); headMesh.updateWorldMatrix(true, false);
    const vertices = headMesh.geometry.getAttribute('position'), points = [];
    for (let i = 0; i < vertices.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(headMesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      const q = projectPoint(p, camera);
      points.push(q && {x: q.x * CANVAS.size, y: q.y * CANVAS.size});
    }
    return convexHull(points);
  }
  function view() {
    camera.updateMatrixWorld();
    const projected = project();
    const depth = {};
    const torsoLength = positions.neck.distanceTo(positions.pelvis);
    const torsoCenter = positions.neck.clone().add(positions.pelvis).multiplyScalar(0.5);
    const torso = torsoCenter.clone().applyMatrix4(camera.matrixWorldInverse);
    for (const part of ['wrist', 'ankle']) for (const side of ['r', 'l']) {
      const key = `${part}_${side}`, twin = `${part}_${side === 'r' ? 'l' : 'r'}`;
      const p = projected[key], other = projected[twin];
      const inFrame = p && other && [p, other].every(q => q.x >= 0 && q.x <= CANVAS.size && q.y >= 0 && q.y <= CANVAS.size);
      const point = positions[key].clone().applyMatrix4(camera.matrixWorldInverse);
      depth[key] = inFrame ? relativeDepth(-point.z, -torso.z, torsoLength) : 0;
    }
    return { camera: cameraHeight(camera.position.toArray(), torsoCenter.toArray(), FIGURE.cameraPitchThreshold), depth };
  }
  function setFov(value) {
    camera.fov = Math.max(c.minFov, Math.min(c.maxFov, Number(value)));
    camera.updateProjectionMatrix(); onChange();
  }
  function setMode(mode) { transform.detach(); selection = null; transform.setMode(mode); rebuild(); }
  function setFingerHandles(visible) { showFingers = visible; rebuild(); }
  return { state, project, view, headBounds, depthPNG, reset, applyPreset, setMode, setFov, setFingerHandles, setActive, dispose() { cancelAnimationFrame(raf); transform.dispose(); orbit.dispose(); renderer.dispose(); renderer.domElement.remove(); } };
}
