import { normalizeView } from '../poseView.js';
import { VIEW } from '../editorConfig.js';

/// Reuse the editor's guide style; an overhead 3D head outline is projected
/// from the mannequin's own surface, behind the colored OpenPose points.
export function render3dGuide(scene, guide, jointRadius, linkScale) {
  const pose = { joints: scene.project() }, view = normalizeView(scene.view());
  guide.setJointRadius(jointRadius); guide.setMinorAxisScale(linkScale);
  guide.setView(view); guide.setPose(pose);
  const head = view.camera === 'high' && scene.headBounds();
  if (head && head.length >= 3) {
    const ctx = guide.canvas.getContext('2d'); ctx.save();
    ctx.globalCompositeOperation = 'destination-over'; ctx.strokeStyle = VIEW.headColor;
    ctx.lineWidth = jointRadius * VIEW.headLineToJoint; ctx.beginPath();
    ctx.moveTo(head[0].x, head[0].y); for (const point of head.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  return { pose, view, image: guide.toDataURL() };
}
