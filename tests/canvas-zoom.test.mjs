import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const Zoom = require('../canvas-zoom.js');

const close = (actual, expected) => {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} != ${expected[key]}`);
};

test('a new view shows the whole plot', () => {
  assert.deepEqual(Zoom.create(), { z: 1, x: 0, y: 0 });
  close(Zoom.toBase(Zoom.create(), 0.25, 0.75), { x: 0.25, y: 0.75 });
});

test('zooming keeps the point under the pointer fixed', () => {
  const view = Zoom.zoomAt(Zoom.create(), 4, 0.2, 0.6);
  close(view, { z: 4, x: 0.15, y: 0.45 });
  close(Zoom.toBase(view, 0.2, 0.6), { x: 0.2, y: 0.6 });
  const deeper = Zoom.zoomAt(view, 1.5, 0.9, 0.1);
  close(Zoom.toBase(deeper, 0.9, 0.1), Zoom.toBase(view, 0.9, 0.1));
});

test('zoom is limited to 1x..6x and the view never leaves the plot', () => {
  close(Zoom.zoomAt(Zoom.create(), 100), { z: Zoom.MAX_ZOOM });
  close(Zoom.zoomAt(Zoom.zoomAt(Zoom.create(), 3, 1, 1), 0.01), { z: 1, x: 0, y: 0 });
  const corner = Zoom.zoomAt(Zoom.create(), 2, 1, 1);
  close(corner, { z: 2, x: 0.5, y: 0.5 });
  close(Zoom.pan(corner, -5, -5), { x: 0.5, y: 0.5 });
  close(Zoom.pan(corner, 5, 5), { x: 0, y: 0 });
});

test('panning moves the plot with the pointer at the current zoom', () => {
  const view = Zoom.zoomAt(Zoom.create(), 4);
  close(Zoom.pan(view, 0.2, -0.1), { x: view.x - 0.05, y: view.y + 0.025 });
  close(Zoom.pan(Zoom.create(), 0.3, 0.3), { x: 0, y: 0 });
});

test('clamp repairs invalid views', () => {
  close(Zoom.clamp({ z: NaN, x: 3, y: -1 }), { z: 1, x: 0, y: 0 });
  close(Zoom.clamp({ z: 2, x: 0.9, y: NaN }), { z: 2, x: 0.5, y: 0 });
});

test('a pinch that starts mid-stroke restores what the first finger painted', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function cancelStroke(');
  const open = source.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < source.length; end++) { if (source[end] === '{') depth++; if (source[end] === '}' && --depth === 0) break; }
  const restored = [];
  const context = {
    painting: true, strokeHasUndo: true,
    undoStack: [{ plotIdx: 7, seasons: [{ id: 'before' }] }],
    restoreSeasonsSnapshot: (idx, seasons) => restored.push([idx, seasons]),
    renderCanvas() {}, updateProgress() {}, updateMapPlot() {}, refreshMetaToggle() {}, updateUndoBtn() {}, schedSave() {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end + 1) + '\ncancelStroke();', context);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), [[7, [{ id: 'before' }]]]);
  assert.equal(context.undoStack.length, 0, 'the cancelled stroke leaves no undo entry');
  assert.equal(context.painting, false);
});
