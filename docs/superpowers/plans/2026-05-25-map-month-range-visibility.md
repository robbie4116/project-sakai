# Map Month Range Visibility Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the map show all months, one month, or a month range, and automatically switch the map display after painting when the current display would hide the newly painted cells.

**Architecture:** Add a small browser/Node-compatible month-view utility module for pure month-mask behavior. Keep `app.js` responsible for plot data, rendering, and paint integration; keep `calendar.js` responsible for scrubber DOM interaction and display updates.

**Tech Stack:** Plain HTML/CSS/JavaScript, Leaflet, Node built-in `node:test`, no package manager dependency.

---

## Chunk 1: Month Mask Utilities

### Task 1: Add Pure Month-View Utility Module

**Files:**
- Create: `month-view-utils.js`
- Create: `tests/month-view-utils.test.mjs`
- Modify: `taniman.html`

- [ ] **Step 1: Write the failing utility tests**

Create `tests/month-view-utils.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const monthView = require('../month-view-utils.js');

const {
  ALL_MONTHS,
  monthsBetween,
  maskContains,
  maskIntersects,
  normalizeViewMonths,
  viewMonthFromMask,
  viewMonthsFromLegacy,
  maskToDisplayLabel,
  shouldAutoSwitchViewMonths,
  isBrushHiddenOnMap,
} = monthView;

test('month ranges support single, normal, and wrapped selections', () => {
  assert.equal(monthsBetween(0, 0), 1 << 0);
  assert.equal(monthsBetween(0, 1), (1 << 0) | (1 << 1));
  assert.equal(monthsBetween(11, 1), (1 << 11) | (1 << 0) | (1 << 1));
});

test('mask containment and intersection describe map visibility', () => {
  const janFeb = monthsBetween(0, 1);
  const febMar = monthsBetween(1, 2);
  const marApr = monthsBetween(2, 3);

  assert.equal(maskContains(janFeb, 1 << 0), true);
  assert.equal(maskContains(1 << 0, janFeb), false);
  assert.equal(maskIntersects(janFeb, febMar), true);
  assert.equal(maskIntersects(janFeb, marApr), false);
});

test('legacy single-month view state migrates into viewMonths', () => {
  assert.equal(viewMonthsFromLegacy(-1), ALL_MONTHS);
  assert.equal(viewMonthsFromLegacy(0), 1 << 0);
  assert.equal(viewMonthsFromLegacy(11), 1 << 11);
  assert.equal(viewMonthsFromLegacy(12), ALL_MONTHS);
});

test('new viewMonths is authoritative when both old and new fields exist', () => {
  assert.equal(normalizeViewMonths(monthsBetween(0, 1), 11), monthsBetween(0, 1));
});

test('invalid saved viewMonths values normalize safely', () => {
  assert.equal(normalizeViewMonths(undefined, -1), ALL_MONTHS);
  assert.equal(normalizeViewMonths('jan', 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(0, 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(4096, 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(0x1FFF, 0), ALL_MONTHS);
});

test('legacy mirror returns all, single month, or range sentinel', () => {
  assert.equal(viewMonthFromMask(ALL_MONTHS), -1);
  assert.equal(viewMonthFromMask(1 << 0), 0);
  assert.equal(viewMonthFromMask(monthsBetween(0, 1)), -2);
});

test('display labels distinguish all year, one month, ranges, and non-contiguous masks', () => {
  assert.equal(maskToDisplayLabel(ALL_MONTHS), 'All year');
  assert.equal(maskToDisplayLabel(1 << 0, { singleLong: true }), 'January');
  assert.equal(maskToDisplayLabel(monthsBetween(0, 1)), 'Jan-Feb');
  assert.equal(maskToDisplayLabel((1 << 0) | (1 << 2)), 'Jan, Mar');
});

test('painting auto-switches when map display does not fully cover brush months', () => {
  const janFeb = monthsBetween(0, 1);
  assert.equal(shouldAutoSwitchViewMonths(ALL_MONTHS, janFeb), false);
  assert.equal(shouldAutoSwitchViewMonths(janFeb, janFeb), false);
  assert.equal(shouldAutoSwitchViewMonths(1 << 0, janFeb), true);
  assert.equal(shouldAutoSwitchViewMonths(1 << 11, janFeb), true);
});

test('hidden brush indicator appears when map display does not fully cover brush months', () => {
  const janFeb = monthsBetween(0, 1);
  assert.equal(isBrushHiddenOnMap(ALL_MONTHS, janFeb), false);
  assert.equal(isBrushHiddenOnMap(janFeb, janFeb), false);
  assert.equal(isBrushHiddenOnMap(1 << 0, janFeb), true);
});
```

- [ ] **Step 2: Run utility tests to verify they fail**

Run: `node --test tests/month-view-utils.test.mjs`

Expected: FAIL with module-not-found for `month-view-utils.js`.

- [ ] **Step 3: Create the utility module**

Create `month-view-utils.js`:

```js
(function(root) {
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const ALL_MONTHS = 0xFFF;

  function monthsBetween(s, e) {
    let mask = 0;
    if (s <= e) {
      for (let i = s; i <= e; i += 1) mask |= (1 << i);
    } else {
      for (let i = s; i < 12; i += 1) mask |= (1 << i);
      for (let i = 0; i <= e; i += 1) mask |= (1 << i);
    }
    return mask;
  }

  function maskList(mask) {
    const out = [];
    for (let i = 0; i < 12; i += 1) if (mask & (1 << i)) out.push(i);
    return out;
  }

  function maskIntersects(a, b) {
    return ((a & b) & ALL_MONTHS) !== 0;
  }

  function maskContains(container, contained) {
    const a = container & ALL_MONTHS;
    const b = contained & ALL_MONTHS;
    return b !== 0 && (a & b) === b;
  }

  function viewMonthsFromLegacy(viewMonth) {
    return Number.isInteger(viewMonth) && viewMonth >= 0 && viewMonth <= 11
      ? (1 << viewMonth)
      : ALL_MONTHS;
  }

  function normalizeViewMonths(value, legacyViewMonth) {
    if (Number.isInteger(value)) {
      if (value > 0 && value <= ALL_MONTHS) return value & ALL_MONTHS;
      return ALL_MONTHS;
    }
    return viewMonthsFromLegacy(legacyViewMonth);
  }

  function viewMonthFromMask(mask) {
    const normalized = normalizeViewMonths(mask, -1);
    if (normalized === ALL_MONTHS) return -1;
    const months = maskList(normalized);
    return months.length === 1 ? months[0] : -2;
  }

  function contiguousSegments(months) {
    if (!months.length) return [];
    const segments = [[months[0], months[0]]];
    for (let i = 1; i < months.length; i += 1) {
      const last = segments[segments.length - 1];
      if (months[i] === last[1] + 1) last[1] = months[i];
      else segments.push([months[i], months[i]]);
    }
    if (segments.length > 1 && segments[0][0] === 0 && segments[segments.length - 1][1] === 11) {
      const first = segments.shift();
      segments[segments.length - 1][1] = first[1];
    }
    return segments;
  }

  function maskToDisplayLabel(mask, options = {}) {
    const normalized = normalizeViewMonths(mask, -1);
    if (normalized === ALL_MONTHS) return 'All year';
    const months = maskList(normalized);
    if (months.length === 1) return options.singleLong ? MONTH_LONG[months[0]] : MONTH_SHORT[months[0]];
    const segments = contiguousSegments(months);
    if (segments.length === 1) {
      const [start, end] = segments[0];
      return start === end ? MONTH_SHORT[start] : `${MONTH_SHORT[start]}-${MONTH_SHORT[end]}`;
    }
    return months.map((month) => MONTH_SHORT[month]).join(', ');
  }

  function shouldAutoSwitchViewMonths(viewMonths, paintMonths) {
    const normalizedView = normalizeViewMonths(viewMonths, -1);
    return normalizedView !== ALL_MONTHS && !maskContains(normalizedView, paintMonths);
  }

  function isBrushHiddenOnMap(viewMonths, paintMonths) {
    return shouldAutoSwitchViewMonths(viewMonths, paintMonths);
  }

  const api = {
    ALL_MONTHS,
    MONTH_SHORT,
    MONTH_LONG,
    monthsBetween,
    maskList,
    maskIntersects,
    maskContains,
    viewMonthsFromLegacy,
    normalizeViewMonths,
    viewMonthFromMask,
    maskToDisplayLabel,
    shouldAutoSwitchViewMonths,
    isBrushHiddenOnMap,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_MONTH_VIEW = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Load the utility before app startup**

Modify `taniman.html` so `month-view-utils.js` loads before `app.js`:

```html
<script src="data.js"></script>
<script src="config.js"></script>
<script src="month-view-utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="supabase-sync.js"></script>
<script src="app.js"></script>
<script src="calendar.js"></script>
```

- [ ] **Step 5: Run utility tests to verify they pass**

Run: `node --test tests/month-view-utils.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add month-view-utils.js tests/month-view-utils.test.mjs taniman.html
git commit -m "feat: add month view utilities"
```

## Chunk 2: App State and Rendering Integration

### Task 2: Make `viewMonths` the Canonical Display Filter

**Files:**
- Modify: `app.js`
- Test: `tests/map-month-range-integration.test.mjs`

- [ ] **Step 1: Write failing source integration tests**

Create `tests/map-month-range-integration.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

function extractFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }
  throw new Error(`${name} block was not closed`);
}

test('HTML loads month view utilities before app startup', () => {
  assert.ok(htmlSource.indexOf('month-view-utils.js') < htmlSource.indexOf('app.js'));
});

test('app initializes canonical viewMonths and legacy mirror from month utility', () => {
  assert.match(appSource, /state\.viewMonths\s*=\s*normalizeViewMonths\(state\.viewMonths,\s*state\.viewMonth\)/);
  assert.match(appSource, /state\.viewMonth\s*=\s*viewMonthFromMask\(state\.viewMonths\)/);
});

test('visible crop and dominant crop calculations use viewMonths mask overlap', () => {
  const cellVisible = extractFunctionBlock(appSource, 'cellVisibleCrops');
  const dominant = extractFunctionBlock(appSource, 'dominantCropForView');

  assert.match(cellVisible, /state\.viewMonths/);
  assert.match(cellVisible, /maskIntersects\(v,\s*viewMonths\)/);
  assert.doesNotMatch(cellVisible, /state\.viewMonth/);

  assert.match(dominant, /state\.viewMonths/);
  assert.match(dominant, /maskIntersects\(v,\s*viewMonths\)/);
  assert.doesNotMatch(dominant, /state\.viewMonth/);
});

test('painting calls the map display auto-switch for non-erase paint', () => {
  const paintAt = extractFunctionBlock(appSource, 'paintAt');
  assert.match(paintAt, /ensurePaintVisibleOnMap\(\)/);
});

test('calendar exposes range-capable setViewMonths and no longer uses setViewMonth', () => {
  assert.match(calendarSource, /function setViewMonths\(mask,\s*\{\s*source\s*=\s*'manual'\s*\}\s*=\s*\{\}\)/);
  assert.match(calendarSource, /window\.setViewMonths\s*=\s*setViewMonths/);
  assert.doesNotMatch(calendarSource, /function setViewMonth\(/);
});
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run: `node --test tests/map-month-range-integration.test.mjs`

Expected: FAIL because `viewMonths`, `ensurePaintVisibleOnMap`, and `setViewMonths` are not implemented yet.

- [ ] **Step 3: Import utility functions into `app.js`**

Near the top of `app.js`, replace the duplicate month helper constants/functions with utility assignments while keeping existing app month arrays for display:

```js
const MonthView = window.TANIMAN_MONTH_VIEW;
const {
  ALL_MONTHS,
  monthsBetween,
  maskList,
  maskToDisplayLabel,
  maskIntersects,
  maskContains,
  normalizeViewMonths,
  viewMonthFromMask,
  shouldAutoSwitchViewMonths,
  isBrushHiddenOnMap,
} = MonthView;

function maskToLabel(mask) {
  return maskToDisplayLabel(mask);
}
```

- [ ] **Step 4: Initialize canonical `viewMonths` state**

In the state initialization area, keep the existing default for `viewMonth` and add `viewMonths`:

```js
viewMonth: -1,
viewMonths: ALL_MONTHS,
```

After missing-key initialization, normalize both fields:

```js
state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth);
state.viewMonth = viewMonthFromMask(state.viewMonths);
```

- [ ] **Step 5: Update rendering filters**

Change `cellVisibleCrops()` to:

```js
function cellVisibleCrops(p, cellIdx) {
  const out = [];
  const viewMonths = state.viewMonths;
  for (let c = 0; c < CROPS.length; c += 1) {
    const v = p.cells[c][cellIdx];
    if (v && maskIntersects(v, viewMonths)) out.push(c);
  }
  return out;
}
```

Change `dominantCropForView()` so the count increments with:

```js
if (maskIntersects(v, viewMonths)) counts[c]++;
```

Update the canvas tag in `renderCanvas()` so it also carries the near-canvas hidden-brush indicator required by the spec:

```js
const brushHidden = isBrushHiddenOnMap(state.viewMonths, state.paintMonths);
tag.classList.toggle('hidden-brush', brushHidden);
tag.textContent = brushHidden
  ? `Hidden · ${maskToDisplayLabel(state.paintMonths)} brush`
  : 'Showing · ' + maskToDisplayLabel(state.viewMonths, { singleLong: true }).toLowerCase();
```

- [ ] **Step 6: Add paint visibility integration**

Add this helper in `app.js` near paint logic:

```js
function ensurePaintVisibleOnMap() {
  if (!shouldAutoSwitchViewMonths(state.viewMonths, state.paintMonths)) return;
  if (typeof window.setViewMonths === 'function') {
    window.setViewMonths(state.paintMonths, { source: 'paintAuto' });
  } else {
    state.viewMonths = normalizeViewMonths(state.paintMonths, state.viewMonth);
    state.viewMonth = viewMonthFromMask(state.viewMonths);
  }
}
```

In `paintAt()`, call it after non-erase cells are painted and before redraw:

```js
if (state.brush !== 'erase') ensurePaintVisibleOnMap();
```

- [ ] **Step 7: Expose helpers needed by calendar**

Update `window.TANIMAN`:

```js
maskIntersects, maskContains, normalizeViewMonths, viewMonthFromMask,
maskToDisplayLabel, shouldAutoSwitchViewMonths, isBrushHiddenOnMap,
```

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
node --test tests/month-view-utils.test.mjs tests/map-month-range-integration.test.mjs tests/map-zoom-config.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app.js tests/map-month-range-integration.test.mjs
git commit -m "feat: use month ranges for map visibility"
```

## Chunk 3: Range Scrubber UI and Hidden Indicator

### Task 3: Update the Map Scrubber Interaction

**Files:**
- Modify: `calendar.js`
- Modify: `taniman.html`
- Modify: `styles.css`

- [ ] **Step 1: Write failing UI source assertions**

Extend `tests/map-month-range-integration.test.mjs` with:

```js
test('scrubber renders range state and hidden brush warning', () => {
  assert.match(htmlSource, /id="scrub-hidden-warning"/);
  assert.match(calendarSource, /updateHiddenBrushIndicator/);
  assert.match(calendarSource, /scrubber-month.*in-range/s);
  assert.match(calendarSource, /scrubber-month.*endpoint/s);
  assert.match(calendarSource, /monthsBetween\(scrubStart,\s*m\)/);
  assert.doesNotMatch(calendarSource, /scrubber-indicator/);
  assert.match(appSource, /tag\.classList\.toggle\('hidden-brush'/);
  assert.match(appSource, /Hidden · \$\{maskToDisplayLabel\(state\.paintMonths\)\} brush/);
});

test('setViewMonths persists viewMonths and legacy viewMonth mirror', () => {
  const setViewMonths = extractFunctionBlock(calendarSource, 'setViewMonths');
  const saveState = extractFunctionBlock(appSource, 'saveState');

  assert.match(setViewMonths, /state\.viewMonths\s*=\s*normalizeViewMonths\(mask,\s*state\.viewMonth\)/);
  assert.match(setViewMonths, /state\.viewMonth\s*=\s*viewMonthFromMask\(state\.viewMonths\)/);
  assert.match(setViewMonths, /window\.TANIMAN\.saveState\(\)/);
  assert.match(saveState, /JSON\.stringify\(state\)/);
});
```

- [ ] **Step 2: Run source assertions to verify they fail**

Run: `node --test tests/map-month-range-integration.test.mjs`

Expected: FAIL because the warning element and range scrubber logic do not exist yet.

- [ ] **Step 3: Add hidden-warning DOM and retire the old single-month indicator**

In `taniman.html`, add the warning below the scrubber row:

```html
<div class="scrub-hidden-warning" id="scrub-hidden-warning" hidden></div>
```

In `calendar.js`, remove the `scrubber-indicator` element creation from `buildScrubberTrack()`. The old pill is single-month-only and becomes misleading once the scrubber supports ranges.

- [ ] **Step 4: Replace single-month scrubber state in `calendar.js`**

Destructure additional helpers from `window.TANIMAN`:

```js
const {
  state, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  monthsBetween, maskToLabel, normalizeViewMonths, viewMonthFromMask,
  maskToDisplayLabel, maskContains, isBrushHiddenOnMap,
} = window.TANIMAN;
```

Replace `setViewMonth()` with:

```js
function updateHiddenBrushIndicator() {
  const el = document.getElementById('scrub-hidden-warning');
  if (!el) return;
  const hidden = isBrushHiddenOnMap(state.viewMonths, state.paintMonths);
  el.hidden = !hidden;
  el.textContent = hidden
    ? `Current brush: ${maskToDisplayLabel(state.paintMonths)} hidden on map`
    : '';
}

function refreshMapDisplay() {
  updateScrubberReadout();
  updateHiddenBrushIndicator();
  window.TANIMAN.renderCanvas();
  window.TANIMAN.drawPlotsOnMap();
  window.TANIMAN.updateLegend();
}

function setViewMonths(mask, { source = 'manual' } = {}) {
  state.viewMonths = normalizeViewMonths(mask, state.viewMonth);
  state.viewMonth = viewMonthFromMask(state.viewMonths);
  refreshMapDisplay();
  if (source !== 'load') window.TANIMAN.saveState();
}
window.setViewMonths = setViewMonths;
```

- [ ] **Step 5: Render range selection**

Update `updateScrubberReadout()` so it uses `state.viewMonths`:

```js
const label = maskToDisplayLabel(state.viewMonths, { singleLong: true });
ro.innerHTML = state.viewMonths === ALL_MONTHS ? `<span class="all">${label}</span>` : label;
allBtn.classList.toggle('on', state.viewMonths === ALL_MONTHS);
track.querySelectorAll('.scrubber-month').forEach((el) => {
  const m = +el.dataset.m;
  const inRange = !!(state.viewMonths & (1 << m));
  el.classList.toggle('in-range', inRange);
  el.classList.toggle('endpoint', state.viewMonths !== ALL_MONTHS && inRange);
});
```

Do not set `#scrubber-indicator` opacity or left position. That element should no longer exist after Step 3.

- [ ] **Step 6: Implement click and drag range picking**

In `wireScrubber()`, replace single-month click/drag behavior with:

```js
let scrubDragging = false;
let scrubStart = 0;
let scrubMoved = false;

const pickMonth = (clientX) => nearestMonth(track, clientX);

allBtn.onclick = () => setViewMonths(ALL_MONTHS);

track.addEventListener('mousedown', (e) => {
  scrubDragging = true;
  scrubMoved = false;
  scrubStart = pickMonth(e.clientX);
  setViewMonths(1 << scrubStart);
});
document.addEventListener('mousemove', (e) => {
  if (!scrubDragging) return;
  const m = pickMonth(e.clientX);
  scrubMoved = scrubMoved || m !== scrubStart;
  setViewMonths(scrubMoved ? monthsBetween(scrubStart, m) : (1 << scrubStart));
});
document.addEventListener('mouseup', () => { scrubDragging = false; });
```

Mirror the same behavior for touch events using `e.touches[0].clientX`.

- [ ] **Step 7: Refresh indicator when paint schedule changes**

In `updateScheduleVisuals()` or `updateScheduleReadout()`, call:

```js
if (typeof updateHiddenBrushIndicator === 'function') updateHiddenBrushIndicator();
```

- [ ] **Step 8: Add CSS for range and warning states**

Add styles:

```css
.scrubber-month.in-range {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.scrubber-month.endpoint {
  color: var(--accent-ink);
}
.scrub-hidden-warning {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  font-family: 'IBM Plex Mono', monospace;
}
.scrub-hidden-warning[hidden] {
  display: none;
}
.canvas-view-tag.hidden-brush {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 9: Run tests**

Run:

```bash
node --test tests/month-view-utils.test.mjs tests/map-month-range-integration.test.mjs tests/map-zoom-config.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add calendar.js taniman.html styles.css tests/map-month-range-integration.test.mjs
git commit -m "feat: add range map scrubber"
```

## Chunk 4: Browser Verification and Cleanup

### Task 4: Verify the Flow in Browser

**Files:**
- Modify only if verification finds a bug: `app.js`, `calendar.js`, `styles.css`, `taniman.html`

- [ ] **Step 1: Start a local static server**

Run:

```powershell
Start-Process -WindowStyle Hidden -FilePath python -ArgumentList '-m','http.server','4173' -WorkingDirectory 'D:\Repositories\thesis-digimap'
```

Expected: local server listening at `http://localhost:4173`.

- [ ] **Step 2: Open the app with Browser**

Use the Browser plugin to navigate to:

`http://localhost:4173/taniman.html`

Expected: app loads without console errors that block interaction.

- [ ] **Step 3: Manually verify range display**

Use the map scrubber:

- Click January: readout shows `January`, only January is selected.
- Drag January to February: readout shows `Jan-Feb`, both months are selected.
- Click All: readout shows `All year`, no range warning appears.

- [ ] **Step 4: Manually verify paint auto-switch**

Set schedule to `Jan-Feb`, set map display to `December`, then paint a crop cell.

Expected:

- Map display auto-switches to `Jan-Feb`.
- Newly painted cell is visible immediately.
- Hidden-brush warning is not shown after auto-switch.

- [ ] **Step 5: Manually verify explicit hidden indicator**

After the previous step, explicitly set map display to `December`.

Expected:

- Warning appears: `Current brush: Jan-Feb hidden on map`.
- Canvas view tag shows the hidden-brush state, such as `Hidden · Jan-Feb brush`.
- App still allows painting.

- [ ] **Step 6: Run final automated tests**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Use process hygiene after browser/server work**

Use `process-hygiene` before ending if Node/Vite/Playwright/browser automation left obvious stale processes. Do not kill the Python static server if it is still intentionally needed for user testing.

- [ ] **Step 8: Commit final fixes if verification required changes**

If any verification fixes were made:

```bash
git add app.js calendar.js styles.css taniman.html tests
git commit -m "fix: polish map month range visibility"
```
