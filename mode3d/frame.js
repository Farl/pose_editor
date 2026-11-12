/// Orthonormal surface frame from a long axis and a second, non-collinear
/// landmark. The second axis preserves palm/sole roll around the long axis.
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = (v) => Math.hypot(...v);
const unit = (v) => v.map((n) => n / norm(v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function surfaceFrame(origin, longPoint, sidePoint) {
  const long = sub(longPoint, origin);
  const y = norm(long) > 1e-9 ? unit(long) : [0, 1, 0];
  let side = sub(sidePoint, origin);
  side = side.map((v, i) => v - dot(side, y) * y[i]);
  if (norm(side) < 1e-9) {
    const axis = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    side = axis.map((v, i) => v - dot(axis, y) * y[i]);
  }
  const x = unit(side);
  return { x, y, z: unit(cross(x, y)) };
}
