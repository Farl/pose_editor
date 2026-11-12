import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { JOINT_PARENT, JOINT_KEYS, IK_CHAINS, createDefaultPose, isFingerJoint } from "../pose.js";
import { CANVAS, PICKING } from "../editorConfig.js";
import { FIGURE, CONTROLS } from "./config.js";
import { createAxisGizmo } from "./axisGizmo.js";
import { boundingSphere, frameDistance, viewPosition } from "./views.js";
import { buildPresetPose, POSE_PRESETS } from "../posePresets.js";
import { projectPoint, cameraHeight, bodyPlaneDepth, depthRange, convexHull } from "./project.js";
import { solveTwoBone } from "./ik.js";
import { surfaceFrame } from "./frame.js";
import { semanticState as deriveSemantics } from "./semantics.js";
import { loadBody } from "./model.js";
import { serialize3dState } from "./state.js";

/// Joints with a handle (plus finger joints when finger handles are on).
const BODY_HANDLES = [
  "pelvis",
  "neck",
  "nose",
  ...["r", "l"].flatMap((s) => [`shoulder_${s}`, `elbow_${s}`, `wrist_${s}`, `hip_${s}`, `knee_${s}`, `ankle_${s}`]),
];

/// A self-authored articulated volumetric mannequin. Joint coordinates are
/// world-space, and moving a joint carries its descendants; no external mesh or
/// implied finger tracking is involved. Geometry is rebuilt from the rig.
///
/// Tools (TOOLS in editorConfig.js, set by setTool) work like the 2D ones:
///   select  click a handle or the body to select the nearest joint; no gizmo
///   ik      move: drag a handle across the screen, or the gizmo's axes. Hands
///           and feet use IK, elbows and knees pick their bend side, the hips
///           carry the body, and any other joint swings its bone (moveJoint)
///   fk      rotate: the gizmo turns the joint's children around it
///   depth   drag a handle up / down to bring it toward / away from the camera
///   free    has no 3D meaning and acts as ik
/// Camera: drag empty space (or Alt + drag anywhere) to orbit, right / middle
/// drag or two fingers to pan, wheel or pinch to zoom; frame(), showView() and
/// the corner axis gizmo move it.
export async function createScene(host, onChange, initialState) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CANVAS.size, CANVAS.size);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202632);
  const c = FIGURE.camera;
  const camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);
  camera.position.fromArray(c.position);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.fromArray(c.target);
  orbit.enableDamping = CONTROLS.damping > 0;
  orbit.dampingFactor = CONTROLS.damping;
  orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform);
  transform.addEventListener("dragging-changed", (event) => {
    orbit.enabled = !event.value;
  });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606070, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2, 4, 5);
  scene.add(light);
  const body = new THREE.Group();
  scene.add(body);
  const handles = new THREE.Group();
  scene.add(handles);
  const material = new THREE.MeshStandardMaterial({ color: 0xc6cbd2, roughness: 0.8 });
  const handleMaterial = new THREE.MeshBasicMaterial({ color: CONTROLS.handleColor });
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: CONTROLS.selectedColor });
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  let showFingers = false;
  const positions = {};
  const defaultJoints = createDefaultPose().joints;
  for (const key of JOINT_KEYS) {
    const p = defaultJoints[key];
    positions[key] = new THREE.Vector3(
      (p.x - CANVAS.size / 2) * FIGURE.scale,
      (CANVAS.size / 2 - p.y) * FIGURE.scale,
      0,
    );
  }
  function scaleFeet() {
    for (const side of ["r", "l"])
      for (const part of ["heel", "big_toe", "small_toe"]) {
        const ankle = positions[`ankle_${side}`],
          footPoint = positions[`${part}_${side}`];
        footPoint.sub(ankle).multiplyScalar(FIGURE.footRigScale).add(ankle);
      }
  }
  scaleFeet();
  if (
    Number.isFinite(initialState?.camera?.near) &&
    initialState.camera.near > 0 &&
    Number.isFinite(initialState?.camera?.far) &&
    initialState.camera.far > initialState.camera.near
  ) {
    camera.near = initialState.camera.near;
    camera.far = initialState.camera.far;
    camera.updateProjectionMatrix();
  }
  if (initialState?.camera?.position) camera.position.fromArray(initialState.camera.position);
  if (initialState?.camera?.target) orbit.target.fromArray(initialState.camera.target);
  if (Number.isFinite(initialState?.camera?.fov) && initialState.camera.fov > 1 && initialState.camera.fov < 179) {
    camera.fov = initialState.camera.fov;
    camera.updateProjectionMatrix();
  }
  const descendants = (key) =>
    JOINT_KEYS.filter((candidate) => {
      for (let p = candidate; p; p = JOINT_PARENT[p]) if (p === key) return true;
      return false;
    });
  function ellipsoid(center, scale, target = body, mat = material) {
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.position.copy(center);
    mesh.scale.set(...scale);
    target.add(mesh);
    return mesh;
  }
  let skin = null,
    modelError = null;
  try {
    skin = await loadBody(scene);
  } catch (error) {
    modelError = `Samba could not load: ${error.message}. Using procedural fallback.`;
  }
  if (skin) for (const key of JOINT_KEYS) positions[key].fromArray(skin.bindRig[key]);
  const presetBase = {
    joints: Object.fromEntries(
      JOINT_KEYS.map((key) => [
        key,
        { x: CANVAS.size / 2 + positions[key].x / FIGURE.scale, y: CANVAS.size / 2 - positions[key].y / FIGURE.scale },
      ]),
    ),
  };
  if (initialState?.positions)
    for (const key of JOINT_KEYS) {
      const p = initialState.positions[key];
      if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) positions[key].fromArray(p);
    }

  body.visible = !skin;
  let headMesh;
  function orientSurface(mesh, origin, longPoint, sidePoint) {
    const { x, y, z } = surfaceFrame(origin.toArray(), longPoint.toArray(), sidePoint.toArray());
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)),
    );
  }
  function rebuild() {
    body.clear();
    handles.clear();
    const midpoint = (a, b) => positions[a].clone().add(positions[b]).multiplyScalar(0.5);
    headMesh = ellipsoid(positions.nose, FIGURE.head);
    orientSurface(headMesh, positions.neck, positions.nose, positions.eye_r);
    const torsoDirection = positions.neck.clone().sub(positions.pelvis);
    const torso = ellipsoid(midpoint("neck", "pelvis"), [
      FIGURE.torso[0],
      torsoDirection.length() / 2,
      FIGURE.torso[2],
    ]);
    orientSurface(torso, positions.pelvis, positions.neck, positions.shoulder_r);
    const hips = ellipsoid(positions.pelvis, FIGURE.pelvis);
    orientSurface(hips, positions.pelvis, positions.waist, positions.hip_r);
    for (const key of JOINT_KEYS) {
      const parent = JOINT_PARENT[key];
      if (
        !parent ||
        /^(heel|big_toe|small_toe)_/.test(key) ||
        ["nose", "eye_r", "eye_l", "ear_r", "ear_l", "waist"].includes(key)
      )
        continue;
      const a = positions[parent],
        b = positions[key],
        length = a.distanceTo(b);
      const radius = isFingerJoint(key) ? FIGURE.fingerRadius : FIGURE.limbRadius;
      const mesh = ellipsoid(a.clone().add(b).multiplyScalar(0.5), [radius, length / 2 + radius, radius]);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    for (const side of ["r", "l"]) {
      const ankle = positions[`ankle_${side}`],
        toe = positions[`big_toe_${side}`];
      const foot = ellipsoid(ankle.clone().add(toe).multiplyScalar(0.5), FIGURE.foot);
      orientSurface(foot, ankle, toe, positions[`small_toe_${side}`]);
      const wrist = positions[`wrist_${side}`],
        middle = positions[`middle1_${side}`];
      if (middle) {
        const palm = ellipsoid(wrist.clone().add(middle).multiplyScalar(0.5), FIGURE.palm);
        orientSurface(palm, wrist, middle, positions[`index1_${side}`]);
      }
    }
    skin?.sync(positions);
    const fingers = showFingers ? JOINT_KEYS.filter((key) => isFingerJoint(key) && !key.includes("4_")) : [];
    for (const key of [...BODY_HANDLES, ...fingers]) {
      const radius = isFingerJoint(key) ? FIGURE.fingerHandleRadius : FIGURE.handleRadius;
      const mat = key === selection ? selectedMaterial : handleMaterial;
      const handle = ellipsoid(positions[key], Array(3).fill(radius), handles, mat);
      handle.userData.key = key;
    }
  }
  const proxy = new THREE.Object3D();
  scene.add(proxy);
  /// Current tool (TOOLS id) and selected joint (or null).
  let tool = "ik";
  let selection = null,
    last = new THREE.Vector3(),
    lastRotation = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  /// Gizmo mode per tool; tools without one show no gizmo.
  const GIZMO_MODES = { ik: "translate", free: "translate", fk: "rotate" };

  /// Put the gizmo proxy on the selected joint, turned to its bone (local
  /// space: Y along the bone from its parent), and attach the gizmo if the
  /// tool has one.
  function placeProxy() {
    transform.detach();
    if (!selection) return;
    proxy.position.copy(positions[selection]);
    const parent = JOINT_PARENT[selection];
    const bone = parent && positions[selection].clone().sub(positions[parent]);
    if (bone && bone.lengthSq() > 0) proxy.quaternion.setFromUnitVectors(UP, bone.normalize());
    else proxy.quaternion.identity();
    last.copy(proxy.position);
    lastRotation.copy(proxy.quaternion);
    const mode = GIZMO_MODES[tool];
    if (mode) {
      transform.setMode(mode);
      transform.attach(proxy);
    }
  }

  function select(key) {
    selection = key;
    placeProxy();
    rebuild();
  }

  /// Move joint `key` toward world point `target`, keeping bone lengths:
  ///   pelvis       the whole body follows
  ///   hand / foot  two-bone IK from the shoulder / hip
  ///   elbow / knee bends its limb toward the target; hand / foot stay put
  ///   any other    its bone swings from the parent to point at the target
  function moveJoint(key, target) {
    if (key === "pelvis") {
      const delta = target.clone().sub(positions[key]);
      for (const k of JOINT_KEYS) positions[k].add(delta);
      return;
    }
    const chain = IK_CHAINS[key];
    const limb = Object.values(IK_CHAINS).find(([, mid]) => mid === key);
    if (chain) {
      const [root, mid, end] = chain;
      const result = solveTwoBone(positions[root].toArray(), positions[mid].toArray(), positions[end].toArray(), target.toArray());
      const endDelta = new THREE.Vector3().fromArray(result.end).sub(positions[end]);
      positions[mid].fromArray(result.mid);
      for (const k of descendants(end)) positions[k].add(endDelta);
    } else if (limb) {
      const [root, , end] = limb;
      // The target stands in for the elbow / knee as the bend-side hint.
      const result = solveTwoBone(positions[root].toArray(), target.toArray(), positions[end].toArray(), positions[end].toArray());
      positions[key].fromArray(result.mid);
    } else {
      const pivot = positions[JOINT_PARENT[key]].clone();
      const from = positions[key].clone().sub(pivot);
      const to = target.clone().sub(pivot);
      if (from.lengthSq() === 0 || to.lengthSq() === 0) return;
      const turn = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      for (const k of descendants(key)) positions[k].sub(pivot).applyQuaternion(turn).add(pivot);
    }
  }

  transform.addEventListener("objectChange", () => {
    if (!selection) return;
    if (transform.mode === "rotate") {
      const rotation = proxy.quaternion.clone().multiply(lastRotation.clone().invert());
      lastRotation.copy(proxy.quaternion);
      for (const key of descendants(selection)) {
        if (key !== selection) positions[key].sub(proxy.position).applyQuaternion(rotation).add(proxy.position);
      }
    } else {
      moveJoint(selection, proxy.position);
    }
    rebuild();
    onChange();
  });
  // A constrained move can leave the joint short of the gizmo: put it back.
  transform.addEventListener("mouseUp", placeProxy);

  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  const dom = renderer.domElement;
  function aim(event) {
    const rect = dom.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
  }
  /// Handle under the pointer: the one nearest it on screen within the 2D
  /// pick radius for this pointer type (PICKING.radiusPx), nearer the camera
  /// on a tie; its joint key, or null.
  function pickHandle(event) {
    aim(event);
    const rect = dom.getBoundingClientRect();
    const radius = PICKING.radiusPx[event.pointerType] ?? PICKING.radiusPx.mouse;
    let best = null,
      bestScore = Infinity;
    for (const handle of handles.children) {
      const key = handle.userData.key;
      const p = positions[key].clone().project(camera);
      if (p.z > 1) continue;
      const px = Math.hypot(((p.x - pointer.x) / 2) * rect.width, ((p.y - pointer.y) / 2) * rect.height);
      const score = px + p.z;
      if (px <= radius && score < bestScore) {
        best = key;
        bestScore = score;
      }
    }
    return best;
  }
  /// Body under the pointer: the handle joint nearest the hit, or null.
  function pickBody(event) {
    aim(event);
    const meshes = skin ? skin.meshes : body.children;
    // A posed skinned mesh's cached bounds are stale; recompute them.
    for (const mesh of meshes) if (mesh.isSkinnedMesh) mesh.boundingSphere = null;
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const keys = handles.children.map((h) => h.userData.key);
    return keys.reduce((best, k) => (positions[k].distanceTo(hit.point) < positions[best].distanceTo(hit.point) ? k : best));
  }

  /// Pointer press on the canvas, before OrbitControls / TransformControls see
  /// it (capture phase), or null:
  ///   { pointerId, x, y, moved, key, drag }
  /// `key` is the handle it grabbed (selected at once; the orbit is off until
  /// release). `drag`, for tools that drag handles directly:
  ///   { key, plane, offset }        ik: the joint follows the pointer across the screen
  ///   { key, start, toCamera, y, perPx }  depth: up / down moves it along the view axis
  let press = null;
  dom.addEventListener(
    "pointerdown",
    (event) => {
      if (press || event.button !== 0 || transform.axis || transform.dragging) return;
      const key = event.altKey ? null : pickHandle(event);
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, key, drag: null };
      if (!key) return;
      select(key);
      orbit.enabled = false;
      if (tool === "depth") {
        const rect = dom.getBoundingClientRect();
        const distance = camera.position.distanceTo(positions[key]);
        const spanPerPx = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / rect.height;
        const start = positions[key].clone();
        const toCamera = camera.position.clone().sub(start).normalize();
        press.drag = { key, start, toCamera, y: event.clientY, perPx: spanPerPx * CONTROLS.depthDragGain };
      } else if (GIZMO_MODES[tool] === "translate") {
        const normal = camera.getWorldDirection(new THREE.Vector3());
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, positions[key]);
        const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        press.drag = { key, plane, offset: hit ? positions[key].clone().sub(hit) : new THREE.Vector3() };
      }
    },
    true,
  );
  dom.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CONTROLS.tapSlopPx) press.moved = true;
    const drag = press.drag;
    if (!drag || !press.moved) return;
    if (drag.plane) {
      aim(event);
      const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit) return;
      moveJoint(drag.key, hit.add(drag.offset));
    } else {
      moveJoint(drag.key, drag.start.clone().addScaledVector(drag.toCamera, (drag.y - event.clientY) * drag.perPx));
    }
    placeProxy();
    rebuild();
  });
  const release = (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { moved, key, drag } = press;
    press = null;
    orbit.enabled = true;
    if (drag && moved) onChange();
    // A click on the body (not an orbit) selects the part under it; a click
    // on empty space clears the selection.
    if (!key && !moved && event.type === "pointerup") select(pickBody(event));
  };
  dom.addEventListener("pointerup", release);
  dom.addEventListener("pointercancel", release);

  /// Camera move in progress: { from: {position, target}, to: {...}, start }.
  let transition = null;
  function moveCamera(position, target) {
    transition = {
      from: { position: camera.position.clone(), target: orbit.target.clone() },
      to: { position, target },
      start: performance.now(),
    };
  }
  function stepTransition() {
    if (!transition) return;
    const t = Math.min(1, (performance.now() - transition.start) / CONTROLS.transitionMs);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.from.position, transition.to.position, ease);
    orbit.target.lerpVectors(transition.from.target, transition.to.target, ease);
    if (t === 1) {
      transition = null;
      onChange();
    }
  }

  /// Fit the selected joint and what it carries in view (the whole figure
  /// with no selection, or when `all`), keeping the viewing direction.
  function frame(all = false) {
    const keys = selection && !all ? descendants(selection) : JOINT_KEYS;
    const { center, radius } = boundingSphere(
      keys.map((k) => positions[k].toArray()),
      CONTROLS.frameMinRadius,
    );
    const direction = camera.position.clone().sub(orbit.target).normalize().toArray();
    const distance = frameDistance(radius, camera.fov, CONTROLS.framePad);
    moveCamera(new THREE.Vector3(...viewPosition(center, direction, distance)), new THREE.Vector3(...center));
  }

  /// Look from a CONTROLS.views id or a direction ([x, y, z] toward the
  /// camera) at the same target and distance.
  function showView(view) {
    const direction = typeof view === "string" ? CONTROLS.views[view] : view;
    if (!direction) return;
    const target = orbit.target.toArray();
    const position = viewPosition(target, direction, camera.position.distanceTo(orbit.target), CONTROLS.verticalLean);
    moveCamera(new THREE.Vector3(...position), orbit.target.clone());
  }

  const gizmo = createAxisGizmo(host, showView);
  function render() {
    stepTransition();
    orbit.update();
    renderer.render(scene, camera);
    gizmo.update(camera);
  }
  let raf = null;
  function animate() {
    raf = requestAnimationFrame(animate);
    render();
  }
  function setActive(active) {
    if (active && raf === null) animate();
    if (!active && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }
  rebuild();
  setActive(true);
  orbit.addEventListener("end", onChange);
  function surfaceVertices(headOnly = false) {
    if (skin) return skin.surfaceVertices(headOnly);
    body.updateWorldMatrix(true, true);
    const meshes = headOnly ? [headMesh] : body.children;
    return meshes.flatMap((mesh) => {
      const a = mesh.geometry.getAttribute("position");
      return Array.from({ length: a.count }, (_, i) =>
        new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(mesh.matrixWorld),
      );
    });
  }
  function surfaceDepthRange() {
    camera.updateMatrixWorld();
    body.updateWorldMatrix(true, true);
    const distances = surfaceVertices().map((p) => -p.applyMatrix4(camera.matrixWorldInverse).z);
    const bounds = [
      {
        near: distances.reduce((a, b) => Math.min(a, b), Infinity),
        far: distances.reduce((a, b) => Math.max(a, b), -Infinity),
      },
    ];
    return depthRange(bounds, camera);
  }
  const coordinates = () => Object.fromEntries(JOINT_KEYS.map((key) => [key, positions[key].toArray()]));
  function state() {
    const saved = serialize3dState(
      coordinates(),
      {
        position: camera.position.toArray(),
        target: orbit.target.toArray(),
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
      },
      surfaceDepthRange(),
    );
    return { ...saved, model: skin ? "samba-r164" : "procedural-fallback" };
  }
  function project() {
    camera.updateMatrixWorld();
    return Object.fromEntries(
      JOINT_KEYS.map((key) => {
        const p = positions[key].clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = projectPoint(p, camera);
        return [key, projected && { x: projected.x * CANVAS.size, y: projected.y * CANVAS.size }];
      }),
    );
  }
  /// Render the same camera and geometry as linear view-space depth. Values
  /// reserve zero for background; surface bounds map to 255 and 1. No lighting or tone mapping.
  function surfacePNG() {
    const visible = handles.visible,
      transformVisible = transform.visible;
    handles.visible = false;
    transform.visible = false;
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    } finally {
      handles.visible = visible;
      transform.visible = transformVisible;
      render();
    }
  }
  function depthPNG() {
    const oldBackground = scene.background,
      oldOverride = scene.overrideMaterial;
    const bounds = surfaceDepthRange();
    const visible = handles.visible,
      transformVisible = transform.visible;
    const depthMaterial = new THREE.ShaderMaterial({
      uniforms: { near: { value: bounds.near }, far: { value: bounds.far } },
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying float distanceFromCamera;
        void main() {
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec4 v = modelViewMatrix * vec4(transformed, 1.0);
          distanceFromCamera = -v.z; gl_Position = projectionMatrix * v;
        }`,
      fragmentShader: `uniform float near; uniform float far; varying float distanceFromCamera; void main() { float d = (1.0 + 254.0 * clamp((far - distanceFromCamera) / (far - near), 0.0, 1.0)) / 255.0; gl_FragColor = vec4(vec3(d), 1.0); }`,
    });
    handles.visible = false;
    transform.visible = false;
    scene.background = new THREE.Color(0x000000);
    scene.overrideMaterial = depthMaterial;
    renderer.render(scene, camera);
    const result = renderer.domElement.toDataURL("image/png");
    scene.background = oldBackground;
    scene.overrideMaterial = oldOverride;
    handles.visible = visible;
    transform.visible = transformVisible;
    depthMaterial.dispose();
    render();
    return result;
  }
  function applyPreset(id) {
    if (!(id in POSE_PRESETS)) return;
    const preset = buildPresetPose(id, presetBase).joints;
    for (const key of JOINT_KEYS) {
      const p = preset[key];
      positions[key].set((p.x - CANVAS.size / 2) * FIGURE.scale, (CANVAS.size / 2 - p.y) * FIGURE.scale, 0);
    }
    selection = null;
    placeProxy();
    rebuild();
    onChange();
  }
  function reset() {
    camera.position.fromArray(c.position);
    orbit.target.fromArray(c.target);
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
    applyPreset("stand");
  }
  function headBounds() {
    camera.updateMatrixWorld();
    const points = surfaceVertices(true).map((point) => {
      const q = projectPoint(point.applyMatrix4(camera.matrixWorldInverse), camera);
      return q && { x: q.x * CANVAS.size, y: q.y * CANVAS.size };
    });
    return convexHull(points);
  }
  function view() {
    camera.updateMatrixWorld();
    const projected = project();
    const depth = {};
    const torsoLength = positions.neck.distanceTo(positions.pelvis);
    const torsoCenter = positions.neck.clone().add(positions.pelvis).multiplyScalar(0.5);
    // Body facing: across the shoulders x up the spine.
    const across = positions.shoulder_l.clone().sub(positions.shoulder_r);
    const normal = across.cross(positions.neck.clone().sub(positions.pelvis)).normalize();
    const toCamera = camera.position.clone().sub(torsoCenter).normalize();
    for (const part of ["wrist", "ankle"])
      for (const side of ["r", "l"]) {
        const key = `${part}_${side}`;
        const p = projected[key];
        const inFrame = p && p.x >= 0 && p.x <= CANVAS.size && p.y >= 0 && p.y <= CANVAS.size;
        depth[key] = inFrame
          ? bodyPlaneDepth(
              positions[key].toArray(),
              torsoCenter.toArray(),
              normal.toArray(),
              toCamera.toArray(),
              torsoLength,
            )
          : 0;
      }
    return {
      camera: cameraHeight(camera.position.toArray(), torsoCenter.toArray(), FIGURE.cameraPitchThreshold),
      depth,
    };
  }
  function setFov(value) {
    camera.fov = Math.max(c.minFov, Math.min(c.maxFov, Number(value)));
    camera.updateProjectionMatrix();
    onChange();
  }
  /// A TOOLS id; the selection stays, with the gizmo for the new tool.
  function setTool(id) {
    tool = id;
    placeProxy();
  }
  /// Gizmo axes: "world" or "local" (along the selected bone). Returns the new space.
  function toggleSpace() {
    transform.setSpace(transform.space === "world" ? "local" : "world");
    return transform.space;
  }
  function setFingerHandles(visible) {
    showFingers = visible;
    rebuild();
  }
  function semanticState() {
    return deriveSemantics(coordinates(), camera.position.toArray());
  }
  return {
    surfacePNG,
    alignment: () => skin?.alignment(positions) || [],
    modelError,
    semanticState,
    state,
    project,
    view,
    headBounds,
    depthPNG,
    reset,
    applyPreset,
    setTool,
    toggleSpace,
    frame,
    showView,
    setFov,
    setFingerHandles,
    setActive,
    dispose() {
      cancelAnimationFrame(raf);
      transform.dispose();
      orbit.dispose();
      skin?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
