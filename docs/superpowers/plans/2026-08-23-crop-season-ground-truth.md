# Crop Season Ground Truth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-month crop masks with recurring planting-to-harvest season labels for lettuce, potato, and carrot, with ML-ready georeferenced export rows for Sentinel-2 training.

**Architecture:** Add a small pure `season-utils.js` module for recurring `MM-DD` validation, interval math, season visibility, and cell geometry. Then migrate app state from crop-indexed month masks to `plot.seasons[]` records keyed by `cropId`, while keeping the current crop/date/paint workflow. Export one authoritative `seasons.csv` row per `season_id + cell_idx` with WGS84 cell bounds and keep Supabase storage as JSONB seasons.

**Tech Stack:** Static HTML/CSS/JS, Leaflet, JSZip/FileSaver, Supabase JS UMD, Node built-in test runner (`node --test`), Tauri static bundle shares these files.

---

## File Structure

- Create `season-utils.js`: pure CommonJS/browser-compatible utilities for `MM-DD` validation, recurring interval overlap, shortcut ranges, season ID generation helper, and plot cell WGS84 geometry.
- Create `tests/season-utils.test.mjs`: focused tests for date ranges, shortcuts, overlap preservation semantics, crop constants, and cell geometry.
- Modify `data.js`: crop list becomes exactly lettuce, potato, carrot.
- Modify `taniman.html`: replace month-track schedule picker markup with date-range controls and shortcut buttons.
- Modify `calendar.js`: replace paint-month schedule interactions with paint-season date controls; keep map scrubber behavior month-based for first implementation by deriving month visibility from date windows.
- Modify `app.js`: plot state uses `seasons`; painting adds cells to a matching season record; rendering/legend/progress/export read seasons; legacy `cells` data resets or converts only unambiguous target crops.
- Modify `supabase-sync.js`: read/write `seasons` JSONB instead of `cells`; tolerate older rows by returning empty seasons.
- Modify `docs/supabase-setup.sql`: drop/recreate `plots` table with `seasons jsonb not null default '[]'`.
- Modify `src-tauri/scripts/prepare-dist.mjs`: include `season-utils.js` in the desktop static bundle.
- Modify or add source tests under `tests/`: update old month-mask assumptions and add export/source assertions.
- Optionally modify `styles.css`: compact styling for date fields and shortcut controls.

---

## Chunk 1: Pure Season Utilities And Crop Targets

### Task 1: Add recurring season utility tests

**Files:**
- Create: `tests/season-utils.test.mjs`
- Create: `season-utils.js`

- [ ] **Step 1: Write failing tests for date parsing and inclusivity**

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseMmdd,
  isValidMmdd,
  compareMmdd,
  rangeWrapsYear,
  seasonIncludesMmdd,
} = require('../season-utils.js');

test('validates recurring month-day values', () => {
  assert.deepEqual(parseMmdd('06-20'), { month: 6, day: 20, ordinal: 171 });
  assert.equal(isValidMmdd('02-29'), true);
  assert.equal(isValidMmdd('02-30'), false);
  assert.equal(isValidMmdd('00-10'), false);
  assert.equal(isValidMmdd('13-01'), false);
});

test('normal and same-day ranges are inclusive', () => {
  assert.equal(rangeWrapsYear('06-20', '07-10'), false);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '07-10'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-21'), false);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/season-utils.test.mjs`  
Expected: FAIL because `season-utils.js` does not exist or exports are missing.

- [ ] **Step 3: Implement minimal date utilities**

```js
(function(root) {
  const MONTH_DAYS = [31,29,31,30,31,30,31,31,30,31,30,31];
  const MONTH_OFFSETS = [0,31,60,91,121,152,182,213,244,274,305,335];

  function parseMmdd(value) {
    if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return null;
    const month = Number(value.slice(0, 2));
    const day = Number(value.slice(3, 5));
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > MONTH_DAYS[month - 1]) return null;
    return { month, day, ordinal: MONTH_OFFSETS[month - 1] + day };
  }
  function isValidMmdd(value) { return !!parseMmdd(value); }
  function compareMmdd(a, b) { return parseMmdd(a).ordinal - parseMmdd(b).ordinal; }
  function rangeWrapsYear(start, end) { return compareMmdd(start, end) > 0; }
  function seasonIncludesMmdd(start, end, value) {
    const s = parseMmdd(start), e = parseMmdd(end), v = parseMmdd(value);
    if (!s || !e || !v) return false;
    return s.ordinal <= e.ordinal
      ? v.ordinal >= s.ordinal && v.ordinal <= e.ordinal
      : v.ordinal >= s.ordinal || v.ordinal <= e.ordinal;
  }
  const api = { MONTH_DAYS, parseMmdd, isValidMmdd, compareMmdd, rangeWrapsYear, seasonIncludesMmdd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_SEASONS = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run utility tests**

Run: `node --test tests/season-utils.test.mjs`  
Expected: PASS for the first date utility tests.

- [ ] **Step 5: Commit**

```bash
git add season-utils.js tests/season-utils.test.mjs
git commit -m "test: add recurring season date utilities"
```

### Task 2: Add shortcuts, overlap, and cell geometry utilities

**Files:**
- Modify: `season-utils.js`
- Modify: `tests/season-utils.test.mjs`

- [ ] **Step 1: Write failing tests for shortcuts and wrapped overlap**

```js
const {
  shortcutRange,
  seasonsOverlap,
  cellGeometry,
  seasonExportRows,
} = require('../season-utils.js');

test('month shortcuts produce exact month-day ranges', () => {
  assert.deepEqual(shortcutRange(2, 'whole'), { start: '02-01', end: '02-29' });
  assert.deepEqual(shortcutRange(6, 'early'), { start: '06-01', end: '06-10' });
  assert.deepEqual(shortcutRange(6, 'mid'), { start: '06-11', end: '06-20' });
  assert.deepEqual(shortcutRange(6, 'late'), { start: '06-21', end: '06-30' });
});

test('normal and wrapped date ranges can overlap without being rejected', () => {
  assert.equal(seasonsOverlap('06-20', '07-10', '07-01', '07-20'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '04-01', '04-30'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '06-01', '06-30'), false);
});

test('cell geometry derives WGS84 center and bounds from plot grid', () => {
  const plot = { latS: 10, latN: 20, lngW: 100, lngE: 110 };
  assert.deepEqual(cellGeometry(plot, 0, 50), {
    cell_row: 0, cell_col: 0,
    lat_s: 19.8, lat_n: 20,
    lng_w: 100, lng_e: 100.2,
    center_lat: 19.9, center_lng: 100.1,
  });
});

test('season export rows preserve overlapping same-crop windows per season and cell', () => {
  const plot = { latS: 10, latN: 20, lngW: 100, lngE: 110 };
  const rows = seasonExportRows({
    plotIdx: 7,
    plot,
    grid: 50,
    farmerId: 'F-001',
    plotData: {
      seasons: [
        { id: 's1', cropId: 'lettuce', start: '06-20', end: '07-10', cells: [0] },
        { id: 's2', cropId: 'lettuce', start: '11-15', end: '05-05', cells: [0] },
      ],
    },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.season_id), ['s1', 's2']);
  assert.equal(rows[1].wraps_year, true);
  assert.equal(rows[0].cell_idx, rows[1].cell_idx);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/season-utils.test.mjs`  
Expected: FAIL for missing `shortcutRange`, `seasonsOverlap`, and `cellGeometry`.

- [ ] **Step 3: Implement shortcut, overlap, and geometry helpers**

Add helpers to `season-utils.js`:

```js
function pad2(n) { return String(n).padStart(2, '0'); }
function mmdd(month, day) { return `${pad2(month)}-${pad2(day)}`; }
function shortcutRange(month, kind) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const last = MONTH_DAYS[month - 1];
  if (kind === 'whole') return { start: mmdd(month, 1), end: mmdd(month, last) };
  if (kind === 'early') return { start: mmdd(month, 1), end: mmdd(month, 10) };
  if (kind === 'mid') return { start: mmdd(month, 11), end: mmdd(month, 20) };
  if (kind === 'late') return { start: mmdd(month, 21), end: mmdd(month, last) };
  return null;
}
function rangeSegments(start, end) {
  const s = parseMmdd(start), e = parseMmdd(end);
  if (!s || !e) return [];
  return s.ordinal <= e.ordinal ? [[s.ordinal, e.ordinal]] : [[s.ordinal, 366], [1, e.ordinal]];
}
function seasonsOverlap(aStart, aEnd, bStart, bEnd) {
  return rangeSegments(aStart, aEnd).some(([as, ae]) =>
    rangeSegments(bStart, bEnd).some(([bs, be]) => as <= be && bs <= ae));
}
function roundCoord(n) { return Number(n.toFixed(7)); }
function cellGeometry(plot, cellIdx, grid) {
  const cell_row = Math.floor(cellIdx / grid);
  const cell_col = cellIdx % grid;
  const latStep = (plot.latN - plot.latS) / grid;
  const lngStep = (plot.lngE - plot.lngW) / grid;
  const lat_n = plot.latN - cell_row * latStep;
  const lat_s = lat_n - latStep;
  const lng_w = plot.lngW + cell_col * lngStep;
  const lng_e = lng_w + lngStep;
  return {
    cell_row, cell_col,
    lat_s: roundCoord(lat_s), lat_n: roundCoord(lat_n),
    lng_w: roundCoord(lng_w), lng_e: roundCoord(lng_e),
    center_lat: roundCoord((lat_s + lat_n) / 2),
    center_lng: roundCoord((lng_w + lng_e) / 2),
  };
}
function seasonExportRows({ plotIdx, plot, plotData, grid, farmerId = '' }) {
  const rows = [];
  for (const season of plotData.seasons || []) {
    if (!isValidMmdd(season.start) || !isValidMmdd(season.end)) continue;
    for (const cellIdx of season.cells || []) {
      const g = cellGeometry(plot, cellIdx, grid);
      rows.push({
        plot_idx: plotIdx,
        season_id: season.id,
        cell_idx: cellIdx,
        ...g,
        crop_id: season.cropId,
        start_mmdd: season.start,
        end_mmdd: season.end,
        wraps_year: rangeWrapsYear(season.start, season.end),
        farmer_id: farmerId,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Export the new helpers and run tests**

Run: `node --test tests/season-utils.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add season-utils.js tests/season-utils.test.mjs
git commit -m "feat: add crop season range helpers"
```

### Task 3: Update crop targets and load utility script

**Files:**
- Modify: `data.js`
- Modify: `taniman.html`
- Modify: `src-tauri/scripts/prepare-dist.mjs`
- Modify: `tests/translations.test.mjs` or create `tests/crop-targets.test.mjs`

- [ ] **Step 1: Write failing crop target test**

Create `tests/crop-targets.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const prepareDistSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

test('target crops are exactly lettuce, potato, carrot', () => {
  assert.match(dataSource, /id:'lettuce'/);
  assert.match(dataSource, /id:'potato'/);
  assert.match(dataSource, /id:'carrot'/);
  assert.doesNotMatch(dataSource, /id:'cabbage'|id:'wombok'/);
});

test('season utilities load before app startup', () => {
  assert.ok(htmlSource.indexOf('season-utils.js') > -1);
  assert.ok(htmlSource.indexOf('season-utils.js') < htmlSource.indexOf('app.js'));
});

test('desktop static bundle includes season utilities', () => {
  assert.match(prepareDistSource, /season-utils\.js/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/crop-targets.test.mjs`  
Expected: FAIL because lettuce/season-utils are not present and old crops remain.

- [ ] **Step 3: Change crop list**

Replace `window.CROPS` in `data.js` with:

```js
window.CROPS = [
  { id:'lettuce', hex:'#22C55E', emoji:'🥬',
    name:{ en:'Lettuce', tl:'Letsugas', il:'Letsugas' } },
  { id:'potato',  hex:'#FFC629', emoji:'🥔',
    name:{ en:'Potato',  tl:'Patatas',  il:'Patatas' } },
  { id:'carrot',  hex:'#FF6A1F', emoji:'🥕',
    name:{ en:'Carrot',  tl:'Karot',    il:'Karot' } },
];
```

- [ ] **Step 4: Load `season-utils.js` in HTML**

In `taniman.html`, add:

```html
<script src="season-utils.js"></script>
```

after `month-view-utils.js` and before `app.js`.

- [ ] **Step 5: Include `season-utils.js` in the desktop static bundle**

In `src-tauri/scripts/prepare-dist.mjs`, add `season-utils.js` to the explicit `FILES` list beside the other runtime scripts.

- [ ] **Step 6: Run crop target test**

Run: `node --test tests/crop-targets.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add data.js taniman.html src-tauri/scripts/prepare-dist.mjs tests/crop-targets.test.mjs
git commit -m "feat: set deployed target crops"
```

---

## Chunk 2: Season-Based State, Painting, And Rendering

### Task 4: Add season data access tests by source inspection

**Files:**
- Create: `tests/season-state-source.test.mjs`
- Modify: `app.js`
- Modify: `tests/map-composition-legend.test.mjs`

- [ ] **Step 1: Write failing source tests for season state**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('plot state stores seasons instead of crop-index month mask cells', () => {
  assert.match(appSource, /function emptySeasons\(/);
  assert.match(appSource, /seasons:\s*emptySeasons\(\)/);
  assert.doesNotMatch(appSource, /function emptyCells\(\)/);
});

test('painting adds cropId date seasons and does not OR month masks', () => {
  assert.match(appSource, /function addCellsToPaintSeason/);
  assert.match(appSource, /cropId:\s*crop\.id/);
  assert.doesNotMatch(appSource, /p\.cells\[state\.crop\]\[k\]\s*\|=/);
});

test('erase removes cells from all seasons and prunes empty seasons', () => {
  assert.match(appSource, /function eraseCellsFromSeasons/);
  assert.match(appSource, /season\.cells\.filter/);
  assert.match(appSource, /p\.seasons\s*=\s*\(p\.seasons\s*\|\|\s*\[\]\)\.filter/);
});
```

- [ ] **Step 2: Run source test and verify failure**

Run: `node --test tests/season-state-source.test.mjs`  
Expected: FAIL while `app.js` still uses `emptyCells()` and `p.cells`.

- [ ] **Step 3: Import season helpers and add state fields**

In `app.js`, near month helper imports:

```js
const SeasonUtils = window.TANIMAN_SEASONS;
const {
  isValidMmdd,
  rangeWrapsYear,
  seasonIncludesMmdd,
  seasonsOverlap,
  cellGeometry,
  seasonExportRows,
} = SeasonUtils;
```

Update default state:

```js
paintStartDate: '01-01',
paintEndDate: '12-31',
```

- [ ] **Step 4: Replace empty plot initialization**

Add:

```js
function emptySeasons() { return []; }
function newSeasonId() {
  return 'season_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
```

`ensurePlot()` should create:

```js
{ seasons: emptySeasons(), farmerId:'', farmer:'', note:'', photos:[] }
```

For loaded plots:

```js
if (!Array.isArray(p.seasons)) p.seasons = [];
delete p.cells;
delete p.labels;
```

Because remote data is disposable, do not attempt a risky crop-index migration.

- [ ] **Step 5: Update save/load serialization**

Remove typed-array conversion for `cells`. Persist `seasons` as plain JSON.

- [ ] **Step 6: Add `addCellsToPaintSeason()` and broad erase**

```js
function activePaintSeasonData() {
  const crop = CROPS[state.crop];
  if (!crop || !isValidMmdd(state.paintStartDate) || !isValidMmdd(state.paintEndDate)) return null;
  return { cropId: crop.id, start: state.paintStartDate, end: state.paintEndDate };
}
function addCellsToPaintSeason(p, cellIds) {
  const data = activePaintSeasonData();
  if (!data) return false;
  let season = p.seasons.find(s =>
    s.cropId === data.cropId && s.start === data.start && s.end === data.end);
  const now = new Date().toISOString();
  if (!season) {
    season = { id: newSeasonId(), ...data, cells: [], createdAt: now, updatedAt: now };
    p.seasons.push(season);
  }
  const seen = new Set(season.cells);
  cellIds.forEach(id => seen.add(id));
  season.cells = [...seen].sort((a, b) => a - b);
  season.updatedAt = now;
  return true;
}
function eraseCellsFromSeasons(p, cellIds) {
  const remove = new Set(cellIds);
  for (const season of p.seasons || []) {
    season.cells = (season.cells || []).filter(cellIdx => !remove.has(cellIdx));
    season.updatedAt = new Date().toISOString();
  }
  p.seasons = (p.seasons || []).filter(season => season.cells && season.cells.length);
  return true;
}
```

- [ ] **Step 7: Update the `paintAt()` branch**

Collect brushed cell IDs first. If brush is erase, call `eraseCellsFromSeasons(p, cellIds)`. Otherwise, call `addCellsToPaintSeason(p, cellIds)`.

- [ ] **Step 8: Do not commit yet**

Run: `node --test tests/season-state-source.test.mjs`  
Expected: targeted state/paint source expectations PASS, but broader app tests may still fail because render/export readers are migrated in Task 5.

Do not commit an app state change while runtime readers still assume `p.cells`.

### Task 5: Update render queries, undo, clear, progress, and roster to read seasons

**Files:**
- Modify: `app.js`
- Modify: `tests/map-composition-legend.test.mjs`
- Modify: `tests/map-month-range-integration.test.mjs`
- Modify: `tests/season-state-source.test.mjs`

- [ ] **Step 1: Add failing source tests for rendering via seasons**

```js
test('visible crop calculations read seasons and active view months', () => {
  assert.match(appSource, /function cellVisibleCropIds/);
  assert.match(appSource, /seasonIntersectsViewMonths/);
  assert.doesNotMatch(appSource, /p\.cells\[c\]\[cellIdx\]/);
});

test('plot details schedule summary renders season ranges', () => {
  assert.match(appSource, /function renderScheduleSummary/);
  assert.match(appSource, /season\.start/);
  assert.match(appSource, /season\.end/);
});
```

- [ ] **Step 2: Run source test and verify failure**

Run: `node --test tests/season-state-source.test.mjs`  
Expected: FAIL until render helpers are replaced.

- [ ] **Step 3: Add season query helpers**

```js
function seasonIntersectsViewMonths(season, viewMonths = state.viewMonths) {
  for (let m = 0; m < 12; m++) {
    if (!(viewMonths & (1 << m))) continue;
    const start = `${String(m + 1).padStart(2, '0')}-01`;
    const end = `${String(m + 1).padStart(2, '0')}-${String(SeasonUtils.MONTH_DAYS[m]).padStart(2, '0')}`;
    if (seasonsOverlap(season.start, season.end, start, end)) return true;
  }
  return false;
}
function cellVisibleCropIds(p, cellIdx, viewMonths = state.viewMonths) {
  const out = [];
  const seen = new Set();
  for (const season of p.seasons || []) {
    if (!season.cells || !season.cells.includes(cellIdx)) continue;
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    if (!seen.has(season.cropId)) {
      seen.add(season.cropId);
      out.push(season.cropId);
    }
  }
  return out;
}
function cropIndexFromId(cropId) {
  return CROPS.findIndex(c => c.id === cropId);
}
function cellVisibleCrops(p, cellIdx) {
  return cellVisibleCropIds(p, cellIdx).map(cropIndexFromId).filter(i => i >= 0);
}
```

- [ ] **Step 4: Update `plotCompositionForView`, `plotHasPaint`, progress, legend, roster**

Count unique visible crop/cell pairs from `p.seasons`, not `p.cells`. Preserve existing return shape for map rendering.

Also update existing tests that inspect `plotCompositionForView`, especially `tests/map-composition-legend.test.mjs`, so they assert season/date helpers instead of month-mask array internals.

- [ ] **Step 5: Update undo/redo snapshots**

Replace typed-array snapshots with deep JSON snapshots:

```js
function cloneSeasons(seasons) {
  return JSON.parse(JSON.stringify(seasons || []));
}
```

Undo entries should store `{ plotIdx, seasons: cloneSeasons(p.seasons) }`.

- [ ] **Step 6: Update clear behavior**

Replace `p.cells = emptyCells()` with `p.seasons = emptySeasons()`.

- [ ] **Step 7: Update plot details schedule summary**

Replace the 12-month grid in `renderScheduleSummary()` with a compact per-crop list of season ranges, for example `Lettuce · 06-20-07-10`. If there are no valid seasons, keep the current empty state.

- [ ] **Step 8: Run source and existing tests**

Run: `node --test tests/season-state-source.test.mjs tests/map-month-range-integration.test.mjs tests/map-composition-legend.test.mjs`  
Expected: season source tests PASS; update old month-range assertions if they now intentionally reference legacy code.

- [ ] **Step 9: Commit the complete state/render migration**

```bash
git add app.js tests/season-state-source.test.mjs tests/map-month-range-integration.test.mjs tests/map-composition-legend.test.mjs
git commit -m "feat: render crop seasons from painted cells"
```

---

## Chunk 3: Date Range UI

### Task 6: Replace schedule picker markup with date controls

**Files:**
- Modify: `taniman.html`
- Modify: `styles.css`
- Modify: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Write failing HTML source test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

test('schedule UI exposes exact month-day fields and shortcuts', () => {
  assert.match(htmlSource, /id="season-start"/);
  assert.match(htmlSource, /id="season-end"/);
  assert.match(htmlSource, /data-season-shortcut="whole"/);
  assert.match(htmlSource, /data-season-shortcut="early"/);
  assert.match(htmlSource, /data-season-shortcut="mid"/);
  assert.match(htmlSource, /data-season-shortcut="late"/);
  assert.doesNotMatch(htmlSource, /id="sched-track"/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/season-ui-source.test.mjs`  
Expected: FAIL while old `sched-track` exists.

- [ ] **Step 3: Replace schedule-bar markup**

Use compact controls:

```html
<div class="season-fields">
  <label>Start <input id="season-start" inputmode="numeric" maxlength="5" placeholder="MM-DD"></label>
  <label>End <input id="season-end" inputmode="numeric" maxlength="5" placeholder="MM-DD"></label>
  <select id="season-month" aria-label="Shortcut month"></select>
</div>
<div class="sched-quick">
  <button data-season-shortcut="whole">Whole</button>
  <button data-season-shortcut="early">Early</button>
  <button data-season-shortcut="mid">Mid</button>
  <button data-season-shortcut="late">Late</button>
</div>
```

- [ ] **Step 4: Add CSS for compact date controls**

Add styles near schedule CSS. Keep mobile layout stable; inputs should be at least 44px high on touch screens and not overflow the existing panel.

- [ ] **Step 5: Run UI source test**

Run: `node --test tests/season-ui-source.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add taniman.html styles.css tests/season-ui-source.test.mjs
git commit -m "feat: add crop season date controls"
```

### Task 7: Wire date controls in calendar.js

**Files:**
- Modify: `calendar.js`
- Modify: `app.js`
- Modify: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Add failing source tests for calendar wiring**

```js
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');

test('calendar writes active paint season dates', () => {
  assert.match(calendarSource, /function setPaintSeasonRange/);
  assert.match(calendarSource, /state\.paintStartDate/);
  assert.match(calendarSource, /state\.paintEndDate/);
  assert.match(calendarSource, /shortcutRange/);
  assert.doesNotMatch(calendarSource, /function buildScheduleTrack/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/season-ui-source.test.mjs`  
Expected: FAIL while old schedule track code remains.

- [ ] **Step 3: Import season helpers in calendar.js**

Extend `window.TANIMAN` exposure in `app.js` to include `SeasonUtils`, `isValidMmdd`, and active date fields if needed.

In `calendar.js`, read:

```js
const { state, CROPS, MONTH_FULL_LONG, tr, SeasonUtils } = window.TANIMAN;
const { isValidMmdd, shortcutRange } = SeasonUtils;
```

- [ ] **Step 4: Replace schedule track functions**

Remove `buildScheduleTrack`, `wireSchedulePicker`, `setRange`, and quick season month-mask code. Add:

```js
function setPaintSeasonRange(start, end) {
  state.paintStartDate = start;
  state.paintEndDate = end;
  updateScheduleReadout();
  window.TANIMAN.schedSave();
}
function updateScheduleReadout() {
  const el = document.getElementById('sched-readout');
  const crop = CROPS[state.crop];
  const valid = isValidMmdd(state.paintStartDate) && isValidMmdd(state.paintEndDate);
  el.innerHTML =
    `<span class="crop-dot" style="background:${crop.hex}"></span>` +
    `<span>${crop.name[state.lang]||crop.name.en} · </span>` +
    `<span class="rng">${valid ? `${state.paintStartDate}-${state.paintEndDate}` : 'Invalid date'}</span>`;
}
```

- [ ] **Step 5: Wire inputs and shortcuts**

Populate `season-month` with January-December. On shortcut click, call `shortcutRange(Number(monthSelect.value), kind)` and update both inputs/state.

- [ ] **Step 6: Keep map scrubber working**

Do not remove `buildScrubberTrack`, `wireScrubber`, `setViewMonths`, or hidden-brush map logic yet. Update hidden brush text only if it references `paintMonths`; otherwise remove the warning until a date-aware date filter exists.

- [ ] **Step 7: Run UI/source tests**

Run: `node --test tests/season-ui-source.test.mjs tests/crop-targets.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app.js calendar.js tests/season-ui-source.test.mjs
git commit -m "feat: wire crop season date picker"
```

---

## Chunk 4: ML Export And Supabase Reset

### Task 8: Add export tests for seasons.csv and WGS84 geometry

**Files:**
- Modify: `tests/season-state-source.test.mjs`
- Modify: `app.js`
- Modify: `season-utils.js`
- Modify: `tests/season-utils.test.mjs`

- [ ] **Step 1: Write failing source tests for export contract**

```js
test('export writes ML-ready seasons csv with georeferenced rows', () => {
  assert.match(appSource, /let seasonsCsv\s*=/);
  assert.match(appSource, /season_id,cell_idx,cell_row,cell_col,crop_id,start_mmdd,end_mmdd,wraps_year/);
  assert.match(appSource, /seasonExportRows,\s*\n\}\s*=\s*SeasonUtils/);
  assert.match(appSource, /seasonExportRows/);
  assert.match(appSource, /folder\.file\('seasons\.csv',\s*seasonsCsv\)/);
});

test('metadata documents recurring inclusive date windows', () => {
  assert.match(appSource, /schema_version:\s*4/);
  assert.match(appSource, /recurring annual/);
  assert.match(appSource, /inclusive/);
});
```

- [ ] **Step 2: Run source test and verify failure**

Run: `node --test tests/season-state-source.test.mjs`  
Expected: FAIL until export is rewritten.

- [ ] **Step 3: Rewrite export headers**

In `btn-save` handler, initialize:

```js
let seasonsCsv =
  'plot_idx,season_id,cell_idx,cell_row,cell_col,crop_id,start_mmdd,end_mmdd,wraps_year,center_lat,center_lng,lat_s,lat_n,lng_w,lng_e,farmer_id\n';
```

- [ ] **Step 4: Write one row per season/cell with `seasonExportRows()`**

Inside each plot loop:

```js
for (const row of seasonExportRows({ plotIdx: idx, plot, plotData: p, grid: GRID, farmerId })) {
  seasonsCsv += [
    row.plot_idx, row.season_id, row.cell_idx, row.cell_row, row.cell_col,
    row.crop_id, row.start_mmdd, row.end_mmdd, row.wraps_year,
    row.center_lat, row.center_lng, row.lat_s, row.lat_n, row.lng_w, row.lng_e,
    row.farmer_id,
  ].join(',') + '\n';
}
```

- [ ] **Step 5: Update label PNG rendering**

Use visible seasons for PNG colors:

```js
const present = cellVisibleCrops(p, cellIdx);
```

instead of reading `p.cells`.

- [ ] **Step 6: Update `plots.csv`, `labels.csv`, `metadata.json`**

Make `seasons.csv` authoritative. Keep compatibility files:

- `labels.csv`: one row per season/cell, similar to seasons but with crop name and plot metadata.
- `plots.csv`: summary counts by crop and total season rows.
- `metadata.json`: `schema_version: 4`, `date_encoding.type: "recurring annual MM-DD inclusive range"`, `coordinate_reference_system: "EPSG:4326"`, and `sentinel2_alignment_note`.

- [ ] **Step 7: Run export source tests**

Run: `node --test tests/season-state-source.test.mjs tests/season-utils.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app.js season-utils.js tests/season-state-source.test.mjs tests/season-utils.test.mjs
git commit -m "feat: export georeferenced crop seasons"
```

### Task 9: Update Supabase sync and reset SQL

**Files:**
- Modify: `supabase-sync.js`
- Modify: `docs/supabase-setup.sql`
- Create: `docs/supabase-reset-seasons.sql` if keeping setup file less destructive is clearer
- Create or modify: `tests/supabase-season-source.test.mjs`

- [ ] **Step 1: Write failing source tests**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const syncSource = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');
const sqlSource = await readFile(new URL('../docs/supabase-setup.sql', import.meta.url), 'utf8');

test('supabase sync stores seasons json instead of cells arrays', () => {
  assert.match(syncSource, /seasons:\s*Array\.isArray\(plotData\.seasons\)/);
  assert.match(syncSource, /Array\.isArray\(row\.seasons\)/);
  assert.doesNotMatch(syncSource, /new Uint16Array/);
});

test('supabase setup resets plots with seasons jsonb', () => {
  assert.match(sqlSource, /drop table if exists public\.plots/);
  assert.match(sqlSource, /seasons\s+jsonb\s+not null\s+default '\[\]'/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/supabase-season-source.test.mjs`  
Expected: FAIL until sync/SQL are updated.

- [ ] **Step 3: Update sync row conversion**

In `plotToRow`:

```js
seasons: Array.isArray(plotData.seasons) ? plotData.seasons : [],
```

In `rowToPlot`:

```js
seasons: Array.isArray(row.seasons) ? row.seasons : [],
```

Remove `cells` typed-array handling.

- [ ] **Step 4: Update SQL**

Use a destructive reset because the user approved wiping Supabase:

```sql
drop table if exists public.plots cascade;

create table public.plots (
  plot_idx   integer      primary key,
  seasons    jsonb        not null default '[]',
  farmer_id  text         not null default '',
  farmer     text         not null default '',
  note       text         not null default '',
  photo_url  text,
  device_id  text         not null default '',
  updated_at timestamptz  not null default now()
);
```

Recreate RLS and storage policies as the current file does.

- [ ] **Step 5: Make policy setup rerunnable**

Before recreating policies, add:

```sql
drop policy if exists "public_read_write" on public.plots;
drop policy if exists "public_photo_upload" on storage.objects;
drop policy if exists "public_photo_read" on storage.objects;
```

Then recreate policies. Keep `insert into storage.buckets ... on conflict do nothing`.

- [ ] **Step 6: Run Supabase source tests**

Run: `node --test tests/supabase-season-source.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase-sync.js docs/supabase-setup.sql tests/supabase-season-source.test.mjs
git commit -m "feat: sync crop seasons to supabase"
```

---

## Chunk 5: Verification, Browser Smoke, And Deployment Instructions

### Task 10: Run complete automated tests

**Files:**
- No edits unless tests reveal intentional stale assertions.

- [ ] **Step 1: Run all Node tests**

Run: `node --test tests/*.test.mjs`  
Expected: PASS.

- [ ] **Step 2: Fix stale tests only if they contradict the approved spec**

Do not remove tests just because implementation changed. Rewrite assertions to the new season model.

- [ ] **Step 3: Commit any test maintenance**

```bash
git add tests
git commit -m "test: align app tests with crop seasons"
```

Skip commit if there are no changes.

### Task 11: Browser smoke test export flow

**Files:**
- Modify only if browser test exposes real issues.

- [ ] **Step 1: Start local static server**

Run: `python -m http.server 8080`  
Expected: server listens at `http://localhost:8080/`.

- [ ] **Step 2: Open deployed-page equivalent locally**

Open: `http://localhost:8080/taniman.html`

- [ ] **Step 3: Manually smoke test**

Actions:

1. Select Lettuce.
2. Enter `06-20` to `07-10`.
3. Paint one cell.
4. Select Potato.
5. Enter `08-01` to `10-20`.
6. Paint the same cell.
7. Export zip.

Expected:

- Canvas shows a painted/mixed cell.
- Export contains `seasons.csv`.
- `seasons.csv` has two rows for the same `plot_idx/cell_idx`, one lettuce and one potato.
- Rows include `center_lat`, `center_lng`, `lat_s`, `lat_n`, `lng_w`, `lng_e`.

- [ ] **Step 4: Stop local server**

Use Ctrl+C in the server terminal. Do not leave orphaned dev processes.

### Task 12: Final docs and Supabase/deployment instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README deployment and Supabase reset instructions**

Add concrete user instructions:

```md
### Reset Supabase for season schema

1. Open Supabase Dashboard.
2. Select the project used by `config.js`.
3. Open SQL Editor.
4. Paste the full contents of `docs/supabase-setup.sql`.
5. Run it. This wipes existing plot rows.
6. Reload the deployed app.
```

Also document `seasons.csv` as the ML ground truth export.

- [ ] **Step 2: Run final tests**

Run: `node --test tests/*.test.mjs`  
Expected: PASS.

- [ ] **Step 3: Commit README**

```bash
git add README.md
git commit -m "docs: document crop season export setup"
```

### Task 13: Process hygiene

**Files:**
- No edits expected.

- [ ] **Step 1: Use process hygiene before final handoff**

Because Node/browser tooling may have run, use the `process-hygiene` skill and inspect for stale `node.exe`, Vite, Playwright, or server processes. Do not kill an intentionally running server without user approval.

- [ ] **Step 2: Final status**

Report:

- commits made;
- tests run and results;
- local smoke result;
- Supabase reset file to run;
- deployment note: push to GitHub/Vercel updates the static deployed app.
