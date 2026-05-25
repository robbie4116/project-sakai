import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const tileGeneratorSource = await readFile(new URL('../generate_tiles.py', import.meta.url), 'utf8');
const mapTilesDir = new URL('../tiles/map', import.meta.url);

function readNumericOption(block, optionName) {
  const match = block.match(new RegExp(`${optionName}\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function readOptionValue(block, optionName) {
  const match = block.match(new RegExp(`${optionName}\\s*:\\s*([^,\\n}]+)`));
  return match ? match[1].trim() : null;
}

function readNumericConstant(source, constantName) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function resolveNumericValue(source, value) {
  if (value === null) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const resolved = readNumericConstant(source, value);
  assert.notEqual(resolved, null, `constant ${value} not found in source`);
  return resolved;
}

function readBoundsConstant(source, constantName) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*L\\.latLngBounds\\s*\\(`));
  return Boolean(match);
}

function extractFunctionBlock(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);

  const openBrace = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(openBrace + 1, i);
  }

  throw new Error(`${name} block was not closed`);
}

test('map zoom floor follows the offline context tile layer', async () => {
  const contextTilesDir = new URL('../tiles/context', import.meta.url);
  const contextZoomDirs = (await readdir(contextTilesDir, { withFileTypes: true }).catch(() => {
    throw new Error('tiles/context directory not found — run generate_tiles.py first');
  }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const lowestContextZoom = Math.min(...contextZoomDirs);

  const initMapBlock = extractFunctionBlock('initMap');
  const contextLayerBlock = extractFunctionBlock('makeContextTileLayer');
  const detailLayerBlock = extractFunctionBlock('makeDetailTileLayer');

  assert.equal(resolveNumericValue(appSource, readOptionValue(initMapBlock, 'minZoom')), lowestContextZoom);
  assert.equal(resolveNumericValue(appSource, readOptionValue(contextLayerBlock, 'minNativeZoom')), lowestContextZoom);
  assert.equal(
    resolveNumericValue(appSource, readOptionValue(detailLayerBlock, 'minNativeZoom')),
    readNumericConstant(appSource, 'MAP_DETAIL_MIN_ZOOM'),
  );
  assert.match(contextLayerBlock, /tiles\/context\/\{z\}\/\{x\}\/\{y\}\.jpg\?v=/);
  assert.match(detailLayerBlock, /tiles\/map\/\{z\}\/\{x\}\/\{y\}\.jpg\?v=/);
});

test('map tile generation preserves full XYZ tile extents instead of stretching partial source coverage', () => {
  const start = tileGeneratorSource.indexOf('def generate_map_tiles');
  assert.notEqual(start, -1, 'generate_map_tiles should exist');
  const end = tileGeneratorSource.indexOf('\n\nif __name__ == "__main__"', start);
  assert.notEqual(end, -1, 'generate_map_tiles block should end before main');
  const mapTileGenerator = tileGeneratorSource.slice(start, end);

  assert.match(mapTileGenerator, /read_xyz_tile/);
  assert.match(tileGeneratorSource, /boundless\s*=\s*True/);
  assert.match(tileGeneratorSource, /out_shape\s*=\s*\(\s*3\s*,\s*MAP_TILE_PX\s*,\s*MAP_TILE_PX\s*\)/);
  assert.match(tileGeneratorSource, /OUTSIDE_TILE_FILL\s*=\s*\(\s*14\s*,\s*26\s*,\s*14\s*\)/);
});

test('map uses separate context and detail bounds', () => {
  const initMapBlock = extractFunctionBlock('initMap');
  const contextLayerBlock = extractFunctionBlock('makeContextTileLayer');
  const detailLayerBlock = extractFunctionBlock('makeDetailTileLayer');

  assert.equal(readBoundsConstant(appSource, 'MAP_CONTEXT_BOUNDS'), true);
  assert.equal(readBoundsConstant(appSource, 'MAP_DETAIL_BOUNDS'), true);
  assert.match(initMapBlock, /maxBounds:\s*MAP_CONTEXT_BOUNDS/);
  assert.match(contextLayerBlock, /bounds:\s*MAP_CONTEXT_BOUNDS/);
  assert.match(detailLayerBlock, /bounds:\s*MAP_DETAIL_BOUNDS/);
});

test('tile generator defines separate context and detail map outputs', () => {
  assert.match(tileGeneratorSource, /DETAIL_MAP_OUT_DIR\s*=\s*Path\("tiles\/map"\)/);
  assert.match(tileGeneratorSource, /CONTEXT_MAP_OUT_DIR\s*=\s*Path\("tiles\/context"\)/);
  assert.match(tileGeneratorSource, /CONTEXT_SOURCE_TIF\s*=\s*"benguet_satellite\.tif"/);
  assert.match(tileGeneratorSource, /generate_context_map_tiles/);
  assert.match(tileGeneratorSource, /generate_detail_map_tiles/);
});

test('plot canvas draws the selected plot crop before label overlays', () => {
  const renderCanvasBlock = extractFunctionBlock('renderCanvas');

  assert.match(appSource, /function\s+getPlotTile\s*\(\s*idx\s*\)/);
  assert.match(appSource, /tiles\/plots\/plot_\$\{String\(idx\)\.padStart\(3,\s*'0'\)\}\.jpg/);
  assert.match(renderCanvasBlock, /const\s+tile\s*=\s*getPlotTile\(state\.plotIdx\)/);
  assert.match(renderCanvasBlock, /ctx\.drawImage\(tile,\s*0,\s*0,\s*w,\s*h\)/);
});
