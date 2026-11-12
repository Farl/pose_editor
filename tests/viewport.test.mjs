// Run with: node --test tests/*.test.mjs
// Canvas pan and zoom math (canvasViewport.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { FIT, clampView, zoomAt } from "../canvasViewport.js";
import { VIEWPORT } from "../editorConfig.js";

const SIZE = 400;

test("zooming keeps the point under the pointer in place", () => {
  const p = { x: 100, y: 300 };
  const view = zoomAt(FIT, 2, p);
  assert.equal(view.zoom, 2);
  // Canvas point under p before: p itself (fit). After: (p - pan) / zoom.
  assert.deepEqual({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom }, p);
});

test("zoom stays within VIEWPORT's range", () => {
  assert.equal(zoomAt(FIT, 0.1, { x: 0, y: 0 }).zoom, VIEWPORT.minZoom);
  assert.equal(zoomAt(FIT, 1000, { x: 0, y: 0 }).zoom, VIEWPORT.maxZoom);
});

test("pan is clamped so the canvas always covers the frame", () => {
  assert.deepEqual(clampView({ zoom: 1, x: 50, y: -50 }, SIZE), FIT);
  assert.deepEqual(clampView({ zoom: 2, x: 10, y: -1000 }, SIZE), { zoom: 2, x: 0, y: -SIZE });
  assert.deepEqual(clampView({ zoom: 2, x: -100, y: -200 }, SIZE), { zoom: 2, x: -100, y: -200 });
});
