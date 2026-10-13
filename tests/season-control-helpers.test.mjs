import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const seasonUtilsSource = await readFile(new URL('../season-utils.js', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');
const classesSource = await readFile(new URL('../classes.js', import.meta.url), 'utf8');
const LETTUCE = '11111111-1111-4111-8111-111111111111';

function fakeElement(id = '') {
  const classes = new Set();
  const attributes = new Map();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    children: [],
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
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) || null; },
    getBoundingClientRect() { return { left: 0, width: 120 }; },
  };
}

function loadHelpers(initialState = {}, tanimanOverrides = {}) {
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
    selection: { classKey: 'potato', cropId: null, remark: '' },
    paintStartDate: '06-21',
    paintEndDate: '06-30',
    paintMonths: 1 << 5,
    viewMonths: (1 << 12) - 1,
    ...initialState,
  };
  const crops = [
    { id: LETTUCE, hex: '#22C55E', name: { en: 'Lettuce' } },
  ];
  const catalog = tanimanOverrides.CropCatalog || {
    byId(id) {
      const crop = crops.find(item => item.id === id);
      return crop || { id, hex: '#9CA3AF', name: { en: `Unknown crop (${id})` }, isResolved: false };
    },
    isResolved: id => crops.some(item => item.id === id),
  };
  let saveCount = 0;
  const context = {
    window: {
      innerWidth: 1200,
      TANIMAN: {
        state,
        CROPS: crops,
        CropCatalog: catalog,
        Classes: null,
        selectionStatus: () => context.window.TANIMAN_CLASSES.selectionStatus(
          { ...state.selection, start: state.paintStartDate, end: state.paintEndDate },
          id => catalog.isResolved(id)),
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
          seasonPlanted: 'Planted',
          seasonHarvest: 'Harvest',
          seasonMonth: 'Month',
          seasonDay: 'Day',
          seasonContinuesNextYear: 'Continues into next year',
          pickClass: 'Pick a class to start painting',
          pickCropName: 'Pick or add a crop name',
          typeRemark: 'Type what it is first',
          pickDates: 'Pick when it was planted and harvested',
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
        ...tanimanOverrides,
      },
    },
    document,
  };
  vm.createContext(context);
  vm.runInContext(seasonUtilsSource, context);
  context.window.TANIMAN.SeasonUtils = context.window.TANIMAN_SEASONS;
  vm.runInContext(classesSource, context);
  context.window.TANIMAN.Classes = context.window.TANIMAN_CLASSES;
  vm.runInContext(calendarSource, context);
  return { helpers: context.window.TANIMAN_SEASON_CONTROL, window: context.window, state, elements, shortcutButtons, saveCount: () => saveCount };
}

test('date parts convert to canonical MM-DD and readable labels', () => {
  const { helpers } = loadHelpers();
  assert.equal(helpers.partsToMmdd(6, 21), '06-21');
  assert.deepEqual({ ...helpers.mmddToParts('06-21') }, { month: 6, day: 21 });
  assert.equal(helpers.formatMmdd('06-21'), 'Jun 21');
});

test('month changes clamp days to the selected month', () => {
  const { helpers } = loadHelpers();
  assert.equal(helpers.clampDayForMonth(31, 6), 30);
  assert.equal(helpers.clampDayForMonth(30, 2), 29);
  assert.equal(helpers.clampDayForMonth(10, 2), 10);
});

test('invalid active dates are never replaced; painting waits for real dates', () => {
  const { helpers, state, saveCount } = loadHelpers({ paintStartDate: '02-31', paintEndDate: '13-01' });
  helpers.normalizeActivePaintRange();
  assert.equal(state.paintStartDate, '02-31');
  assert.equal(state.paintEndDate, '13-01');
  assert.equal(state.paintMonths, (1 << 12) - 1);
  assert.equal(helpers.readoutModel().text, 'Pick when it was planted and harvested');
  assert.equal(saveCount(), 0);
});

test('a fresh session shows blank date selectors and the pick-a-class prompt', () => {
  const { helpers, elements } = loadHelpers({
    selection: { classKey: null, cropId: null, remark: '' },
    paintStartDate: null,
    paintEndDate: null,
  });

  for (const id of ['season-planted-month', 'season-planted-day', 'season-harvest-month', 'season-harvest-day']) {
    assert.equal(elements.get(id).value, '', id);
  }
  assert.equal(elements.get('season-planted-month').children[0].value, '');
  assert.equal(helpers.readoutModel().text, 'Pick a class to start painting');
  assert.equal(helpers.readoutModel().helper, '');
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

test('schedule readout separates wrapped helper text in rendered HTML', () => {
  const { window, elements } = loadHelpers({ paintStartDate: '11-15', paintEndDate: '05-05' });

  window.updateScheduleReadout();

  const readout = elements.get('sched-readout').innerHTML;
  assert.match(readout, /<span class="rng">[^<]*May 5<\/span>/);
  assert.match(readout, /<span class="rng-helper">\s+&middot;\s+Continues into next year<\/span>/);
});

test('season static labels assign distinct month and day accessible names', () => {
  const { window, elements } = loadHelpers();

  window.updateSeasonStaticLabels();

  assert.equal(elements.get('season-planted-month').getAttribute('aria-label'), 'Planted Month');
  assert.equal(elements.get('season-planted-day').getAttribute('aria-label'), 'Planted Day');
  assert.equal(elements.get('season-harvest-month').getAttribute('aria-label'), 'Harvest Month');
  assert.equal(elements.get('season-harvest-day').getAttribute('aria-label'), 'Harvest Day');
});

test('class readout refresh does not mutate the active range', () => {
  const { helpers, state } = loadHelpers({ paintStartDate: '06-21', paintEndDate: '06-30' });
  const first = helpers.readoutModel();
  state.selection.classKey = 'carrot';
  const second = helpers.readoutModel();
  assert.match(first.text, /Potato/);
  assert.match(second.text, /Carrot/);
  assert.equal(state.paintStartDate, '06-21');
  assert.equal(state.paintEndDate, '06-30');
});

test('an Other remark renders as escaped text with the Other color', () => {
  const { helpers, window, elements } = loadHelpers({
    selection: { classKey: 'other', cropId: null, remark: '<img src=x onerror=alert(1)>' },
  });

  const model = helpers.readoutModel();
  window.updateScheduleReadout();

  assert.match(model.text, /^Other: <img/);
  assert.match(elements.get('sched-readout').innerHTML, /background:#F472B6/);
  assert.match(elements.get('sched-readout').innerHTML, /&lt;img/);
  assert.doesNotMatch(elements.get('sched-readout').innerHTML, /<img/);
});

test('class 4 with a deleted crop name prompts for a crop name; a known one shows its name', () => {
  const missing = loadHelpers({ selection: { classKey: 'other_cultivated', cropId: 'gone', remark: '' } });
  assert.equal(missing.helpers.readoutModel().text, 'Pick or add a crop name');

  const known = loadHelpers({ selection: { classKey: 'other_cultivated', cropId: LETTUCE, remark: '' } });
  assert.match(known.helpers.readoutModel().text, /^Lettuce present from Jun 21 to Jun 30$/);
  assert.equal(known.helpers.readoutModel().hex, '#22C55E');
});

test('season control no longer exposes preset or shortcut helpers', () => {
  const { helpers } = loadHelpers();
  assert.equal(helpers.shortcutLabelsForPreset, undefined);
  assert.equal(helpers.shortcutKindForRange, undefined);
  assert.equal(helpers.applyShortcut, undefined);
  assert.equal(helpers.updateSelectedShortcut, undefined);
});
