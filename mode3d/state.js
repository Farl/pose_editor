/// Independent versioned 3D state. Pixel values use the recorded depthRange;
/// camera clipping planes remain separate from that per-pose mapping.
export function serialize3dState(positions, camera, depthRange) {
  return {
    version: 1,
    model: "samba-r164",
    positions: Object.fromEntries(Object.entries(positions).map(([key, point]) => [key, [...point]])),
    camera: { ...camera, position: [...camera.position], target: [...camera.target] },
    depthRange: { ...depthRange },
    depthEncoding: "linear-camera-z-near-white-background-black",
  };
}
