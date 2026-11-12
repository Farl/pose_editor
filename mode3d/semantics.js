import { surfaceFrame } from "./frame.js";
import { FIGURE } from "./config.js";

/// The authored surface's front is +Z in the right-side landmark frame and
/// -Z on the mirrored left side. Camera-facing means its outward normal,
/// not merely its position, points toward the camera within the configured cone.
export function facesCamera(
  origin,
  longPoint,
  sidePoint,
  camera,
  side,
  threshold = FIGURE.surfaceFacingCosine,
  normalSign = 1,
) {
  const frame = surfaceFrame(origin, longPoint, sidePoint);
  const direction = camera.map((v, i) => v - origin[i]);
  const length = Math.hypot(...direction);
  const long = longPoint.map((v, i) => v - origin[i]);
  const width = sidePoint.map((v, i) => v - origin[i]);
  const area = Math.hypot(
    long[1] * width[2] - long[2] * width[1],
    long[2] * width[0] - long[0] * width[2],
    long[0] * width[1] - long[1] * width[0],
  );
  if (!length || !area) return false;
  return (
    frame.z.reduce((sum, v, i) => sum + (v * direction[i]) / length, 0) * (side === "r" ? 1 : -1) * normalSign >=
    threshold
  );
}

export function semanticState(positions, camera) {
  const surfaceFacing = {};
  for (const side of ["r", "l"]) {
    for (const [part, long, width] of [
      ["wrist", "index1", "pinky1"],
      ["heel", "big_toe", "small_toe"],
    ]) {
      const key = `${part === "heel" ? "ankle" : part}_${side}`;
      surfaceFacing[key] = facesCamera(
        positions[key],
        positions[`${long}_${side}`],
        positions[`${width}_${side}`],
        camera,
        side,
        FIGURE.surfaceFacingCosine,
        FIGURE.surfaceNormalSign[part === "heel" ? "sole" : "palm"],
      );
    }
  }
  return {
    worldJoints: Object.fromEntries(Object.entries(positions).map(([key, p]) => [key, { x: p[0], y: p[1], z: p[2] }])),
    surfaceFacing,
  };
}
