import { normalizeView } from "../poseView.js";

/// Reuse the editor's guide style. From a high camera the head is traced from
/// the model's own surface and drawn under the skeleton, like the 2D circle.
export function render3dGuide(scene, guide, jointRadius, linkScale) {
  const pose = { joints: scene.project() };
  const view = normalizeView(scene.view());
  guide.setJointRadius(jointRadius);
  guide.setMinorAxisScale(linkScale);
  guide.setView(view);
  guide.setPose(pose);
  guide.setHeadOutline(view.camera === "high" ? scene.headBounds() : null);
  return { pose, view, image: guide.toDataURL() };
}
