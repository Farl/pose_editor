# 3D posing mode

Keep existing 2D behavior and saved state as the default. Add a lazy-loaded, procedural 3D mannequin with editable joints, camera orbit and field of view, simple presets, and independently versioned state. Project its joint positions through the same perspective camera into the existing OpenPose style renderer, and export a linear camera-space depth image with recorded per-pose mapping bounds. Reuse the existing provider and prompt pipeline; do not send a third image without established provider support. Do not infer hand gestures, contact or sole orientation from distance or a 2D projection.

The 3D state retains figure-side joint IDs. The guide omits clipped joints and their connected segments but does not hide joints occluded by geometry. The depth range is conservative and can include off-screen or occluded geometry. No third-party character asset or unlicensed code is distributed. The 2D and 3D poses remain independent.
