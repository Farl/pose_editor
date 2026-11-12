/// Camera framing math for the 3D view, on plain [x, y, z] arrays (no Three.js).

const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (v) => Math.hypot(...v);

/// Centre and radius of a set of points: the centre of their bounding box and
/// the distance from it to the furthest point, at least `minRadius`.
export function boundingSphere(points, minRadius = 0) {
  const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  const center = lo.map((v, i) => (v + hi[i]) / 2);
  const radius = Math.max(minRadius, ...points.map((p) => norm(sub(p, center))));
  return { center, radius };
}

/// Camera distance at which a sphere of `radius` fits a square view with
/// vertical field of view `fovDeg`, times `pad`.
export function frameDistance(radius, fovDeg, pad = 1) {
  return (radius * pad) / Math.sin((fovDeg * Math.PI) / 360);
}

/// Camera position looking at `target` from `direction` (toward the camera),
/// `distance` away. A straight-up or straight-down direction leans `lean`
/// toward +Z so the orbit controls keep a defined "up".
export function viewPosition(target, direction, distance, lean = 0) {
  const d = Math.abs(direction[0]) + Math.abs(direction[2]) < lean ? [direction[0], direction[1], lean] : direction;
  const n = norm(d);
  return target.map((v, i) => v + (d[i] / n) * distance);
}
