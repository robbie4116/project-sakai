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

function readConstantExpression(source, constantName) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*([^;]+);`));
  return match ? match[1].trim() : null;
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
  const match = appSource.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(match, `${name} should exist`);

  const openBrace = match.index + match[0].length - 1;
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
  const afterStart = tileGeneratorSource.slice(start);
  const end = afterStart.search(/\r?\n\r?\ndef generate_detail_map_tiles/);
  assert.notEqual(end, -1, 'generate_map_tiles block should end before detail wrapper');
  const mapTileGenerator = afterStart.slice(0, end);

  assert.match(mapTileGenerator, /read_xyz_tile/);
  assert.match(tileGeneratorSource, /boundless\s*=\s*True/);
  assert.match(tileGeneratorSource, /out_shape\s*=\s*\(\s*3\s*,\s*MAP_TILE_PX\s*,\s*MAP_TILE_PX\s*\)/);
  assert.match(tileGeneratorSource, /OUTSIDE_TILE_FILL\s*=\s*\(\s*14\s*,\s*26\s*,\s*14\s*\)/);
});

test('map fits the Sentinel-2 grid and limits panning to about 1 km around it', () => {
  const initMapBlock = extractFunctionBlock('initMap');
  const contextLayerBlock = extractFunctionBlock('makeContextTileLayer');
  const detailLayerBlock = extractFunctionBlock('makeDetailTileLayer');

  assert.equal(readBoundsConstant(appSource, 'MAP_CONTEXT_BOUNDS'), true);
  assert.equal(readBoundsConstant(appSource, 'MAP_DETAIL_BOUNDS'), true);
  assert.match(appSource, /const MAP_DETAIL_BOUNDS = L\.latLngBounds\(\s*\[GRID_BOUNDS\.latS, GRID_BOUNDS\.lngW\],\s*\[GRID_BOUNDS\.latN, GRID_BOUNDS\.lngE\]\s*\)/);
  assert.match(appSource, /const GRID_MAX_BOUNDS = MAP_DETAIL_BOUNDS\.pad\(0\.2\)/);
  assert.match(initMapBlock, /maxBounds:\s*GRID_MAX_BOUNDS/);
  assert.match(initMapBlock, /map\.fitBounds\(MAP_DETAIL_BOUNDS\)/);
  assert.doesNotMatch(initMapBlock, /ATOK_POLY/);
  assert.match(initMapBlock, /L\.polygon\(PAOAY_POLY/);
  assert.match(contextLayerBlock, /bounds:\s*MAP_CONTEXT_BOUNDS/);
  assert.match(detailLayerBlock, /bounds:\s*MAP_DETAIL_BOUNDS/);
});

test('online browser map uses ESRI World Imagery at every app zoom level', () => {
  const initMapBlock = extractFunctionBlock('initMap');
  const addBaseLayersBlock = extractFunctionBlock('addBaseImageryLayers');
  const esriLayerBlock = extractFunctionBlock('makeEsriTileLayer');
  const useOnlineBlock = extractFunctionBlock('useOnlineImagery');
  const mapMaxZoomBlock = extractFunctionBlock('getMapMaxZoom');

  assert.match(appSource, /ESRI_TILE_TEMPLATE\s*=\s*'https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}'/);
  assert.equal(readNumericConstant(appSource, 'ONLINE_IMAGERY_MAX_ZOOM'), 19);
  assert.equal(readNumericConstant(appSource, 'ONLINE_IMAGERY_NATIVE_ZOOM'), 18);
  assert.match(useOnlineBlock, /!window\.__TAURI__/);
  assert.match(mapMaxZoomBlock, /useOnlineImagery\(\)\s*\?\s*ONLINE_IMAGERY_MAX_ZOOM\s*:\s*MAP_APP_MAX_ZOOM/);
  assert.match(initMapBlock, /maxZoom:\s*getMapMaxZoom\(\)/);
  assert.match(addBaseLayersBlock, /if\s*\(\s*useOnlineImagery\(\)\s*\)/);
  assert.match(addBaseLayersBlock, /makeEsriTileLayer\(\)\.addTo\(map\)/);
  assert.match(esriLayerBlock, /L\.tileLayer\(ESRI_TILE_TEMPLATE/);
  assert.match(esriLayerBlock, /maxZoom:\s*ONLINE_IMAGERY_MAX_ZOOM/);
  assert.match(esriLayerBlock, /maxNativeZoom:\s*ONLINE_IMAGERY_NATIVE_ZOOM/);
});

test('offline app still uses generated local context and detail map tiles', () => {
  const addBaseLayersBlock = extractFunctionBlock('addBaseImageryLayers');
  const themeBlock = extractFunctionBlock('applyTheme');

  assert.match(addBaseLayersBlock, /contextTileLayerRef\s*=\s*makeContextTileLayer\(\)\.addTo\(map\)/);
  assert.match(addBaseLayersBlock, /detailTileLayerRef\s*=\s*makeDetailTileLayer\(\)\.addTo\(map\)/);
  assert.match(themeBlock, /refreshBaseImageryLayers\(\)/);
});

test('tile generator defines separate context and detail map outputs', () => {
  assert.match(tileGeneratorSource, /DETAIL_MAP_OUT_DIR\s*=\s*Path\("tiles\/map"\)/);
  assert.match(tileGeneratorSource, /CONTEXT_MAP_OUT_DIR\s*=\s*Path\("tiles\/context"\)/);
  assert.match(tileGeneratorSource, /CONTEXT_SOURCE_TIF\s*=\s*"benguet_satellite\.tif"/);
  assert.match(tileGeneratorSource, /generate_context_map_tiles/);
  assert.match(tileGeneratorSource, /generate_detail_map_tiles/);
});

test('map max zoom stays within the native Atok raster detail', () => {
  assert.equal(readNumericConstant(appSource, 'MAP_DETAIL_MIN_ZOOM'), 14);
  assert.equal(readNumericConstant(appSource, 'MAP_DETAIL_MAX_ZOOM'), 14);
  assert.equal(readNumericConstant(appSource, 'MAP_APP_MAX_ZOOM'), 14);
  assert.equal(readConstantExpression(appSource, 'CANVAS_DETAIL_ZOOM'), 'MAP_DETAIL_MAX_ZOOM');
  assert.match(tileGeneratorSource, /DETAIL_MIN_ZOOM\s*=\s*14/);
  assert.match(tileGeneratorSource, /DETAIL_MAX_ZOOM\s*=\s*14/);
});

test('plot canvas draws the rendered plot image before label overlays', () => {
  const renderCanvasBlock = extractFunctionBlock('renderCanvas');
  const getPlotTileBlock = extractFunctionBlock('getPlotTile');

  assert.match(appSource, /function\s+getPlotTile\s*\(\s*idx\s*\)/);
  assert.match(appSource, /const\s+PLOTS\s*=\s*window\.PLOTS/);
  assert.match(getPlotTileBlock, /if\s*\(\s*!plot\s*\|\|\s*!plot\.tilePath\s*\)\s*return\s+null/);
  assert.match(getPlotTileBlock, /img\.src\s*=\s*plot\.tilePath/);
  assert.match(renderCanvasBlock, /const\s+tile\s*=\s*getPlotTile\(state\.plotIdx\)/);
  assert.match(renderCanvasBlock, /if\s*\(\s*tile\s*&&\s*tile\.complete\s*&&\s*tile\.naturalWidth\s*>\s*0\s*\)\s*ctx\.drawImage\(tile,\s*0,\s*0,\s*w,\s*h\)/);
  assert.ok(renderCanvasBlock.indexOf('getPlotTile(') < renderCanvasBlock.indexOf('drawMixedCell('));
});

test('plot canvas uses device-pixel backing resolution instead of browser-upscaled pixels', () => {
  const fitCanvasBlock = extractFunctionBlock('fitCanvas');

  assert.match(fitCanvasBlock, /window\.devicePixelRatio/);
  assert.match(fitCanvasBlock, /canvas\.style\.width\s*=\s*size\s*\+\s*'px'/);
  assert.match(fitCanvasBlock, /canvas\.style\.height\s*=\s*size\s*\+\s*'px'/);
  assert.match(fitCanvasBlock, /canvas\.width\s*=\s*Math\.round\(size\s*\*\s*dpr\)/);
  assert.match(fitCanvasBlock, /canvas\.height\s*=\s*Math\.round\(size\s*\*\s*dpr\)/);
});

test('plot canvas no longer stitches live or offline map tiles', () => {
  const renderCanvasBlock = extractFunctionBlock('renderCanvas');

  assert.doesNotMatch(appSource, /function\s+(drawMapTileBackground|getMapTileImage|latLngToGlobalPixel)\s*\(/);
  assert.doesNotMatch(renderCanvasBlock, /useOnlineImagery|ESRI_TILE_TEMPLATE/);
});

test('plot canvas greys out cells beyond the Sentinel-2 composite and shows one line per cell', () => {
  const renderCanvasBlock = extractFunctionBlock('renderCanvas');

  assert.match(renderCanvasBlock, /plot\.validCols < GRID \|\| plot\.validRows < GRID/);
  assert.match(renderCanvasBlock, /ctx\.fillRect\(plot\.validCols \* cellW, 0, w - plot\.validCols \* cellW, h\)/);
  assert.match(renderCanvasBlock, /ctx\.fillRect\(0, plot\.validRows \* cellH, plot\.validCols \* cellW, h - plot\.validRows \* cellH\)/);
  assert.match(renderCanvasBlock, /for \(let i=1;i<GRID;i\+\+\)/);
  assert.match(renderCanvasBlock, /GridMath\.validCellCount\(plot\)/);
});

test('cloud sync debounces edits for 1.5 seconds and retries every 30 seconds', () => {
  assert.equal(readNumericConstant(appSource, 'CLOUD_SYNC_DELAY'), 1500);
  assert.equal(readNumericConstant(appSource, 'CLOUD_RETRY_DELAY'), 30000);
  assert.match(appSource, /function scheduleCloudFlush\(delay = CLOUD_SYNC_DELAY\)/);
  assert.match(appSource, /setTimeout\(\(\)\s*=>\s*\{\s*flushCloudSync\(\)\.catch\(e\s*=>\s*console\.warn\('cloud sync failed:',\s*e\)\);\s*\},\s*delay\)/);
  assert.match(appSource, /scheduleCloudFlush\(CLOUD_RETRY_DELAY\)/);
});
