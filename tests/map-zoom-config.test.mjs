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

test('map can zoom out to the lowest committed native tile zoom', async () => {
  const zoomDirs = (await readdir(mapTilesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const lowestNativeZoom = Math.min(...zoomDirs);

  const tileLayerBlock = extractFunctionBlock('makeTileLayer');
  const initMapBlock = extractFunctionBlock('initMap');

  const mapMinZoom = readNumericOption(initMapBlock, 'minZoom');
  const tileMinZoom = readNumericOption(tileLayerBlock, 'minZoom');
  const tileMinNativeZoom = readNumericOption(tileLayerBlock, 'minNativeZoom');

  assert.equal(mapMinZoom, lowestNativeZoom);
  assert.equal(tileMinZoom, lowestNativeZoom);
  assert.equal(tileMinNativeZoom, lowestNativeZoom);
  assert.match(tileLayerBlock, /tiles\/map\/\{z\}\/\{x\}\/\{y\}\.jpg\?v=/);
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
