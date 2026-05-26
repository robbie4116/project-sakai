# Map Composition Legend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map and legend represent visible crop composition by cell coverage instead of dominant plot color/counts.

**Architecture:** Add a shared plot-composition helper in `app.js`, then use it from map styling, mixed-plot overlay rendering, and legend aggregation. Keep the v3 data model unchanged and add source-level Node tests that verify the dominant-crop behavior is no longer the source of truth for legend or mixed map display.

**Tech Stack:** Vanilla JavaScript, Leaflet rectangles/markers, CSS, Node `node:test`.

---

## Chunk 1: Composition Helper and Tests

### File Structure

- Modify: `app.js`
  - Add `plotCompositionForView(idx, viewMonths = state.viewMonths)`.
  - Keep `dominantCropForView(idx)` as a thin compatibility wrapper over the new helper.
- Create: `tests/map-composition-legend.test.mjs`
  - Source-level regression tests for the new helper and callers.

### Task 1: Add Failing Source Tests

**Files:**
- Create: `tests/map-composition-legend.test.mjs`

- [ ] **Step 1: Create the test file**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function extractFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      openBrace = source.indexOf('{', i);
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should exist`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }
  throw new Error(`${name} block was not closed`);
}

test('plot composition helper exposes visible cell coverage, empty cells, and mixed state', () => {
  const composition = extractFunctionBlock(appSource, 'plotCompositionForView');

  assert.match(composition, /counts\s*=\s*new Array\(CROPS\.length\)\.fill\(0\)/);
  assert.match(composition, /emptyCells/);
  assert.match(composition, /totalVisibleCells/);
  assert.match(composition, /nonZeroCropCount/);
  assert.match(composition, /isMixed/);
  assert.match(composition, /percentages/);
  assert.match(composition, /maskIntersects\(v,\s*viewMonths\)/);
});

test('dominant crop remains a compatibility wrapper over composition metadata', () => {
  const dominant = extractFunctionBlock(appSource, 'dominantCropForView');

  assert.match(dominant, /plotCompositionForView\(idx\)/);
  assert.doesNotMatch(dominant, /new Array\(CROPS\.length\)\.fill\(0\)/);
});

test('map style no longer fills mixed plots with the dominant crop color', () => {
  const style = extractFunctionBlock(appSource, 'plotStyle');

  assert.match(style, /plotCompositionForView\(idx\)/);
  assert.match(style, /composition\.isMixed/);
  assert.match(style, /--mixed-fill/);
  assert.doesNotMatch(style, /plotIsMixed\(idx\)/);
});

test('legend aggregates visible cell coverage rather than dominant plot counts', () => {
  const legend = extractFunctionBlock(appSource, 'updateLegend');

  assert.match(legend, /plotCompositionForView\(plot\.idx\)/);
  assert.match(legend, /visibleCellsByCrop/);
  assert.match(legend, /totalVisibleCells/);
  assert.doesNotMatch(legend, /tally\[cropIdx\]\+\+/);
  assert.doesNotMatch(legend, /dominantCropForView\(plot\.idx\)/);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
node --test tests/map-composition-legend.test.mjs
```

Expected: FAIL because `plotCompositionForView` and mixed legend aggregation do not exist yet.

### Task 2: Implement Composition Helper

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add `plotCompositionForView` near `cellVisibleCrops`**

Implementation outline:

```js
function plotCompositionForView(idx, viewMonths = state.viewMonths) {
  const p = state.plots[idx];
  const gridCells = GRID * GRID;
  const counts = new Array(CROPS.length).fill(0);
  if (!p || !p.cells) {
    return {
      crop: null,
      cropIdx: -1,
      counts,
      percentages: new Array(CROPS.length).fill(0),
      totalVisibleCells: 0,
      emptyCells: gridCells,
      nonZeroCropCount: 0,
      isMixed: false,
    };
  }

  for (let c = 0; c < CROPS.length; c += 1) {
    const cells = p.cells[c] || [];
    for (let i = 0; i < cells.length; i += 1) {
      const v = cells[i];
      if (v && maskIntersects(v, viewMonths)) counts[c] += 1;
    }
  }

  const totalVisibleCells = counts.reduce((sum, n) => sum + n, 0);
  const emptyCells = Math.max(0, gridCells - totalVisibleCells);
  const percentages = counts.map(n => totalVisibleCells ? n / totalVisibleCells : 0);
  const max = Math.max(...counts);
  const cropIdx = max > 0 ? counts.indexOf(max) : -1;
  const nonZeroCropCount = counts.filter(n => n > 0).length;

  return {
    crop: cropIdx >= 0 ? CROPS[cropIdx] : null,
    cropIdx,
    counts,
    percentages,
    totalVisibleCells,
    emptyCells,
    nonZeroCropCount,
    isMixed: nonZeroCropCount > 1,
  };
}
```

- [ ] **Step 2: Rewrite `dominantCropForView` as compatibility wrapper**

```js
function dominantCropForView(idx) {
  return plotCompositionForView(idx);
}
```

- [ ] **Step 3: Rewrite `plotIsMixed` to use composition**

```js
function plotIsMixed(idx) {
  return plotCompositionForView(idx).isMixed;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests/map-composition-legend.test.mjs tests/map-month-range-integration.test.mjs
```

Expected: new helper assertions may pass; map style and legend assertions still fail until Chunk 2.

- [ ] **Step 5: Commit helper and tests if green enough for this chunk**

```powershell
git add app.js tests/map-composition-legend.test.mjs
git commit -m "test: cover map composition source of truth"
```

---

## Chunk 2: Composition-Aware Map Rendering

### File Structure

- Modify: `app.js`
  - Add `plotCompositionBars` storage next to `plotRects` and `plotMarkers`.
  - Add helpers for mixed-plot segmented bar overlays.
  - Update `drawPlotsOnMap()` and `updateMapPlot(idx)` to create/update/remove bar overlays.
- Modify: `styles.css`
  - Add CSS variables/classes for mixed plot base and segmented bars.

### Task 3: Add Mixed Plot Styling

**Files:**
- Modify: `styles.css`
- Modify: `app.js`

- [ ] **Step 1: Add mixed styling variables**

In `styles.css`, define variables close to the existing map/legend variables:

```css
:root {
  --mixed-fill: rgba(255, 255, 255, 0.34);
  --mixed-stroke: rgba(255, 255, 255, 0.92);
}
```

If theme variables already exist for `--empty-fill` and `--empty-stroke`, add these beside them for light and dark themes.

- [ ] **Step 2: Update `plotStyle(idx)`**

Use `plotCompositionForView(idx)`:

```js
function plotStyle(idx){
  const composition = plotCompositionForView(idx);
  const { crop } = composition;
  const isCurrent = idx === state.plotIdx;
  if (crop){
    if (composition.isMixed) {
      return {
        color: isCurrent ? '#F2C84B' : getCss('--mixed-stroke'),
        weight: isCurrent ? 3 : 2,
        fillColor: getCss('--mixed-fill'),
        fillOpacity: 0.46,
        dashArray: isCurrent ? null : '4,3',
      };
    }
    return {
      color: isCurrent ? '#F2C84B' : crop.hex,
      weight: isCurrent ? 3 : 1.6,
      fillColor: crop.hex,
      fillOpacity: 0.65,
      dashArray: null,
    };
  }
  // Keep existing empty styling.
}
```

- [ ] **Step 3: Run focused test**

Run:

```powershell
node --test tests/map-composition-legend.test.mjs
```

Expected: map style test passes; legend test still fails.

### Task 4: Render Proportional Mixed Bars

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

- [ ] **Step 1: Track bar overlays**

Change:

```js
let map, plotRects = {}, plotMarkers = {};
```

to:

```js
let map, plotRects = {}, plotMarkers = {}, plotCompositionBars = {};
```

- [ ] **Step 2: Add bar HTML helper**

Add near map helpers:

```js
function compositionBarHtml(composition) {
  if (!composition || !composition.isMixed || composition.totalVisibleCells <= 0) return '';
  const segments = composition.counts.map((count, i) => {
    if (count <= 0) return '';
    const pct = Math.max(4, composition.percentages[i] * 100);
    return `<span class="mix-seg" style="width:${pct}%;background:${CROPS[i].hex}"></span>`;
  }).join('');
  return `<div class="mix-bar" aria-hidden="true">${segments}</div>`;
}
```

- [ ] **Step 3: Add create/update/remove helper**

```js
function updateCompositionBar(plot) {
  const existing = plotCompositionBars[plot.idx];
  const composition = plotCompositionForView(plot.idx);
  if (!composition.isMixed) {
    if (existing) {
      map.removeLayer(existing);
      delete plotCompositionBars[plot.idx];
    }
    return;
  }
  const html = compositionBarHtml(composition);
  if (existing) {
    existing.setIcon(L.divIcon({
      className: '',
      html,
      iconSize: [42, 10],
      iconAnchor: [21, 5],
    }));
    return;
  }
  plotCompositionBars[plot.idx] = L.marker([plot.centerLat, plot.centerLng], {
    icon: L.divIcon({
      className: '',
      html,
      iconSize: [42, 10],
      iconAnchor: [21, 5],
    }),
    interactive: false,
    keyboard: false,
  }).addTo(map);
}
```

- [ ] **Step 4: Wire into map redraw**

In `drawPlotsOnMap()`:

```js
Object.values(plotCompositionBars).forEach(m => map.removeLayer(m));
plotCompositionBars = {};
```

Then inside the `PLOTS.forEach` loop after marker creation:

```js
updateCompositionBar(plot);
```

In `updateMapPlot(idx)`:

```js
const plot = PLOTS[idx];
if (plot) updateCompositionBar(plot);
```

- [ ] **Step 5: Add CSS for bars**

```css
.mix-bar {
  width: 42px;
  height: 8px;
  display: flex;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.72);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.34);
}

.mix-seg {
  height: 100%;
  min-width: 3px;
  flex: 0 0 auto;
}
```

- [ ] **Step 6: Run regression tests**

Run:

```powershell
node --test tests/map-composition-legend.test.mjs tests/map-month-range-integration.test.mjs tests/month-view-utils.test.mjs tests/map-zoom-config.test.mjs tests/translations.test.mjs
```

Expected: all tests pass except legend assertions if Chunk 3 is not done yet.

- [ ] **Step 7: Commit map rendering**

```powershell
git add app.js styles.css tests/map-composition-legend.test.mjs
git commit -m "feat: show mixed crop composition on map"
```

---

## Chunk 3: Cell-Coverage Legend

### File Structure

- Modify: `app.js`
  - Rewrite `updateLegend()` to aggregate visible cells.
  - Change legend heading text from generic `Legend` to coverage-specific copy.
- Modify: `data.js`
  - Add or update translation strings if the legend needs new labels.
- Modify: `styles.css`
  - Adjust legend count text for percent and secondary count if needed.
- Modify: `tests/map-composition-legend.test.mjs`
  - Extend source assertions for percent/cell labels.

### Task 5: Rewrite Legend Aggregation

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace dominant plot tally with cell coverage**

Implementation outline:

```js
function updateLegend(){
  const root = document.getElementById('map-legend-rows');
  if (!root) return;

  const visibleCellsByCrop = new Array(CROPS.length).fill(0);
  const plotsContainingCrop = new Array(CROPS.length).fill(0);
  let emptyVisibleCells = 0;
  let totalVisibleCells = 0;

  PLOTS.forEach(plot=>{
    const composition = plotCompositionForView(plot.idx);
    totalVisibleCells += GRID * GRID;
    emptyVisibleCells += composition.emptyCells;
    composition.counts.forEach((count, i) => {
      visibleCellsByCrop[i] += count;
      if (count > 0) plotsContainingCrop[i] += 1;
    });
  });

  const coveragePct = (count) => totalVisibleCells ? Math.round((count / totalVisibleCells) * 100) : 0;
  root.innerHTML = '';

  // Unpainted cells row.
  // Crop rows use visibleCellsByCrop and plotsContainingCrop.
}
```

- [ ] **Step 2: Render rows with explicit units**

Use labels like:

```js
<span class="lgd-ct">${coveragePct(count)}%</span>
<span class="lgd-sub">${count} cells · ${plotsContainingCrop[i]} plots</span>
```

Keep this compact. If `lgd-sub` does not fit the current legend, show only percent and cell count.

- [ ] **Step 3: Update legend title copy**

In `applyLang()`, change:

```js
document.getElementById('lgd-head-txt').textContent = tr('legend');
```

to either:

```js
document.getElementById('lgd-head-txt').textContent = tr('legendCoverage');
```

or a direct English-only string if the project has already removed translation requirements for this area.

- [ ] **Step 4: Add translations if using `tr('legendCoverage')`**

In `data.js`, add:

```js
legendCoverage: 'Visible crop coverage',
unpainted: 'Unpainted cells',
```

Add Tagalog/Ilocano values only if those language modes remain active in the app.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/map-composition-legend.test.mjs tests/translations.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit legend rewrite**

```powershell
git add app.js data.js styles.css tests/map-composition-legend.test.mjs
git commit -m "feat: summarize legend by crop coverage"
```

---

## Chunk 4: Browser Verification and Cleanup

### File Structure

- No planned source changes unless visual verification reveals overlap or readability issues.

### Task 6: Verify in Browser

**Files:**
- Read/verify: `taniman.html`

- [ ] **Step 1: Start a local static server**

Run:

```powershell
Start-Process -WindowStyle Hidden -FilePath python -ArgumentList '-m','http.server','4173' -WorkingDirectory 'D:\Repositories\thesis-digimap'
```

- [ ] **Step 2: Open app**

Open:

```text
http://localhost:4173/taniman.html
```

- [ ] **Step 3: Verify map/legend behavior**

Manual checks:

- Mixed plots do not appear as a single dominant crop fill.
- Mixed plots show segmented crop bars.
- Single-crop plots retain direct crop color.
- Legend title says coverage, not generic plot legend.
- Legend percentages and counts change when the map month range changes.
- Current selected plot border remains yellow and readable.

- [ ] **Step 4: Run full Node regression suite**

Run:

```powershell
node --test tests/month-view-utils.test.mjs tests/map-month-range-integration.test.mjs tests/map-composition-legend.test.mjs tests/map-zoom-config.test.mjs tests/translations.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Process hygiene**

Because this task may run a local server and browser automation, use the process-hygiene skill before finishing. Do not kill the local server if the user wants it left running.

- [ ] **Step 6: Final commit if verification caused polish changes**

```powershell
git add app.js styles.css data.js tests/map-composition-legend.test.mjs
git commit -m "fix: polish crop composition map display"
```
