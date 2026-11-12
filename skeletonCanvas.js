import { JOINT_KEYS, clonePose, isFingerJoint } from "./pose.js";
import { applyDrag, isPinnable, isGrabbable } from "./poseRig.js";
import { buildRenderList } from "./poseStyles.js";
import {
  createDefaultView,
  depthScale,
  segmentDepthScale,
  jointDepth,
  derivedDepth,
  depthKey,
  setJointDepth,
  headCircle,
  DEPTH_JOINTS,
} from "./poseView.js";
import {
  CANVAS,
  PICKING,
  OVERLAY,
  HANDS,
  FREE_MOVE_MODIFIER,
  DEFAULT_TOOL,
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

/// Cursor over a joint, per tool (TOOLS).
const CURSORS = { default: "grab", select: "pointer", depth: "ns-resize" };

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
/// Three stacked layers, all CANVAS.size canvas units square:
///   - grid      background and grid, on screen only
///   - `canvas`  the pose itself, drawn by the current style (poseStyles.js)
///               on a transparent background; toDataURL() puts it on
///               EXPORT_BACKGROUND for Download PNG and the AI pose guide
///   - overlay   interaction hints only (hover/drag rings, pin markers, handles
///               for joints the style doesn't draw), with pointer-events
///               disabled so input still reaches `canvas`
/// The pose and overlay layers are rendered `renderScale` backing pixels per
/// canvas unit (setRenderScale), so they stay sharp when zoomed in on screen
/// (canvasViewport.js); the grid and every export stay at CANVAS.size.
///
/// Stacking: the last joint you adjust, and every joint that drag moved, are
/// brought to the front (`drawOrder`, bottom to top). Bones follow their
/// top-most end, so a limb you just posed across the body draws over it, and
/// where joints overlap the pointer grabs the one on top. With a depth view
/// (poseView.js), hands and feet set toward the camera stack above everything
/// else and those set away below, whatever the drag order.
///
/// Gestures follow the `tool` (TOOLS): press a joint to select it (every
/// tool), drag it to pose (IK, FK or Free) or to set its depth (Depth: up is
/// toward the camera); Alt-drag moves a single joint freely; double-click /
/// double-tap a hand or foot to pin it in place.
export class SkeletonCanvas {
  constructor(
    canvas,
    pose,
    {
      jointRadius = 8,
      minorAxisScale = 1,
      tool = DEFAULT_TOOL,
      styleId = DEFAULT_POSE_STYLE,
      handDetail = HANDS.defaultDetail,
      drawOrder = JOINT_KEYS,
      view = createDefaultView(),
      pins = [],
      onChange,
      onChangeEnd,
      onPinsChange,
      onDrawOrderChange,
      onViewChange,
      onViewChangeEnd,
    } = {}
  ) {
    this.canvas = canvas;
    this.canvas.width = this.canvas.height = CANVAS.size;
    this.ctx = canvas.getContext("2d");
    /// Backing pixels per canvas unit of the pose and overlay layers.
    this.renderScale = 1;
    this.grid = this._createLayer("pose-grid", "beforebegin");
    this.overlay = this._createLayer("pose-overlay", "afterend");
    this.overlayCtx = this.overlay.getContext("2d");
    this._drawGrid();

    this.pose = pose;
    this.jointRadius = jointRadius;
    this.minorAxisScale = minorAxisScale;
    this.tool = tool;
    this.styleId = styleId;
    this.handDetail = handDetail;
    /// Depth and camera (poseView.js).
    this.view = view;
    /// Head outline traced from a 3D model ([{x, y}, ...]), or null for the
    /// circle from the view (setHeadOutline).
    this.headOutline = null;
    /// Rig joints the current style draws (set by draw()).
    this.drawnJoints = new Set();
    this.pins = new Set(pins.filter(isPinnable));
    this.onChange = onChange;
    this.onChangeEnd = onChangeEnd;
    this.onPinsChange = onPinsChange;
    this.onDrawOrderChange = onDrawOrderChange;
    /// Depth tool drags: the view while dragging, and once released.
    this.onViewChange = onViewChange;
    this.onViewChangeEnd = onViewChangeEnd;
    /// Joint keys bottom to top; see "Stacking" above.
    this.drawOrder = isValidDrawOrder(drawOrder) ? [...drawOrder] : [...JOINT_KEYS];

    /// Active drag, or null:
    ///   { key, pointerId, startPose, startOrder, moved, time }  posing
    ///   + { startView, startY, startDepth }                    Depth tool
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

  /// A TOOLS id; takes effect from the next press.
  setTool(tool) {
    this.tool = tool;
    this._setHover(this.hoverJoint, true);
    this.drawOverlay();
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

  /// Head outline as a polygon in canvas units (3D mode traces it from the
  /// model's head), drawn in place of the view's circle; null to go back.
  setHeadOutline(points) {
    this.headOutline = points && points.length >= 3 ? points : null;
    this.draw();
  }

  /// "simple" or "full" (see HANDS.details): which finger joints can be grabbed.
  setHandDetail(detail) {
    this.handDetail = detail;
    this.draw();
  }

  /// Backing pixels per canvas unit for the pose and overlay layers (an
  /// integer >= 1). Changes only how sharp they look on screen.
  setRenderScale(scale) {
    if (scale !== this.renderScale) {
      this.renderScale = scale;
      this.canvas.width = this.canvas.height = this.overlay.width = this.overlay.height = CANVAS.size * scale;
      this.draw();
    } else {
      // The on-screen size changed: overlay handles keep a minimum screen size.
      this.drawOverlay();
    }
  }

  /// The pose as an image on EXPORT_BACKGROUND, without grid or overlay:
  /// always CANVAS.size square, rendered at one pixel per canvas unit
  /// whatever the on-screen zoom.
  toDataURL(type = "image/png") {
    const layer = this._exportCanvas();
    this._renderPose(layer.getContext("2d"));
    const out = this._exportCanvas();
    const ctx = out.getContext("2d");
    ctx.fillStyle = EXPORT_BACKGROUND;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(layer, 0, 0);
    return out.toDataURL(type);
  }

  _exportCanvas() {
    const c = document.createElement("canvas");
    c.width = c.height = CANVAS.size;
    return c;
  }

  /// Abandon the current drag, putting the pose (or depth) back as it was
  /// (no undo step). Used when a second finger turns the touch into a pinch.
  cancelDrag() {
    if (!this.drag) return;
    const { startPose, startOrder, startView } = this.drag;
    this.drag = null;
    if (startView) {
      this.view = startView;
      if (this.onViewChange) this.onViewChange(this.view);
    } else {
      this.pose = startPose;
      this.drawOrder = startOrder;
      if (this.onChange) this.onChange(this.pose);
    }
    this.draw();
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
      if (this.tool === "select") {
        this.lastTap = { key: hit, time: e.timeStamp };
        this.drawOverlay();
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
      if (this.tool === "depth") {
        const key = depthKey(hit);
        Object.assign(this.drag, { key, startView: this.view, startY: e.clientY, startDepth: jointDepth(this.view, key) });
      }
      this.drawOverlay();
    });

    canvas.addEventListener("pointermove", (e) => {
      const point = this._getCanvasPoint(e);
      if (!this.drag || e.pointerId !== this.drag.pointerId) {
        this._setHover(this._hitTest(point, e.pointerType));
        return;
      }
      this.drag.moved = true;
      if (this.drag.startView) {
        this._dragDepth(e.clientY);
        return;
      }
      this.pose = applyDrag(this.drag.startPose, this.drag.key, point, {
        mode: this.tool,
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
      const { key, moved, time, startView } = this.drag;
      this.drag = null;
      this.lastTap = moved ? null : { key, time };
      // Redraw so the drag highlight doesn't linger after release.
      this.drawOverlay();
      if (!moved) return;
      if (startView) {
        if (this.onViewChangeEnd) this.onViewChangeEnd(this.view);
      } else {
        this._setDrawOrder(this.drawOrder);
        if (this.onChangeEnd) this.onChangeEnd(this.pose);
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => this._setHover(null));
  }

  /// Depth tool: the dragged joint's depth from how far the pointer moved up
  /// (toward the camera) or down since the press, rounded to a step and
  /// snapped to the depth the joint would have on its own (derivedDepth),
  /// where it gives up its own value.
  _dragDepth(clientY) {
    const { key, startView, startY, startDepth } = this.drag;
    const { pxPerUnit, step, snap } = VIEW.depthDrag;
    const raw = startDepth + (startY - clientY) / pxPerUnit;
    const natural = derivedDepth(startView, key);
    // Divide by the whole steps per unit (not multiply by step) so 7 steps of 0.05 is exactly 0.35.
    const value = Math.abs(raw - natural) < snap ? natural : Math.round(raw / step) / Math.round(1 / step);
    this.view = setJointDepth(startView, key, Math.min(VIEW.depth.max, Math.max(VIEW.depth.min, value)));
    if (this.onViewChange) this.onViewChange(this.view);
    this.draw();
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

  /// Hovered joint (or null) and the cursor for it under the current tool;
  /// `force` updates the cursor even if the joint didn't change.
  _setHover(key, force = false) {
    if (key === this.hoverJoint && !force) return;
    this.hoverJoint = key;
    this.canvas.style.cursor = key ? CURSORS[this.tool] || CURSORS.default : "";
    this.drawOverlay();
  }

  /// Canvas units per CSS pixel (the canvas is CSS-scaled to fit the layout
  /// and by the on-screen zoom).
  _canvasScale() {
    const rect = this.canvas.getBoundingClientRect();
    return rect.width ? CANVAS.size / rect.width : 1;
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
    this._renderPose(this.ctx, this.renderScale);
    this.drawOverlay();
  }

  /// Clear `ctx` and draw the pose on it, `scale` backing pixels per canvas unit.
  _renderPose(ctx, scale = 1) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, CANVAS.size, CANVAS.size);
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

  /// Head outline under the skeleton: the traced polygon (setHeadOutline),
  /// else the circle for a big-headed view (headCircle).
  _drawHead(ctx) {
    const head = this.headOutline ? null : headCircle(this.pose.joints, this.view);
    if (!this.headOutline && !head) return;
    ctx.save();
    ctx.strokeStyle = VIEW.headColor;
    ctx.lineWidth = this.jointRadius * VIEW.headLineToJoint;
    ctx.beginPath();
    if (head) {
      ctx.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
    } else {
      const [first, ...rest] = this.headOutline;
      ctx.moveTo(first.x, first.y);
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    ctx.clearRect(0, 0, CANVAS.size, CANVAS.size);
    ctx.save();

    // Handles for grabbable joints the style doesn't draw (e.g. the waist),
    // never smaller on screen than OVERLAY.handleMinPx.
    ctx.lineWidth = OVERLAY.handleWidth;
    const minHandle = OVERLAY.handleMinPx * this._canvasScale();
    for (const key of JOINT_KEYS) {
      if (this.drawnJoints.has(key) || !isGrabbable(key, this.handDetail)) continue;
      this._drawRing(ctx, key, OVERLAY.handleColor, Math.max(0, minHandle - this._jointSize(key)));
    }

    ctx.lineWidth = OVERLAY.ringWidth;
    if (this.tool === "depth") this._drawDepthRings(ctx);
    for (const key of this.pins) this._drawPin(ctx, this.pose.joints[key]);
    if (this.selectedJoint) this._drawRing(ctx, this.selectedJoint, OVERLAY.selectColor);

    const activeKey = this.drag && this.drag.key;
    if (this.hoverJoint && this.hoverJoint !== activeKey) {
      this._drawRing(ctx, this.hoverJoint, OVERLAY.hoverColor);
    }
    if (activeKey) this._drawRing(ctx, activeKey, OVERLAY.activeColor);
    if (this.tool === "depth") this._drawDepthLabel(ctx, activeKey || this.hoverJoint || this.selectedJoint);
    ctx.restore();
  }

  /// Depth tool: a ring on every body joint off the body plane, tinted
  /// toward OVERLAY.depthNearColor or depthFarColor by its depth.
  _drawDepthRings(ctx) {
    ctx.save();
    ctx.lineWidth = OVERLAY.depthRingWidth;
    for (const key of DEPTH_JOINTS) {
      const d = jointDepth(this.view, key);
      if (!d) continue;
      const [r, g, b] = d > 0 ? OVERLAY.depthNearColor : OVERLAY.depthFarColor;
      const alpha = OVERLAY.depthMinAlpha + (1 - OVERLAY.depthMinAlpha) * Math.min(1, Math.abs(d));
      this._drawRing(ctx, key, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    ctx.restore();
  }

  /// Depth of joint `key` (a finger shows its hand's), signed ("+0.40"), beside it.
  _drawDepthLabel(ctx, key) {
    if (!key) return;
    key = depthKey(key);
    const j = this.pose.joints[key];
    if (!j) return;
    const { sizePx, weight, family, color, gapPx } = OVERLAY.depthLabel;
    const scale = this._canvasScale();
    const d = jointDepth(this.view, key);
    ctx.font = `${weight} ${sizePx * scale}px ${family}`;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(`${d > 0 ? "+" : ""}${d.toFixed(2)}`, j.x + this._jointSize(key) + gapPx * scale, j.y);
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
