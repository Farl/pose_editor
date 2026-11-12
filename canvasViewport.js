import { VIEWPORT, PICKING, CANVAS } from "./editorConfig.js";

/// On-screen pan and zoom of the pose canvas (gestures in VIEWPORT).
///
/// The canvas layers sit in a "stage" element inside the frame; the stage is
/// CSS-transformed by translate(x, y) scale(zoom), in frame pixels with the
/// origin at the top left. Pointer positions on the canvas go through
/// getBoundingClientRect, which includes that transform, so posing and picking
/// work unchanged at any zoom. Exports never see it (SkeletonCanvas.toDataURL).
///
/// Who handles a pointer:
///   - capture phase, before SkeletonCanvas: a second touch (pinch; any joint
///     drag of the first finger is cancelled) and a VIEWPORT.panKey drag
///   - bubble phase, after SkeletonCanvas: a press SkeletonCanvas didn't take
///     (not on a joint; it calls preventDefault when it takes one) pans

/// The fitted view: whole canvas in the frame.
export const FIT = { zoom: 1, x: 0, y: 0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/// `view` kept inside VIEWPORT's zoom range, panned so the canvas still
/// covers a frame `size` pixels square (no empty margin).
export function clampView({ zoom, x, y }, size) {
  const z = clamp(zoom, VIEWPORT.minZoom, VIEWPORT.maxZoom);
  const min = size - size * z;
  return { zoom: z, x: clamp(x, Math.min(min, 0), Math.max(min, 0)), y: clamp(y, Math.min(min, 0), Math.max(min, 0)) };
}

/// `view` zoomed by `factor` (within VIEWPORT's range), keeping frame point
/// `p` over the same canvas point. The pan is not clamped (see clampView).
export function zoomAt(view, factor, p) {
  const zoom = clamp(view.zoom * factor, VIEWPORT.minZoom, VIEWPORT.maxZoom);
  const k = zoom / view.zoom;
  return { zoom, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k };
}

/// Wheel delta in pixels, whatever the event's deltaMode.
function wheelPixels(e) {
  const unit = [1, VIEWPORT.wheelLinePx, VIEWPORT.wheelPagePx][e.deltaMode] ?? 1;
  return e.deltaY * unit;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class CanvasViewport {
  /// `frame`: the clipping element; `stage`: the transformed element holding
  /// the canvas layers. `skeleton`: the SkeletonCanvas, so a pinch can cancel
  /// its drag and the layers get re-rendered at a sharp resolution.
  constructor(frame, stage, skeleton) {
    this.frame = frame;
    this.stage = stage;
    this.skeleton = skeleton;
    this.view = { ...FIT };
    /// Every touch down on the stage, by pointerId: frame-local position.
    this.touches = new Map();
    /// Active gesture, or null:
    ///   { type: "pan", pointerId, start, startView, moved }
    ///   { type: "pinch", ids: [a, b], startDist, startMid, startView }
    this.gesture = null;
    /// Last empty-space tap, for double-tap fitting: its timeStamp.
    this.lastTapTime = -Infinity;
    this.panKeyDown = false;
    /// False while another view (3D mode) replaces the stage.
    this.enabled = true;
    this.pointerOver = false;
    this._bindEvents();
    new ResizeObserver(() => this._apply(this.view)).observe(frame);
  }

  /// Turn the gestures on or off; turning them off also fits the canvas.
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.gesture = null;
      this._setPanKey(false);
      this.fit();
    }
  }

  /// Back to the whole canvas in the frame.
  fit() {
    this._apply({ ...FIT });
  }

  /// Frame size in CSS pixels (the frame is square).
  _size() {
    return this.frame.clientWidth;
  }

  /// Frame-local position of a pointer event.
  _local(e) {
    const rect = this.frame.getBoundingClientRect();
    return { x: e.clientX - rect.left - this.frame.clientLeft, y: e.clientY - rect.top - this.frame.clientTop };
  }

  /// Show `view`, clamped (clampView), and re-render the layers sharp for its zoom.
  _apply(view) {
    this.view = clampView(view, this._size());
    const { zoom, x, y } = this.view;
    this.stage.style.transform = zoom === 1 && !x && !y ? "" : `translate(${x}px, ${y}px) scale(${zoom})`;
    this.frame.classList.toggle("is-zoomed", zoom > 1);
    // Backing pixels per canvas unit for a sharp image at this zoom.
    const shown = this._size() * zoom * (window.devicePixelRatio || 1);
    this.skeleton.setRenderScale(clamp(Math.ceil(shown / CANVAS.size), 1, VIEWPORT.maxRenderScale));
  }

  _bindEvents() {
    const stage = this.stage;

    this.frame.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this._apply(zoomAt(this.view, Math.exp(-wheelPixels(e) * VIEWPORT.wheelZoomRate), this._local(e)));
      },
      { passive: false }
    );

    // Capture: gestures that win over posing.
    stage.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "touch") this.touches.set(e.pointerId, this._local(e));
        if (e.pointerType === "touch" && this.touches.size === 2) {
          this.skeleton.cancelDrag();
          this._startPinch();
        } else if (this.panKeyDown && e.pointerType !== "touch") {
          this._startPan(e);
        } else {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );

    // Bubble: a press SkeletonCanvas left alone (empty space) pans.
    stage.addEventListener("pointerdown", (e) => {
      if (e.defaultPrevented || this.gesture) return;
      this._startPan(e);
    });

    stage.addEventListener(
      "pointermove",
      (e) => {
        if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, this._local(e));
        const g = this.gesture;
        if (!g) return;
        if (g.type === "pinch" && g.ids.includes(e.pointerId)) this._movePinch();
        else if (g.type === "pan" && g.pointerId === e.pointerId) this._movePan(e);
        else return;
        e.stopPropagation();
      },
      true
    );

    const end = (e) => {
      this.touches.delete(e.pointerId);
      const g = this.gesture;
      if (!g) return;
      if (g.type === "pinch" && g.ids.includes(e.pointerId)) this.gesture = null;
      if (g.type === "pan" && g.pointerId === e.pointerId) {
        this.gesture = null;
        if (!g.moved) this._tap(e.timeStamp);
      }
    };
    stage.addEventListener("pointerup", end, true);
    stage.addEventListener("pointercancel", end, true);

    // Pan key: only while the pointer is over the canvas, so Space still
    // works on focused buttons elsewhere.
    this.frame.addEventListener("pointerenter", () => (this.pointerOver = true));
    this.frame.addEventListener("pointerleave", () => (this.pointerOver = false));
    window.addEventListener("keydown", (e) => {
      if (e.key !== VIEWPORT.panKey || !this.pointerOver || !this.enabled) return;
      if (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]")) return;
      e.preventDefault();
      this._setPanKey(true);
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === VIEWPORT.panKey) this._setPanKey(false);
    });
    window.addEventListener("blur", () => this._setPanKey(false));
  }

  _setPanKey(down) {
    this.panKeyDown = down;
    this.frame.classList.toggle("is-panning", down);
  }

  _startPan(e) {
    this.stage.setPointerCapture(e.pointerId);
    this.gesture = { type: "pan", pointerId: e.pointerId, start: this._local(e), startView: this.view, moved: false };
  }

  _movePan(e) {
    const g = this.gesture;
    const p = this._local(e);
    if (!g.moved && distance(p, g.start) < VIEWPORT.tapSlopPx) return;
    g.moved = true;
    this._apply({ ...g.startView, x: g.startView.x + p.x - g.start.x, y: g.startView.y + p.y - g.start.y });
  }

  /// Two taps on empty space in quick succession fit the canvas.
  _tap(time) {
    if (time - this.lastTapTime <= PICKING.doubleTapMs) {
      this.lastTapTime = -Infinity;
      this.fit();
    } else {
      this.lastTapTime = time;
    }
  }

  _startPinch() {
    const ids = [...this.touches.keys()];
    const [a, b] = ids.map((id) => this.touches.get(id));
    for (const id of ids) {
      if (!this.stage.hasPointerCapture(id)) this.stage.setPointerCapture(id);
    }
    this.gesture = { type: "pinch", ids, startDist: distance(a, b) || 1, startMid: midpoint(a, b), startView: this.view };
  }

  /// Zoom by the change in finger spread around the starting midpoint, and
  /// pan by how far the midpoint moved.
  _movePinch() {
    const g = this.gesture;
    const [a, b] = g.ids.map((id) => this.touches.get(id));
    const mid = midpoint(a, b);
    const zoomed = zoomAt(g.startView, distance(a, b) / g.startDist, g.startMid);
    this._apply({ ...zoomed, x: zoomed.x + mid.x - g.startMid.x, y: zoomed.y + mid.y - g.startMid.y });
  }
}
