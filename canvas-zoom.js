// Plot canvas zoom and pan. Coordinates are fractions of the canvas side
// (0..1), so the view survives canvas resizes. The view shows the square
// [x, x + 1/z] x [y, y + 1/z] of the unzoomed plot.
(function (root) {
  'use strict';

  const MAX_ZOOM = 6;

  function create() {
    return { z: 1, x: 0, y: 0 };
  }

  function clamp(view) {
    const z = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(view.z) ? view.z : 1));
    const max = 1 - 1 / z;
    const fit = v => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
    return { z, x: fit(view.x), y: fit(view.y) };
  }

  // Screen fraction -> unzoomed plot fraction.
  function toBase(view, sx, sy) {
    return { x: view.x + sx / view.z, y: view.y + sy / view.z };
  }

  // Multiply the zoom, keeping the plot point under (sx, sy) fixed on screen.
  function zoomAt(view, factor, sx = 0.5, sy = 0.5) {
    const anchor = toBase(view, sx, sy);
    const z = Math.min(MAX_ZOOM, Math.max(1, view.z * factor));
    return clamp({ z, x: anchor.x - sx / z, y: anchor.y - sy / z });
  }

  // Drag the plot by a screen-fraction delta (content follows the pointer).
  function pan(view, dx, dy) {
    return clamp({ z: view.z, x: view.x - dx / view.z, y: view.y - dy / view.z });
  }

  const api = { MAX_ZOOM, create, clamp, toBase, zoomAt, pan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_CANVAS_ZOOM = api;
})(typeof window !== 'undefined' ? window : globalThis);
