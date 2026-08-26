import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const seasonUtilsSource = await readFile(new URL('../season-utils.js', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');

function fakeElement(id = '') {
  const classes = new Set();
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
      innerWidth: 1200,
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
  const { helpers } = loadHelpers();
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
