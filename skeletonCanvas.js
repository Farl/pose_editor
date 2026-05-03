import { JOINT_KEYS, BONES } from "./pose.js";

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

export class SkeletonCanvas {
  constructor(
    canvas,
    pose,
    { jointRadius = 8, minorAxisScale = 1, onChange, onChangeEnd } = {}
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pose = pose;
    this.jointRadius = jointRadius;
    this.minorAxisScale = minorAxisScale;
    this.onChange = onChange;
    this.onChangeEnd = onChangeEnd;
    this.activeJoint = null;
    this.isDragging = false;

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

  _bindEvents() {
    const canvas = this.canvas;

    const pointerDown = (e) => {
      const point = this._getCanvasPoint(e);
      const hit = this._hitTest(point.x, point.y);
      if (hit) {
        this.activeJoint = hit;
        this.isDragging = true;
      }
    };

    const pointerMove = (e) => {
      if (!this.isDragging || !this.activeJoint) return;
      const point = this._getCanvasPoint(e);
      this.pose.joints[this.activeJoint].x = point.x;
      this.pose.joints[this.activeJoint].y = point.y;
      if (this.onChange) this.onChange(this.pose);
      this.draw();
    };

    const pointerUp = () => {
      if (this.isDragging && this.onChangeEnd) {
        this.onChangeEnd(this.pose);
      }
      this.isDragging = false;
      this.activeJoint = null;
    };

    canvas.addEventListener("mousedown", pointerDown);
    canvas.addEventListener("mousemove", pointerMove);
    window.addEventListener("mouseup", pointerUp);

    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      pointerDown(e.touches[0]);
    });
    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      pointerMove(e.touches[0]);
    });
    window.addEventListener("touchend", pointerUp);
    window.addEventListener("touchcancel", pointerUp);
  }

  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return { x, y };
  }

  _hitTest(x, y) {
    const radius = this.jointRadius + 4;
    for (const key of JOINT_KEYS) {
      const j = this.pose.joints[key];
      if (!j) continue;
      const dx = j.x - x;
      const dy = j.y - y;
      if (dx * dx + dy * dy <= radius * radius) {
        return key;
      }
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // background grid
    ctx.save();
    ctx.strokeStyle = "rgba(82,82,91,0.35)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // bones as thick ovals between joints
    ctx.save();
    ctx.strokeStyle = "#020617";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;

    for (const [a, b] of BONES) {
      const ja = this.pose.joints[a];
      const jb = this.pose.joints[b];
      if (!ja || !jb) continue;

      const midX = (ja.x + jb.x) / 2;
      const midY = (ja.y + jb.y) / 2;
      const dx = jb.x - ja.x;
      const dy = jb.y - ja.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const major = Math.max(length, this.jointRadius * 2);
      const minor = Math.max(this.jointRadius * this.minorAxisScale, 2);
      const baseColor = JOINT_COLOR_BY_KEY[a] || "rgb(255, 85, 0)";

      ctx.save();
      ctx.fillStyle = colorWithAlpha(baseColor, 0.8);
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, major / 2, minor / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // joints
    ctx.save();
    for (const key of JOINT_KEYS) {
      const j = this.pose.joints[key];
      if (!j) continue;
      const active = key === this.activeJoint;
      const jointColor = JOINT_COLOR_BY_KEY[key] || "rgb(255, 85, 0)";
      ctx.beginPath();
      ctx.arc(j.x, j.y, this.jointRadius + (active ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle = jointColor;
      ctx.strokeStyle = active ? "#ffffff" : "#020617";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}