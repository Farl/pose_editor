# 3D posing

The editor defaults to 2D. Three.js 0.164.1 and Samba Dancing are loaded only when 3D is selected; the model URL is pinned to the Three.js r164 repository in `config.js`. The FBX is downloaded at runtime and is not included in this repository. Load failures are reported in the UI; only then is the clearly labelled procedural fallback used. There is no model-import or proportion-adjustment UI.

The tool shelf and keys are shared with 2D (`TOOLS` in `editorConfig.js`). In 3D:
- **Q (select):** click a handle, or the body (the nearest handle wins), to select a joint.
- **W (move):** drag a handle across the screen, or use the gizmo axes.
  - Hands and feet use IK.
  - Elbows and knees pick their bend side.
  - The hips carry the body.
  - Any other joint swings its bone.
- **E (rotate):** the gizmo turns the selected joint's children.
- **R (depth):** drag a handle up or down to move it toward or away from the camera.
- **Free (G):** 2D only.

Handles are picked on screen within the same radius as 2D (`PICKING.radiusPx`), so they can be tapped on a phone.

The camera:
- Drag empty space (or Alt + drag anywhere) to orbit.
- Right- or middle-drag, or two fingers, to pan.
- Wheel or pinch to zoom.
- **F** frames the selected joint and what it carries, and **0** frames the figure.
- **1 / 2 / 3** show the front, side and top views.
- Pressing an end of the corner axis gizmo looks from that side.
- **X** switches the gizmo between world axes and axes along the selected bone.

Tunables are in `CONTROLS` in `config.js`. Preset, finger handles, reset and exports live in the initially collapsed 3D panel. 3D state is separate from 2D state/history. Mode selection itself is not persisted and 3D does not have undo.

`rigMap.js` maps actual Mixamo names to the existing 66-joint rig. Shoulders use Arm bones, not collar Shoulder bones. Eye and finger points use actual bones; the nose, ears, heels and outer toes include derived landmarks. The saved state records their world positions. Samba's same-name leaf skin-cluster bones inherit their parents; they are not animated a second time. The head bone is a neck-side pivot rather than the nose, so its bind offset is preserved. Palm and foot retargeting uses two-axis frames to retain roll, not just limb direction.

The BODY_25 + hands guide projects these world points through the same square perspective camera as the depth export. Near/far-clipped points and connected segments are omitted, while surface-occluded points remain. Finger states and contact use 3D distances; image-side labels use projected x. Strong camera/depth wording is shared with 2D. Sole and palm orientation uses the configured normal/camera dot threshold: heel/big-toe/small-toe for the sole, wrist/index/pinky for the palm. Distance alone cannot establish facing.

Depth is linear camera-space Z: near bound=255, far bound=1, background=0, antialiasing at boundaries. Bounds are computed from posed, skinned surface vertices, clipped to camera planes. They can include off-screen/occluded geometry; export state with depth to retain the camera and mapping range. Depth is a separate export and is not sent to the image provider. The high-angle head outline comes from projected mesh vertices weighted to head/eye bones.
