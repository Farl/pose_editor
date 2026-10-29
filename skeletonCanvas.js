import { JOINT_KEYS, BONES, clonePose } from "./pose.js";
import { applyDrag, isPinnable } from "./poseRig.js";
import { CANVAS, PICKING, OVERLAY, FREE_MOVE_MODIFIER, DEFAULT_DRAG_MODE } from "./editorConfig.js";

const OPENPOSE_RGB = [
  [255, 0, 0],
  [255, 85, 0],
  [255, 170, 0],
  [255, 255, 0],
  [170, 255, 0],
  [85, 255, 0],
  [0, 255, 0],
  [0, 255, 85],
  [0, 255, 170],
  [0, 255, 255],
  [0, 170, 255],
  [0, 85, 255],
  [0, 0, 255],
  [85, 0, 255],
  [170, 0, 255],
  [255, 0, 255],
  [255, 0, 170],
  [255, 0, 85],
];

const JOINT_COLOR_BY_KEY = JOINT_KEYS.reduce((acc, key, index) => {
  const rgb = OPENPOSE_RGB[index % OPENPOSE_RGB.length];
  acc[key] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return acc;
}, {});

function colorWithAlpha(color, alpha) {
  if (!color.startsWith("rgb(")) return color;
  const values = color.slice(4, -1);
  return `rgba(${values}, ${alpha})`;
}

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
/// Two stacked layers:
///   - `canvas`  the pose image itself (grid, bones, joints). This is what
///               Download PNG and the AI pose guide capture.
///   - overlay   interaction hints only (hover/drag rings, pin markers), with
///               pointer-events disabled so input still reaches `canvas`.
///
/// Stacking: the last joint you adjust, and every joint that drag moved, are
/// brought to the front (`drawOrder`, bottom to top). Bones follow their
/// top-most end, so a limb you just posed across the body draws over it, and
/// where joints overlap the pointer grabs the one on top.
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
      drawOrder = JOINT_KEYS,
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
    this.overlay = this._createOverlay();
    this.overlayCtx = this.overlay.getContext("2d");

    this.pose = pose;
    this.jointRadius = jointRadius;
    this.minorAxisScale = minorAxisScale;
    this.dragMode = dragMode;
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

  /// "ik" or "fk" (see DRAG_MODES); takes effect from the next drag.
  setDragMode(mode) {
    this.dragMode = mode;
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

  _createOverlay() {
    const overlay = document.createElement("canvas");
    overlay.className = "pose-overlay";
    overlay.width = overlay.height = CANVAS.size;
    overlay.setAttribute("aria-hidden", "true");
    this.canvas.insertAdjacentElement("afterend", overlay);
    return overlay;
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
  _hitTest(point, pointerType) {
    const radiusPx = PICKING.radiusPx[pointerType] ?? PICKING.radiusPx.mouse;
    const radius = Math.max(radiusPx * this._canvasScale(), this.jointRadius);
    let best = null;
    let bestDist = radius;
    for (let i = this.drawOrder.length - 1; i >= 0; i--) {
      const key = this.drawOrder[i];
      const j = this.pose.joints[key];
      if (!j) continue;
      const d = Math.hypot(j.x - point.x, j.y - point.y);
      if (d <= this.jointRadius) return key;
      if (d < bestDist) {
        best = key;
        bestDist = d;
      }
    }
    return best;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // background grid
    ctx.save();
    ctx.strokeStyle = CANVAS.gridColor;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += CANVAS.gridStep) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += CANVAS.gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Bones and joints, bottom to top in drawOrder. Each bone is drawn in the
    // layer of its top-most end, followed by its end dots so joints stay on
    // top of the bones they connect.
    const rank = Object.fromEntries(this.drawOrder.map((k, i) => [k, i]));
    const bonesByTop = {};
    for (const bone of BONES) {
      const top = rank[bone[0]] > rank[bone[1]] ? bone[0] : bone[1];
      (bonesByTop[top] ||= []).push(bone);
    }
    for (const key of this.drawOrder) {
      const bones = bonesByTop[key] || [];
      for (const bone of bones) this._drawBone(ctx, bone);
      for (const [a, b] of bones) this._drawJoint(ctx, a === key ? b : a);
      this._drawJoint(ctx, key);
    }

    this.drawOverlay();
  }

  /// One bone as a thick oval between its joints, coloured by its first joint.
  _drawBone(ctx, [a, b]) {
    const ja = this.pose.joints[a];
    const jb = this.pose.joints[b];
    if (!ja || !jb) return;

    const dx = jb.x - ja.x;
    const dy = jb.y - ja.y;
    const major = Math.max(Math.hypot(dx, dy), this.jointRadius * 2);
    const minor = Math.max(this.jointRadius * this.minorAxisScale, 2);
    const baseColor = JOINT_COLOR_BY_KEY[a] || "rgb(255, 85, 0)";

    ctx.save();
    ctx.strokeStyle = "#020617";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = colorWithAlpha(baseColor, 0.8);
    ctx.translate((ja.x + jb.x) / 2, (ja.y + jb.y) / 2);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.ellipse(0, 0, major / 2, minor / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawJoint(ctx, key) {
    const j = this.pose.joints[key];
    if (!j) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(j.x, j.y, this.jointRadius, 0, Math.PI * 2);
    ctx.fillStyle = JOINT_COLOR_BY_KEY[key] || "rgb(255, 85, 0)";
    ctx.strokeStyle = "#020617";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.save();
    ctx.lineWidth = OVERLAY.ringWidth;

    for (const key of this.pins) this._drawPin(ctx, this.pose.joints[key]);

    const activeKey = this.drag && this.drag.key;
    if (this.hoverJoint && this.hoverJoint !== activeKey) {
      this._drawRing(ctx, this.pose.joints[this.hoverJoint], OVERLAY.hoverColor);
    }
    if (activeKey) this._drawRing(ctx, this.pose.joints[activeKey], OVERLAY.activeColor);
    ctx.restore();
  }

  _drawRing(ctx, j, color) {
    if (!j) return;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(j.x, j.y, this.jointRadius + OVERLAY.ringGap, 0, Math.PI * 2);
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
