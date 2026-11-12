import * as THREE from "three";
import { CONTROLS } from "./config.js";

const SVG = "http://www.w3.org/2000/svg";
const AXES = ["x", "y", "z"];

/// Corner axis gizmo: the world axes as seen by the camera, redrawn every
/// frame (update). Positive ends carry the axis letter; pressing any end calls
/// onPick(direction), the unit world vector from the scene toward that end.
export function createAxisGizmo(host, onPick) {
  const { sizePx, axisPx, endPx, negativeEndPx, colors } = CONTROLS.gizmo;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "axis-gizmo");
  svg.setAttribute("viewBox", `${-sizePx / 2} ${-sizePx / 2} ${sizePx} ${sizePx}`);
  svg.style.width = svg.style.height = `${sizePx}px`;
  host.appendChild(svg);

  // One line per axis and one dot per axis end; reordered by depth on update.
  const ends = AXES.flatMap((axis, i) =>
    [1, -1].map((sign) => {
      const direction = AXES.map((_, j) => (j === i ? sign : 0));
      const group = document.createElementNS(SVG, "g");
      group.setAttribute("class", "axis-gizmo-end");
      const line = document.createElementNS(SVG, "line");
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("r", sign > 0 ? endPx : negativeEndPx);
      dot.setAttribute("fill", colors[axis]);
      line.setAttribute("stroke", colors[axis]);
      group.append(line, dot);
      if (sign > 0) {
        const label = document.createElementNS(SVG, "text");
        label.textContent = axis.toUpperCase();
        group.append(label);
      } else {
        dot.setAttribute("fill-opacity", "0.45");
        line.setAttribute("stroke-opacity", "0");
      }
      // On press, not click: update() re-appends the ends every frame, which
      // would split a click's down and up across two insertions.
      group.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onPick(direction);
      });
      svg.append(group);
      return { group, line, dot, label: group.querySelector("text"), direction };
    })
  );

  /// Redraw for `camera` (a Three.js camera): each world axis rotated into view space.
  function update(camera) {
    const inverse = camera.quaternion.clone().invert();
    for (const end of ends) {
      const v = new THREE.Vector3(...end.direction).applyQuaternion(inverse);
      const x = v.x * axisPx;
      const y = -v.y * axisPx;
      end.depth = v.z;
      end.line.setAttribute("x2", x);
      end.line.setAttribute("y2", y);
      end.dot.setAttribute("cx", x);
      end.dot.setAttribute("cy", y);
      if (end.label) {
        end.label.setAttribute("x", x);
        end.label.setAttribute("y", y);
      }
    }
    // Ends nearer the viewer (larger view-space z) drawn last, on top.
    for (const end of [...ends].sort((a, b) => a.depth - b.depth)) svg.append(end.group);
  }

  return { update, element: svg };
}
