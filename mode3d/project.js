/// Camera-space point projection. Camera looks along -Z; coordinates are
/// normalized image coordinates with (0,0) at the upper left. Clipped points
/// have no projection, preventing mirrored joints behind the camera.
export function projectPoint({ x, y, z }, { fov, aspect, near, far }) {
  const distance = -z;
  if (distance < near || distance > far) return null;
  const scale = Math.tan((fov * Math.PI) / 360);
  return { x: (x / (distance * scale * aspect) + 1) / 2, y: (1 - y / (distance * scale)) / 2 };
}

/// Linear camera-space depth: near=255, far=1, background/outside=0.
export function linearDepth(distance, { near, far }) {
  if (distance < near || distance > far) return 0;
  return Math.round(1 + (254 * (far - distance)) / (far - near));
}

/// Height relative to a subject point, using a dimensionless rise/run threshold.
export function cameraHeight(position, target, threshold) {
  const rise = position[1] - target[1];
  const run = Math.hypot(position[0] - target[0], position[2] - target[2]);
  return rise > threshold * run ? "high" : rise < -threshold * run ? "low" : "eye";
}

/// How far a hand or foot sticks out of the body's plane toward the camera,
/// in torso lengths: the 3D counterpart of the 2D depth slider. Only the part
/// of the offset along the body's facing direction counts, weighted by how
/// squarely the body faces the camera, so camera pitch alone (feet further
/// away when looking down) or a side view adds no depth. Arrays are [x, y, z].
///   point, center  the hand / foot and the torso centre
///   normal         unit vector the body faces (either way; it is re-oriented)
///   toCamera       unit vector from the torso centre to the camera
export function bodyPlaneDepth(point, center, normal, toCamera, torsoLength) {
  if (!(torsoLength > 0)) return 0;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const facing = dot(normal, toCamera);
  const out = dot(
    point.map((v, i) => v - center[i]),
    normal,
  );
  return Math.max(-1, Math.min(1, (out * facing) / torsoLength));
}

/// Conservative visible surface bounds, clipped to the camera's near/far planes.
export function depthRange(bounds, camera) {
  const visible = bounds.filter((b) => b.far >= camera.near && b.near <= camera.far);
  if (!visible.length) return { near: camera.near, far: camera.far };
  const near = Math.max(camera.near, Math.min(...visible.map((b) => b.near)));
  const far = Math.min(camera.far, Math.max(...visible.map((b) => b.far)));
  return far > near ? { near, far } : { near: camera.near, far: camera.far };
}

/// Bounding ellipse from projected surface-axis extremities. Omit the outline
/// when any extremity is clipped rather than inventing a partial shape.
export function outlineBounds(points) {
  if (!points.length || points.some((p) => !p)) return null;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  return { x: (left + right) / 2, y: (top + bottom) / 2, rx: (right - left) / 2, ry: (bottom - top) / 2 };
}

/// Convex outline of projected vertices. A perspective-projected convex mesh
/// has its silhouette within this hull while every vertex is in front of camera.
export function convexHull(points) {
  if (points.some((p) => !p)) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length > 1 && turn(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted),
    upper = half([...sorted].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
