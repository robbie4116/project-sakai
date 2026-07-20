import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../taniman.html', import.meta.url), 'utf8');
const generatorSource = fs.readFileSync(new URL('../generate_tiles.py', import.meta.url), 'utf8');

function extractFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

test('outside plot creation UI and runtime are removed', () => {
  assert.doesNotMatch(htmlSource, /add-outside-btn|btn-remove-outside/);
  assert.doesNotMatch(appSource, /createOutsidePlotAt|registerCustomOutsidePlot|handleOutsideMapClick/);
  assert.doesNotMatch(appSource, /enabledOutsidePlots|customOutsidePlots|removeOutsidePlot|setOutsideAddMode/);
});

test('runtime exposes generated Paoay plots as the full active plot list', () => {
  assert.match(appSource, /const\s+PAOAY_PLOTS\s*=\s*window\.PAOAY_PLOTS/);
  assert.match(appSource, /const\s+PLOTS\s*=\s*PAOAY_PLOTS/);
  assert.match(appSource, /const\s+CORE_PLOT_COUNT\s*=\s*PAOAY_PLOTS\.length/);
  assert.doesNotMatch(appSource, /concat\(|buildOutsidePlots|TUBLAY_PLOTS|AMBASSADOR_PLOTS/);
});

test('map, legend, and roster aggregate every generated Paoay plot directly', () => {
  const drawBlock = extractFunctionBlock(appSource, 'drawPlotsOnMap');
  const legendBlock = extractFunctionBlock(appSource, 'updateLegend');
  const rosterBlock = extractFunctionBlock(appSource, 'buildRosterData');
  assert.match(drawBlock, /PLOTS\.forEach/);
  assert.match(legendBlock, /PLOTS\.forEach/);
  assert.match(rosterBlock, /PLOTS\.forEach/);
  assert.doesNotMatch(drawBlock + legendBlock + rosterBlock, /enabledOutsidePlots|visiblePlots\(\)\.forEach/);
});

test('tile generator builds only Paoay field-grid plots', () => {
  assert.match(generatorSource, /PAOAY_BOUNDARY_PATH/);
  assert.match(generatorSource, /"area":\s*"paoay"/);
  assert.match(generatorSource, /"source":\s*"field_grid"/);
  assert.doesNotMatch(generatorSource, /OUTSIDE_PLOT_PREFIX|build_outside_plots|outside_custom|outside_tublay/);
});

test('canvas readouts are outside the image frame instead of overlaying the paintable canvas', () => {
  assert.match(htmlSource, /<div class="canvas-frame" id="canvas-frame">[\s\S]*<canvas id="plot-canvas"/);
  assert.match(htmlSource, /<div class="canvas-status">[\s\S]*id="canvas-corner"[\s\S]*id="canvas-view-tag"/);
});
