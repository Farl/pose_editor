/// The procedural mannequin is deliberately separate from external model assets.
export const FIGURE = Object.freeze({
  scale: 0.005,
  cameraPitchThreshold: 0.3,
  head: [0.16, 0.22, 0.15],
  torso: [0.25, 0.38, 0.13],
  pelvis: [0.21, 0.14, 0.13],
  limbRadius: 0.07,
  fingerRadius: 0.012,
  fingerHandleRadius: 0.024,
  palm: [0.07, 0.10, 0.025],
  foot: [0.12, 0.18, 0.05],
  footRigScale: 2,
  jointRadius: 0.045,
  handleRadius: 0.065,
  camera: { fov: 38, minFov: 20, maxFov: 100, fovStep: 1, near: 0.1, far: 20, position: [0, 1, 5], target: [0, 0, 0] },
});
