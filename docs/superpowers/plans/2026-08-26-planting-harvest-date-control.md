# Planting-Harvest Date Control Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing crop schedule date controls with a polished planting-to-harvest editor that uses explicit planted/harvest month and day selectors.

**Architecture:** Keep the existing season data model and export contract unchanged. Update `taniman.html`, `calendar.js`, `styles.css`, and `data.js` so the schedule bar presents a single lifecycle editor, routes every change through `setPaintSeasonRange()`, and reuses `season-utils.js` for date rules. Add focused source and helper tests before changing runtime behavior, then verify with the full Node test suite and a browser smoke check.

**Tech Stack:** Static HTML/CSS/JS, existing browser globals, `season-utils.js`, Node built-in test runner (`node --test`), optional local static server for browser verification.

---

## File Structure

- Modify `data.js`: add translated strings for the new lifecycle control in English, Tagalog, and Ilocano.
- Modify `taniman.html`: replace raw `season-start` / `season-end` inputs with required planted/harvest month/day selects and a separate preset month select.
- Modify `calendar.js`: keep schedule logic here; add pure helper functions for month/day formatting, clamping, fallback recovery, dynamic shortcut labels, and selected shortcut state.
- Modify `styles.css`: restyle the schedule bar as a grouped planting-to-harvest editor and remove obsolete schedule-track styles.
- Modify `tests/season-ui-source.test.mjs`: update source assertions for the new markup and calendar wiring.
- Modify `tests/translations.test.mjs`: assert the new schedule strings are present in all supported language dictionaries.
- Create `tests/season-control-helpers.test.mjs`: test pure schedule-control helper behavior extracted from `calendar.js`.

---

## Chunk 1: Tests And Translation Surface

### Task 1: Update source tests for the new control contract

**Files:**
- Modify: `tests/season-ui-source.test.mjs`
- Test: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Replace the old raw-input assertions with failing selector assertions**

Update the first test to require the new control IDs and reject the old raw text fields:

```js
test('schedule UI exposes planted and harvest month-day selectors', () => {
  assert.match(htmlSource, /id="season-planted-month"/);
  assert.match(htmlSource, /id="season-planted-day"/);
  assert.match(htmlSource, /id="season-harvest-month"/);
  assert.match(htmlSource, /id="season-harvest-day"/);
  assert.match(htmlSource, /id="season-preset-month"/);
  assert.match(htmlSource, /data-season-shortcut="whole"/);
  assert.match(htmlSource, /data-season-shortcut="early"/);
  assert.match(htmlSource, /data-season-shortcut="mid"/);
  assert.match(htmlSource, /data-season-shortcut="late"/);
  assert.doesNotMatch(htmlSource, /id="season-start"/);
  assert.doesNotMatch(htmlSource, /id="season-end"/);
  assert.doesNotMatch(htmlSource, /id="sched-track"/);
});
```

- [ ] **Step 2: Add failing calendar wiring assertions**

Extend the calendar test so it requires the new helper names, references the new selector IDs, and rejects stale bindings regardless of quote style:

```js
test('calendar wires planting-harvest selectors through one range update path', () => {
  assert.match(calendarSource, /function setPaintSeasonRange/);
  assert.match(calendarSource, /function syncSeasonSelectors/);
  assert.match(calendarSource, /function updateDayOptions/);
  assert.match(calendarSource, /function updateShortcutLabels/);
  assert.match(calendarSource, /function updateSelectedShortcut/);
  assert.match(calendarSource, /season-planted-month/);
  assert.match(calendarSource, /season-planted-day/);
  assert.match(calendarSource, /season-harvest-month/);
  assert.match(calendarSource, /season-harvest-day/);
  assert.match(calendarSource, /season-preset-month/);
  assert.match(calendarSource, /shortcutRange/);
  assert.match(calendarSource, /state\.paintStartDate/);
  assert.match(calendarSource, /state\.paintEndDate/);
  assert.doesNotMatch(calendarSource, /season-start/);
  assert.doesNotMatch(calendarSource, /season-end/);
  assert.doesNotMatch(calendarSource, /['"`#.]season-month\b/);
});
```

- [ ] **Step 3: Run the targeted source test and verify it fails**

Run: `node --test tests/season-ui-source.test.mjs`

Expected: FAIL because `taniman.html` and `calendar.js` still use the old `season-start` / `season-end` controls.

This red state is intentional inside Task 1. Do not commit `tests/season-ui-source.test.mjs` until Chunk 2 implements the matching markup and calendar wiring.

### Task 2: Add translation coverage for the new visible strings

**Files:**
- Modify: `tests/translations.test.mjs`
- Modify: `data.js`
- Test: `tests/translations.test.mjs`

- [ ] **Step 1: Add a failing test for the new string keys**

Append:

```js
test('planting-harvest control strings exist in every supported language', () => {
  const { STRINGS } = loadData();
  const required = [
    'schedulePlantingHarvest',
    'seasonPlanted',
    'seasonHarvest',
    'seasonPresetMonth',
    'seasonPresentFromTo',
    'seasonContinuesNextYear',
    'seasonDateResetAllYear',
    'seasonShortcutAll',
    'seasonShortcutEarly',
    'seasonShortcutMid',
    'seasonShortcutLate',
  ];

  for (const lang of ['en', 'tl', 'il']) {
    for (const key of required) {
      assert.equal(typeof STRINGS[lang][key], 'string', `${lang}.${key} should exist`);
      assert.notEqual(STRINGS[lang][key].trim(), '', `${lang}.${key} should not be blank`);
    }
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{crop\}/);
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{start\}/);
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{end\}/);
    assert.match(STRINGS[lang].seasonShortcutAll, /\{month\}/);
    assert.match(STRINGS[lang].seasonShortcutEarly, /\{month\}/);
    assert.match(STRINGS[lang].seasonShortcutMid, /\{month\}/);
    assert.match(STRINGS[lang].seasonShortcutLate, /\{month\}/);
    assert.match(STRINGS[lang].seasonShortcutLate, /\{lastDay\}/);
  }
});
```

- [ ] **Step 2: Run the translation test and verify it fails**

Run: `node --test tests/translations.test.mjs`

Expected: FAIL because the new keys do not exist in `data.js`.

- [ ] **Step 3: Add the new keys to `data.js`**

Add the keys with these exact values unless a native speaker supplies better wording before implementation.

English:

```js
schedulePlantingHarvest: 'Planting to harvest',
seasonPlanted: 'Planted',
seasonHarvest: 'Harvest',
seasonPresetMonth: 'Preset month',
seasonPresentFromTo: '{crop} present from {start} to {end}',
seasonContinuesNextYear: 'Continues into next year',
seasonDateResetAllYear: 'Date reset to all year',
seasonShortcutAll: 'All {month}',
seasonShortcutEarly: '{month} 1-10',
seasonShortcutMid: '{month} 11-20',
seasonShortcutLate: '{month} 21-{lastDay}',
```

Tagalog:

```js
schedulePlantingHarvest: 'Mula pagtatanim hanggang anihan',
seasonPlanted: 'Tinanim',
seasonHarvest: 'Ani',
seasonPresetMonth: 'Buwan ng preset',
seasonPresentFromTo: '{crop} mula {start} hanggang {end}',
seasonContinuesNextYear: 'Tuloy sa susunod na taon',
seasonDateResetAllYear: 'Na-reset sa buong taon ang petsa',
seasonShortcutAll: 'Buong {month}',
seasonShortcutEarly: '{month} 1-10',
seasonShortcutMid: '{month} 11-20',
seasonShortcutLate: '{month} 21-{lastDay}',
```

Ilocano:

```js
schedulePlantingHarvest: 'Manipud panagmula agingga panagani',
seasonPlanted: 'Naimula',
seasonHarvest: 'Ani',
seasonPresetMonth: 'Bulan ti preset',
seasonPresentFromTo: '{crop} adda manipud {start} agingga {end}',
seasonContinuesNextYear: 'Agtultuloy iti sumaruno a tawen',
seasonDateResetAllYear: 'Na-reset iti amin a tawen ti petsa',
seasonShortcutAll: 'Amin ti {month}',
seasonShortcutEarly: '{month} 1-10',
seasonShortcutMid: '{month} 11-20',
seasonShortcutLate: '{month} 21-{lastDay}',
```

- [ ] **Step 4: Run translation tests**

Run: `node --test tests/translations.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/translations.test.mjs data.js
git commit -m "test: cover planting harvest control strings"
```

## Chunk 2: Helper Logic And Runtime Control

### Task 3: Add pure helper tests for date-control behavior

**Files:**
- Create: `tests/season-control-helpers.test.mjs`
- Modify later: `calendar.js`
- Test: `tests/season-control-helpers.test.mjs`

- [ ] **Step 1: Create a VM loader with a minimal fake DOM**

Create `tests/season-control-helpers.test.mjs` with a `loadHelpers()` helper that loads `season-utils.js` and `calendar.js` in a VM. Because `calendar.js` runs init code on load, provide a minimal fake DOM whose elements support the methods used by schedule and scrubber init:

```js
function fakeElement(id = '') {
  const classes = new Set();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    classList: {
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : !!force;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
      },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {},
    getBoundingClientRect() { return { left: 0, width: 120 }; },
  };
}

function loadHelpers(initialState = {}) {
  const elements = new Map();
  const shortcutButtons = ['whole', 'early', 'mid', 'late'].map(kind => {
    const el = fakeElement(`shortcut-${kind}`);
    el.dataset.seasonShortcut = kind;
    return el;
  });
  const document = {
    createElement: () => fakeElement(),
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    querySelectorAll: selector => selector === '[data-season-shortcut]' ? shortcutButtons : [],
    addEventListener() {},
  };
  const state = {
    lang: 'en',
    crop: 0,
    paintStartDate: '06-21',
    paintEndDate: '06-30',
    paintMonths: 1 << 5,
    viewMonths: (1 << 12) - 1,
    ...initialState,
  };
  let saveCount = 0;
  const context = {
    window: {
      TANIMAN: {
        state,
        CROPS: [
          { id: 'potato', hex: '#FFC629', name: { en: 'Potato' } },
          { id: 'carrot', hex: '#FF6A1F', name: { en: 'Carrot' } },
        ],
        MONTH_SHORT: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        MONTH_FULL: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
        MONTH_FULL_LONG: ['January','February','March','April','May','June','July','August','September','October','November','December'],
        ALL_MONTHS: (1 << 12) - 1,
        SeasonUtils: null,
        monthsBetween: () => (1 << 12) - 1,
        normalizeViewMonths: value => value,
        viewMonthFromMask: () => -1,
        maskToDisplayLabel: () => 'Jun',
        isBrushHiddenOnMap: () => false,
        tr: key => ({
          seasonPresentFromTo: '{crop} present from {start} to {end}',
          seasonContinuesNextYear: 'Continues into next year',
          seasonDateResetAllYear: 'Date reset to all year',
          seasonShortcutAll: 'All {month}',
          seasonShortcutEarly: '{month} 1-10',
          seasonShortcutMid: '{month} 11-20',
          seasonShortcutLate: '{month} 21-{lastDay}',
        }[key] || key),
        schedSave: () => { saveCount += 1; },
        saveState() {},
        renderCanvas() {},
        drawPlotsOnMap() {},
        updateLegend() {},
      },
    },
    document,
  };
  vm.createContext(context);
  vm.runInContext(seasonUtilsSource, context);
  context.window.TANIMAN.SeasonUtils = context.window.TANIMAN_SEASONS;
  vm.runInContext(calendarSource, context);
  return { helpers: context.window.TANIMAN_SEASON_CONTROL, state, elements, shortcutButtons, saveCount: () => saveCount };
}
```

- [ ] **Step 2: Add failing helper behavior tests**

Read `season-utils.js` and `calendar.js` at the top of the file, then test the helper surface from `context.window.TANIMAN_SEASON_CONTROL`.

Test the required behavior:

```js
test('date parts convert to canonical MM-DD and readable labels', () => {
  const helpers = loadHelpers();
  assert.equal(helpers.partsToMmdd(6, 21), '06-21');
  assert.deepEqual(helpers.mmddToParts('06-21'), { month: 6, day: 21 });
  assert.equal(helpers.formatMmdd('06-21'), 'Jun 21');
});

test('month changes clamp days to the selected month', () => {
  const helpers = loadHelpers();
  assert.equal(helpers.clampDayForMonth(31, 6), 30);
  assert.equal(helpers.clampDayForMonth(30, 2), 29);
  assert.equal(helpers.clampDayForMonth(10, 2), 10);
});

test('invalid active dates recover to all year and recompute paint months', () => {
  const { helpers, state, saveCount } = loadHelpers({ paintStartDate: '02-31', paintEndDate: '13-01' });
  helpers.normalizeActivePaintRange();
  assert.equal(state.paintStartDate, '01-01');
  assert.equal(state.paintEndDate, '12-31');
  assert.equal(state.paintMonths, (1 << 12) - 1);
  assert.equal(saveCount() > 0, true);
});

test('preset month label changes do not mutate the active range', () => {
  const { helpers, state } = loadHelpers({ paintStartDate: '06-21', paintEndDate: '06-30' });
  helpers.shortcutLabelsForPreset(7);
  assert.equal(state.paintStartDate, '06-21');
  assert.equal(state.paintEndDate, '06-30');
});

test('shortcut matching identifies only the active preset range', () => {
  const helpers = loadHelpers();
  assert.equal(helpers.shortcutKindForRange('06-21', '06-30', 6), 'late');
  assert.equal(helpers.shortcutKindForRange('06-21', '06-30', 7), null);
});

test('same-day and wrapped ranges format as valid readout states', () => {
  const sameDay = loadHelpers({ paintStartDate: '06-21', paintEndDate: '06-21' });
  assert.equal(sameDay.helpers.readoutModel().wrapped, false);
  assert.match(sameDay.helpers.readoutModel().text, /Jun 21/);

  const wrapped = loadHelpers({ paintStartDate: '11-15', paintEndDate: '05-05' });
  assert.equal(wrapped.helpers.readoutModel().wrapped, true);
  assert.match(wrapped.helpers.readoutModel().text, /Nov 15/);
  assert.match(wrapped.helpers.readoutModel().text, /May 5/);
});

test('crop readout refresh does not mutate the active range', () => {
  const { helpers, state } = loadHelpers({ paintStartDate: '06-21', paintEndDate: '06-30' });
  const first = helpers.readoutModel();
  state.crop = 1;
  const second = helpers.readoutModel();
  assert.match(first.text, /Potato/);
  assert.match(second.text, /Carrot/);
  assert.equal(state.paintStartDate, '06-21');
  assert.equal(state.paintEndDate, '06-30');
});

test('shortcut apply uses shortcutRange and updates selectors', () => {
  const { helpers, state, elements } = loadHelpers({ paintStartDate: '01-01', paintEndDate: '12-31' });
  helpers.applyShortcut('late', 6);
  assert.equal(state.paintStartDate, '06-21');
  assert.equal(state.paintEndDate, '06-30');
  assert.equal(elements.get('season-planted-month').value, '6');
  assert.equal(elements.get('season-planted-day').value, '21');
  assert.equal(elements.get('season-harvest-month').value, '6');
  assert.equal(elements.get('season-harvest-day').value, '30');
});

test('selected shortcut state appears only for the matching preset shortcut', () => {
  const { helpers, shortcutButtons } = loadHelpers({ paintStartDate: '06-21', paintEndDate: '06-30' });
  helpers.updateSelectedShortcut(6);
  assert.equal(shortcutButtons.find(btn => btn.dataset.seasonShortcut === 'late').classList.contains('on'), true);
  assert.equal(shortcutButtons.filter(btn => btn.dataset.seasonShortcut !== 'late').some(btn => btn.classList.contains('on')), false);

  helpers.updateSelectedShortcut(7);
  assert.equal(shortcutButtons.some(btn => btn.classList.contains('on')), false);
});
```

- [ ] **Step 3: Run the helper tests and verify they fail**

Run: `node --test tests/season-control-helpers.test.mjs`

Expected: FAIL because `window.TANIMAN_SEASON_CONTROL` and the helper functions do not exist.

### Task 4: Replace markup with explicit planted/harvest selectors

**Files:**
- Modify: `taniman.html`
- Test: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Replace the current `.season-fields` markup**

Replace the current `Start`, `End`, and `season-month` block with:

```html
<div class="season-editor" aria-labelledby="sched-label">
  <div class="season-date-group">
    <span class="season-date-label" id="season-planted-label"></span>
    <select id="season-planted-month" aria-labelledby="season-planted-label"></select>
    <select id="season-planted-day" aria-labelledby="season-planted-label"></select>
  </div>
  <div class="season-date-group">
    <span class="season-date-label" id="season-harvest-label"></span>
    <select id="season-harvest-month" aria-labelledby="season-harvest-label"></select>
    <select id="season-harvest-day" aria-labelledby="season-harvest-label"></select>
  </div>
  <div class="season-preset-group">
    <span class="season-date-label" id="season-preset-label"></span>
    <select id="season-preset-month" aria-labelledby="season-preset-label"></select>
  </div>
</div>
```

Keep the existing four `data-season-shortcut` buttons, but allow their text to be replaced by `calendar.js`.

- [ ] **Step 2: Run the source test**

Run: `node --test tests/season-ui-source.test.mjs`

Expected: still FAIL until `calendar.js` is updated, but markup-specific assertions should now pass.

### Task 5: Implement calendar helper and selector wiring

**Files:**
- Modify: `app.js`
- Modify: `calendar.js`
- Test: `tests/season-control-helpers.test.mjs`
- Test: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Add pure helper functions near the schedule picker section**

Add helpers for:

- `partsToMmdd(month, day)`
- `mmddToParts(value)`
- `formatMmdd(value)`
- `clampDayForMonth(day, month)`
- `shortcutLabelsForPreset(month)`
- `shortcutKindForRange(start, end, presetMonth)`
- `normalizeActivePaintRange({ save = true } = {})`
- `readoutModel()`
- `applyShortcut(kind, presetMonth)`
- `updateSelectedShortcut(presetMonth)`

Expose only the helper test surface:

```js
window.TANIMAN_SEASON_CONTROL = {
  partsToMmdd,
  mmddToParts,
  formatMmdd,
  clampDayForMonth,
  shortcutLabelsForPreset,
  shortcutKindForRange,
  normalizeActivePaintRange,
  readoutModel,
  applyShortcut,
  updateSelectedShortcut,
};
```

- [ ] **Step 2: Update `updateScheduleReadout()`**

Use translated text:

```js
const phrase = tr('seasonPresentFromTo')
  .replace('{crop}', crop.name[state.lang] || crop.name.en)
  .replace('{start}', formatMmdd(state.paintStartDate))
  .replace('{end}', formatMmdd(state.paintEndDate));
```

Keep the crop dot. Add a helper span for wrapped ranges when `rangeWrapsYear(state.paintStartDate, state.paintEndDate)` is true.

- [ ] **Step 3: Add translated label sync**

Add `updateSeasonStaticLabels()` in `calendar.js`:

```js
function updateSeasonStaticLabels() {
  document.getElementById('sched-label').textContent = tr('schedulePlantingHarvest');
  document.getElementById('season-planted-label').textContent = tr('seasonPlanted');
  document.getElementById('season-harvest-label').textContent = tr('seasonHarvest');
  document.getElementById('season-preset-label').textContent = tr('seasonPresetMonth');
}
```

Expose it as `window.updateSeasonStaticLabels = updateSeasonStaticLabels`.

- [ ] **Step 4: Update `app.js` language binding**

In `applyLang()`, replace the existing schedule label assignment:

```js
document.getElementById('sched-label').textContent = tr('schedule');
```

with:

```js
if (typeof updateSeasonStaticLabels === 'function') updateSeasonStaticLabels();
else document.getElementById('sched-label').textContent = tr('schedulePlantingHarvest');
```

Keep the existing `updateScheduleReadout()` call. Also expose `window.updateShortcutLabels = updateShortcutLabels` in `calendar.js` and call it from `applyLang()` so language changes always refresh dynamic shortcut text.

- [ ] **Step 5: Replace `syncSeasonInputs()` with `syncSeasonSelectors()`**

Set the planted and harvest month/day selects from `state.paintStartDate` and `state.paintEndDate`. If either value is invalid, call `normalizeActivePaintRange()` and then sync.

- [ ] **Step 6: Add `updateDayOptions(monthSelect, daySelect)`**

Regenerate day options from `SeasonUtils.MONTH_DAYS[month - 1]`. Preserve the current day when possible and clamp when needed.

- [ ] **Step 7: Add `updateShortcutLabels()` and `updateSelectedShortcut()`**

Read the preset month from `season-preset-month`. Apply translated shortcut labels and toggle a selected class such as `on` on the matching shortcut.

- [ ] **Step 8: Rewrite `wireSeasonPicker()`**

Bind:

- planted month change: regenerate planted day options, then call `setPaintSeasonRange()`
- planted day change: call `setPaintSeasonRange()`
- harvest month change: regenerate harvest day options, then call `setPaintSeasonRange()`
- harvest day change: call `setPaintSeasonRange()`
- preset month change: update shortcut labels and selected state only
- shortcut click: use `shortcutRange(Number(preset.value), kind)` and call `setPaintSeasonRange(range.start, range.end)`

Do not reset the range on crop changes; `applyLang()` and palette changes should only refresh the readout.

- [ ] **Step 9: Preserve startup normalization**

Keep the existing `app.js` startup normalization for invalid saved dates. Ensure `calendar.js` also normalizes through `normalizeActivePaintRange()` during init so selectors, `paintMonths`, readout, and saved state agree.

- [ ] **Step 10: Run targeted tests**

Run:

```powershell
node --test tests/season-control-helpers.test.mjs tests/season-ui-source.test.mjs tests/translations.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add app.js calendar.js taniman.html tests/season-control-helpers.test.mjs tests/season-ui-source.test.mjs
git commit -m "feat: add planting harvest date selectors"
```

### Task 6: Restyle the schedule bar as one grouped editor

**Files:**
- Modify: `styles.css`
- Test: `tests/season-ui-source.test.mjs`

- [ ] **Step 1: Replace obsolete `.season-fields` styling**

Add styles for:

- `.season-editor`
- `.season-date-group`
- `.season-date-label`
- `.season-preset-group`
- month/day select sizing
- wrapped-range helper inside `.sched-readout`
- selected shortcut button state

- [ ] **Step 2: Remove obsolete schedule track styles**

Delete unused CSS blocks for:

- `.sched-track`
- `.sched-track-fill`
- `.sched-month`
- `.sched-handle`

Leave map scrubber styles untouched.

- [ ] **Step 3: Ensure responsive layout is explicit**

Update the existing mobile media query so planted/harvest groups remain readable and shortcuts form a stable two-column grid on narrow screens.

- [ ] **Step 4: Run source tests**

Run: `node --test tests/season-ui-source.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add styles.css tests/season-ui-source.test.mjs
git commit -m "style: polish planting harvest schedule control"
```

## Chunk 3: Full Verification And Browser Smoke

### Task 7: Run the full automated test suite

**Files:**
- Modify only if tests expose stale assertions that contradict the approved spec.
- Test: `tests/*.test.mjs`

- [ ] **Step 1: Run all Node tests**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 2: Fix any stale tests or implementation bugs**

If a test fails, first determine whether the failure is a real regression or an old assertion for the removed raw date inputs. Update only stale assertions that contradict the approved spec.

- [ ] **Step 3: Commit any fixes**

```powershell
git add app.js calendar.js data.js taniman.html styles.css tests
git commit -m "test: align schedule control verification"
```

Skip this commit if there are no changes.

### Task 8: Browser smoke test the field workflow

**Files:**
- No edits expected unless smoke testing reveals a real issue.

- [ ] **Step 1: Start a local static server**

Run: `python -m http.server 8080`

Expected: server listens at `http://localhost:8080/`.

If port `8080` is occupied, use another local port such as `8081` and update the browser URL in the following steps.

- [ ] **Step 2: Open the app locally**

Open: `http://localhost:8080/taniman.html`, or the alternate port chosen in Step 1.

- [ ] **Step 3: Verify schedule control behavior**

Check:

- label reads as planting-to-harvest wording in English
- planted and harvest controls show separate month/day selectors
- selecting preset month July changes shortcut labels without changing the active range
- clicking `Jul 21-31` updates planted/harvest selectors and readout
- after clicking `Jul 21-31`, the late shortcut has the selected class and the other shortcuts do not
- after manually changing the harvest day to a non-shortcut range, no shortcut remains selected
- changing crop updates the crop name/readout without changing the range
- switching language refreshes schedule labels, shortcut labels, and readout phrase
- wrapped range such as `Nov 15` to `May 5` shows the wrapped helper
- an invalid saved active range recovers to `Jan 1` through `Dec 31`, recomputes `state.paintMonths`, syncs selectors, updates the readout, and shows the reset message
- mobile viewport keeps controls readable without text overlap

Record concise PASS lines while testing, for example:

```text
PASS: preset July changed labels only; active range stayed Jun 21-Jun 30.
PASS: Jul 21-31 selected late shortcut only.
PASS: custom Jul 21-Jul 30 range cleared shortcut selected state.
PASS: invalid saved range recovered to Jan 1-Dec 31 and showed reset message.
```

- [ ] **Step 4: Stop the local server**

Stop the server with Ctrl+C. Do not leave the static server running unless the user explicitly asks for it.

### Task 9: Process hygiene and final handoff

**Files:**
- No edits expected.

- [ ] **Step 1: Use process hygiene**

Use @process-hygiene because Node tests and a local server may have run. Inspect for stale `node.exe`, Playwright, Vite, or static-server processes. Do not kill an intentionally running server without user approval.

- [ ] **Step 2: Final response**

Report:

- files changed
- commits made
- tests run and results
- browser smoke result
- whether any server or helper process remains running
