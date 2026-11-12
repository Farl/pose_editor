/// Two-bone geometric IK in three dimensions. The existing bend plane chooses
/// the elbow/knee side; targets beyond reach clamp without lengthening bones.
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, n) => a.map((v) => v * n);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const length = (a) => Math.hypot(...a);
const unit = (a) => mul(a, 1 / length(a));
export function solveTwoBone(root, mid, end, target) {
  const a = length(sub(mid, root)),
    b = length(sub(end, mid));
  const delta = sub(target, root),
    rawDistance = length(delta);
  const fallback = sub(end, root);
  const direction = rawDistance > 1e-9 ? unit(delta) : length(fallback) > 1e-9 ? unit(fallback) : [1, 0, 0];
  const distance = Math.max(Math.abs(a - b) + 1e-9, Math.min(a + b, rawDistance));
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  let perpendicular = sub(sub(mid, root), mul(direction, dot(sub(mid, root), direction)));
  if (length(perpendicular) < 1e-9) {
    const axis = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    perpendicular = sub(axis, mul(direction, dot(axis, direction)));
  }
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  return {
    mid: add(add(root, mul(direction, along)), mul(unit(perpendicular), height)),
    end: add(root, mul(direction, distance)),
  };
}
