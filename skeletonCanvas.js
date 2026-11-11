import { JOINT_KEYS, clonePose, isFingerJoint } from "./pose.js";
import { applyDrag, isPinnable, isGrabbable } from "./poseRig.js";
import { buildRenderList } from "./poseStyles.js";
import { createDefaultView, depthScale, segmentDepthScale, jointDepth, headCircle } from "./poseView.js";
import {
  CANVAS,
  PICKING,
  OVERLAY,
  HANDS,
  FREE_MOVE_MODIFIER,
  DEFAULT_DRAG_MODE,
  DEFAULT_POSE_STYLE,
  EXPORT_BACKGROUND,
  VIEW,
} from "./editorConfig.js";

/// `order` with `keys` moved to the end (= drawn on top), each group keeping
/// its relative order. Both are arrays of joint keys.
function bringToFront(order, keys) {
  const front = new Set(keys);
  return [...order.filter((k) => !front.has(k)), ...keys];
}

/// True when `order` lists every joint exactly once (e.g. a saved draw order).
export function isValidDrawOrder(order) {
  return (
    Array.isArray(order) &&
    order.length === JOINT_KEYS.length &&
    JOINT_KEYS.every((k) => order.includes(k))
  );
}

/// Pose canvas with Marionette-style posing (see poseRig.js for the solver).
///
/// Three stacked layers, all CANVAS.size square:
///   - grid      background and grid, on screen only
///   - `canvas`  the pose itself, drawn by the current style (poseStyles.js)
///               on a transparent background; toDataURL() puts it on
///               EXPORT_BACKGROUND for Download PNG and the AI pose guide
///   - overlay   interaction hints only (hover/drag rings, pin markers, handles
///               for joints the style doesn't draw), with pointer-events
///               disabled so input still reaches `canvas`
///
/// Stacking: the last joint you adjust, and every joint that drag moved, are
/// brought to the front (`drawOrder`, bottom to top). Bones follow their
/// top-most end, so a limb you just posed across the body draws over it, and
/// where joints overlap the pointer grabs the one on top. With a depth view
/// (poseView.js), hands and feet set toward the camera stack above everything
/// else and those set away below, whatever the drag order.
///
/// Gestures: drag a joint to pose (behaviour follows `dragMode`: IK, FK or Free); Alt-drag to move a single joint freely;
/// double-click / double-tap a hand or foot to pin it in place.
export class SkeletonCanvas {
  constructor(
    canvas,
    pose,
    {
      jointRadius = 8,
      minorAxisScale = 1,
      dragMode = DEFAULT_DRAG_MODE,
      styleId = DEFAULT_POSE_STYLE,
      handDetail = HANDS.defaultDetail,
      drawOrder = JOINT_KEYS,
      view = createDefaultView(),
      pins = [],
      onChange,
      onChangeEnd,
      onPinsChange,
      onDrawOrderChange,
    } = {}
  ) {
    this.canvas = canvas;
    this.canvas.width = this.canvas.height = CANVAS.size;
    this.ctx = canvas.getContext("2d");
    this.grid = this._createLayer("pose-grid", "beforebegin");
    this.overlay = this._createLayer("pose-overlay", "afterend");
    this.overlayCtx = this.overlay.getContext("2d");
    this._drawGrid();

    this.pose = pose;
    this.jointRadius = jointRadius;
    this.minorAxisScale = minorAxisScale;
    this.dragMode = dragMode;
    this.styleId = styleId;
    this.handDetail = handDetail;
    /// Depth and camera (poseView.js).
    this.view = view;
    /// Rig joints the current style draws (set by draw()).
    this.drawnJoints = new Set();
    this.pins = new Set(pins.filter(isPinnable));
    this.onChange = onChange;
    this.onChangeEnd = onChangeEnd;
    this.onPinsChange = onPinsChange;
    this.onDrawOrderChange = onDrawOrderChange;
    /// Joint keys bottom to top; see "Stacking" above.
    this.drawOrder = isValidDrawOrder(drawOrder) ? [...drawOrder] : [...JOINT_KEYS];

    /// Active drag: { key, pointerId, startPose, startOrder, moved, time }, or null.
    this.drag = null;
    this.hoverJoint = null;
    /// Last joint pressed; the target of keyboard pin toggling.
    this.selectedJoint = null;
    /// Last press that ended without dragging, for double-press pinning: { key, time }.
    this.lastTap = null;

    this._bindEvents();
    this.draw();
  }

  setPose(pose) {
    this.pose = pose;
    this.draw();
  }

  setJointRadius(r) {
    this.jointRadius = r;
    this.draw();
  }

  setMinorAxisScale(scale) {
    this.minorAxisScale = scale;
    this.draw();
  }

  /// "ik", "fk" or "free" (see DRAG_MODES); takes effect from the next drag.
  setDragMode(mode) {
    this.dragMode = mode;
  }

  /// Rendering style id (see POSE_STYLES).
  setStyle(styleId) {
    this.styleId = styleId;
    this.draw();
  }

  /// Depth and camera view (poseView.js).
  setView(view) {
    this.view = view;
    this.draw();
  }

  /// "simple" or "full" (see HANDS.details): which finger joints can be grabbed.
  setHandDetail(detail) {
    this.handDetail = detail;
    this.draw();
  }

  /// The pose as an image on EXPORT_BACKGROUND, without grid or overlay.
  toDataURL(type = "image/png") {
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = EXPORT_BACKGROUND;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out.toDataURL(type);
  }

  /// Back to the default stacking (JOINT_KEYS order).
  resetDrawOrder() {
    this._setDrawOrder([...JOINT_KEYS]);
    this.draw();
  }

  _setDrawOrder(order) {
    this.drawOrder = order;
    if (this.onDrawOrderChange) this.onDrawOrderChange([...order]);
  }

  getPins() {
    return [...this.pins];
  }

  /// Joint that keyboard actions apply to: hovered first, else last pressed.
  focusJoint() {
    return this.hoverJoint || this.selectedJoint;
  }

  /// Toggle the pin on `key`. Returns false if that joint can't be pinned.
  togglePin(key) {
    if (!key || !isPinnable(key)) return false;
    if (this.pins.has(key)) this.pins.delete(key);
    else this.pins.add(key);
    this._emitPins();
    return true;
  }

  clearPins() {
    if (!this.pins.size) return;
    this.pins.clear();
    this._emitPins();
  }

  _emitPins() {
    this.drawOverlay();
    if (this.onPinsChange) this.onPinsChange(this.getPins());
  }

  /// A canvas the size of the pose canvas, placed before or after it.
  _createLayer(className, position) {
    const layer = document.createElement("canvas");
    layer.className = className;
    layer.width = layer.height = CANVAS.size;
    layer.setAttribute("aria-hidden", "true");
    this.canvas.insertAdjacentElement(position, layer);
    return layer;
  }

  _drawGrid() {
    const ctx = this.grid.getContext("2d");
    const size = this.grid.width;
    ctx.fillStyle = CANVAS.background;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = CANVAS.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 0; v <= size; v += CANVAS.gridStep) {
      ctx.moveTo(v + 0.5, 0);
      ctx.lineTo(v + 0.5, size);
      ctx.moveTo(0, v + 0.5);
      ctx.lineTo(size, v + 0.5);
    }
    ctx.stroke();
  }

  _bindEvents() {
    const canvas = this.canvas;

    canvas.addEventListener("pointerdown", (e) => {
      const point = this._getCanvasPoint(e);
      const hit = this._hitTest(point, e.pointerType);
      if (!hit) return;
      e.preventDefault();
      this.selectedJoint = hit;

      if (this._isDoublePress(hit, e.timeStamp)) {
        this.lastTap = null;
        this.togglePin(hit);
        return;
      }

      canvas.setPointerCapture(e.pointerId);
      this.drag = {
        key: hit,
        pointerId: e.pointerId,
        startPose: clonePose(this.pose),
        startOrder: this.drawOrder,
        moved: false,
        time: e.timeStamp,
      };
      this.drawOverlay();
    });

    canvas.addEventListener("pointermove", (e) => {
      const point = this._getCanvasPoint(e);
      if (!this.drag || e.pointerId !== this.drag.pointerId) {
        this._setHover(this._hitTest(point, e.pointerType));
        return;
      }
      this.drag.moved = true;
      this.pose = applyDrag(this.drag.startPose, this.drag.key, point, {
        mode: this.dragMode,
        handDetail: this.handDetail,
        freeMove: e[FREE_MOVE_MODIFIER],
        pins: this.pins,
      });
      this.drawOrder = this._dragOrder();
      if (this.onChange) this.onChange(this.pose);
      this.draw();
    });

    const endDrag = (e) => {
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      const { key, moved, time } = this.drag;
      this.drag = null;
      if (moved) this._setDrawOrder(this.drawOrder);
      this.lastTap = moved ? null : { key, time };
      // Redraw so the drag highlight doesn't linger after release.
      this.drawOverlay();
      if (moved && this.onChangeEnd) this.onChangeEnd(this.pose);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => this._setHover(null));
  }

  /// Drag-start order with the joints this drag moved brought to the front,
  /// the grabbed joint top-most.
  _dragOrder() {
    const { key, startPose, startOrder } = this.drag;
    const moved = startOrder.filter((k) => {
      const a = startPose.joints[k];
      const b = this.pose.joints[k];
      return k !== key && a && b && (a.x !== b.x || a.y !== b.y);
    });
    return bringToFront(startOrder, [...moved, key]);
  }

  /// Second tap (press without drag) on the same pinnable joint in quick succession.
  /// Non-pinnable joints never count, so re-grabbing them quickly still drags.
  _isDoublePress(key, time) {
    const last = this.lastTap;
    return isPinnable(key) && !!last && last.key === key && time - last.time <= PICKING.doubleTapMs;
  }

  _setHover(key) {
    if (key === this.hoverJoint) return;
    this.hoverJoint = key;
    this.canvas.style.cursor = key ? "grab" : "";
    this.drawOverlay();
  }

  /// Canvas units per CSS pixel (the canvas is CSS-scaled to fit the layout).
  _canvasScale() {
    const rect = this.canvas.getBoundingClientRect();
    return rect.width ? this.canvas.width / rect.width : 1;
  }

  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this._canvasScale();
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  /// Joint to grab at `point`: if the pointer is over joint dots, the top-most
  /// one (as drawn); otherwise the nearest within the pick radius, or null.
  /// Only joints grabbable at the current hand detail count.
  _hitTest(point, pointerType) {
    const radiusPx = PICKING.radiusPx[pointerType] ?? PICKING.radiusPx.mouse;
    const radius = Math.max(radiusPx * this._canvasScale(), this.jointRadius);
    let best = null;
    let bestDist = radius;
    const order = this._layerOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const key = order[i];
      const j = this.pose.joints[key];
      if (!j || !isGrabbable(key, this.handDetail)) continue;
      const d = Math.hypot(j.x - point.x, j.y - point.y);
      if (d <= this._jointSize(key)) return key;
      if (d < bestDist) {
        best = key;
        bestDist = d;
      }
    }
    return best;
  }

  /// On-screen radius of a joint: finger joints are drawn smaller.
  _jointSize(key) {
    return isFingerJoint(key) ? this.jointRadius * HANDS.pointScale : this.jointRadius;
  }

  /// drawOrder with depth applied: joints nearer the camera on top (stable,
  /// so at equal depth the drag order still decides).
  _layerOrder() {
    return this.drawOrder
      .map((key, i) => [key, i])
      .sort(([a, i], [b, j]) => jointDepth(this.view, a) - jointDepth(this.view, b) || i - j)
      .map(([key]) => key);
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawHead(ctx);

    // Segments and points from the style, stacked bottom to top in drawOrder.
    // Each segment is drawn in the layer of its top-most end, followed by its
    // end points so joints stay on top of the segments they connect.
    const { segments, points } = buildRenderList(this.styleId, this.jointRadius, this.minorAxisScale);
    const pointsByKey = {};
    for (const p of points) (pointsByKey[p.key] ||= []).push(p);
    /// Rig joints this style draws; the rest get overlay handles.
    this.drawnJoints = new Set(Object.keys(pointsByKey));

    const order = this._layerOrder();
    const rank = Object.fromEntries(order.map((k, i) => [k, i]));
    const segmentsByTop = {};
    for (const seg of segments) {
      const top = rank[seg.a] > rank[seg.b] ? seg.a : seg.b;
      (segmentsByTop[top] ||= []).push(seg);
    }
    const drawPoints = (key) => (pointsByKey[key] || []).forEach((p) => this._drawPoint(ctx, p));
    for (const key of order) {
      const segs = segmentsByTop[key] || [];
      for (const seg of segs) this._drawSegment(ctx, seg);
      for (const seg of segs) drawPoints(seg.a === key ? seg.b : seg.a);
      drawPoints(key);
    }

    this.drawOverlay();
  }

  /// A style segment: a filled ellipse (OpenPose "stick", `width` is its
  /// half-thickness) or a round-capped line (`width` is its thickness).
  /// Widths and radii scale with depth (depthScale): 1 in the default view.
  _drawSegment(ctx, { a, b, color, shape, width: baseWidth }) {
    const ja = this.pose.joints[a];
    const jb = this.pose.joints[b];
    if (!ja || !jb) return;
    const width = baseWidth * segmentDepthScale(this.view, a, b);
    ctx.save();
    if (shape === "line") {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ja.x, ja.y);
      ctx.lineTo(jb.x, jb.y);
      ctx.stroke();
    } else {
      const dx = jb.x - ja.x;
      const dy = jb.y - ja.y;
      ctx.fillStyle = color;
      ctx.translate((ja.x + jb.x) / 2, (ja.y + jb.y) / 2);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.hypot(dx, dy) / 2, width, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPoint(ctx, { key, color, radius }) {
    const j = this.pose.joints[key];
    if (!j) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(j.x, j.y, radius * depthScale(this.view, key), 0, Math.PI * 2);
    ctx.fill();
  }

  /// Head outline for a big-headed view (headCircle), under the skeleton.
  _drawHead(ctx) {
    const head = headCircle(this.pose.joints, this.view);
    if (!head) return;
    ctx.save();
    ctx.strokeStyle = VIEW.headColor;
    ctx.lineWidth = this.jointRadius * VIEW.headLineToJoint;
    ctx.beginPath();
    ctx.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.save();

    // Handles for grabbable joints the style doesn't draw (e.g. the waist).
    ctx.lineWidth = OVERLAY.handleWidth;
    for (const key of JOINT_KEYS) {
      if (this.drawnJoints.has(key) || !isGrabbable(key, this.handDetail)) continue;
      this._drawRing(ctx, key, OVERLAY.handleColor, 0);
    }

    ctx.lineWidth = OVERLAY.ringWidth;
    for (const key of this.pins) this._drawPin(ctx, this.pose.joints[key]);

    const activeKey = this.drag && this.drag.key;
    if (this.hoverJoint && this.hoverJoint !== activeKey) {
      this._drawRing(ctx, this.hoverJoint, OVERLAY.hoverColor);
    }
    if (activeKey) this._drawRing(ctx, activeKey, OVERLAY.activeColor);
    ctx.restore();
  }

  /// Circle around joint `key`, `gap` outside its drawn radius.
  _drawRing(ctx, key, color, gap = OVERLAY.ringGap) {
    const j = this.pose.joints[key];
    if (!j) return;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(j.x, j.y, this._jointSize(key) + gap, 0, Math.PI * 2);
    ctx.stroke();
  }

  /// Pin marker: a square around the joint plus a push-pin needle above it,
  /// drawn with canvas primitives.
  _drawPin(ctx, j) {
    if (!j) return;
    const half = this.jointRadius + OVERLAY.pinBoxPad;
    const top = j.y - half;
    const headY = top - OVERLAY.pinNeedleLength;
    ctx.strokeStyle = ctx.fillStyle = OVERLAY.pinColor;
    ctx.strokeRect(j.x - half, top, half * 2, half * 2);
    ctx.beginPath();
    ctx.moveTo(j.x, top);
    ctx.lineTo(j.x, headY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(j.x, headY, OVERLAY.pinHeadRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
