// ── Schedule picker (tools-bar above canvas) & map scrubber ───────
// Both interact through window.TANIMAN exposed by app.js.

(function(){
const {
  state, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils, monthsBetween, normalizeViewMonths, viewMonthFromMask,
  maskToDisplayLabel, isBrushHiddenOnMap, tr,
} = window.TANIMAN;
const { isValidMmdd, shortcutRange, rangeWrapsYear } = SeasonUtils;

let scrubStart = 0, scrubEnd = 11;
let activeDateReset = false;

function scrubEndpointsFromMask(mask) {
  if (mask === ALL_MONTHS) return { s: 0, e: 11 };
  let first = -1, last = -1;
  for (let i = 0; i < 12; i++) {
    if (mask & (1<<i)) { if (first < 0) first = i; last = i; }
  }
  return { s: first >= 0 ? first : 0, e: last >= 0 ? last : 11 };
}

function setViewRange(s, e) {
  scrubStart = s; scrubEnd = e;
  setViewMonths(monthsBetween(scrubStart, scrubEnd));
}

function setViewEnd(m) {
  scrubEnd = m;
  setViewMonths(monthsBetween(scrubStart, m));
}

// ── BUILD: map scrubber DOM ───────────────────────────────────────
function buildScrubberTrack() {
  const track = document.getElementById('scrubber-track');
  track.innerHTML = '';
  for (let m=0; m<12; m++) {
    const btn = document.createElement('div');
    btn.className = 'scrubber-month';
    btn.dataset.m = m;
    btn.textContent = MONTH_SHORT[m] + (window.innerWidth>1400 ? MONTH_FULL[m].slice(1,3) : '');
    btn.title = MONTH_FULL_LONG[m];
    track.appendChild(btn);
  }
  const fill = document.createElement('div');
  fill.className = 'scrubber-track-fill';
  fill.id = 'scrubber-track-fill';
  track.appendChild(fill);
}

// ── SCHEDULE PICKER LOGIC ─────────────────────────────────────────
function partsToMmdd(month, day) {
  return `${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

function mmddToParts(value) {
  if (!isValidMmdd(value)) return null;
  return { month: Number(value.slice(0, 2)), day: Number(value.slice(3, 5)) };
}

function monthShortLabel(month) {
  const short = MONTH_SHORT[month - 1];
  return short && short.length > 1 ? short : MONTH_FULL[month - 1];
}

function formatMmdd(value) {
  const parts = mmddToParts(value);
  return parts ? `${monthShortLabel(parts.month)} ${parts.day}` : value;
}

function clampDayForMonth(day, month) {
  const m = Number(month);
  const max = SeasonUtils.MONTH_DAYS[m - 1] || SeasonUtils.MONTH_DAYS[0];
  const d = Number(day);
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(Math.trunc(d), max);
}

function shortcutLabelsForPreset(month) {
  const m = Number(month);
  const label = monthShortLabel(m);
  const lastDay = SeasonUtils.MONTH_DAYS[m - 1];
  return {
    whole: tr('seasonShortcutAll').replace('{month}', label),
    early: tr('seasonShortcutEarly').replace('{month}', label),
    mid: tr('seasonShortcutMid').replace('{month}', label),
    late: tr('seasonShortcutLate').replace('{month}', label).replace('{lastDay}', lastDay),
  };
}

function shortcutKindForRange(start, end, presetMonth) {
  const month = Number(presetMonth);
  for (const kind of ['whole', 'early', 'mid', 'late']) {
    const range = shortcutRange(month, kind);
    if (range && range.start === start && range.end === end) return kind;
  }
  return null;
}

function monthMaskForSeason(start, end) {
  if (!isValidMmdd(start) || !isValidMmdd(end)) return 0;
  let mask = 0;
  for (let m=0; m<12; m++) {
    const month = String(m + 1).padStart(2, '0');
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(SeasonUtils.MONTH_DAYS[m]).padStart(2, '0')}`;
    if (SeasonUtils.seasonsOverlap(start, end, monthStart, monthEnd)) mask |= (1 << m);
  }
  return mask;
}

function normalizeActivePaintRange({ save = true } = {}) {
  const shouldRecover = !!window.TANIMAN.invalidActivePaintRangeAtStartup ||
    !isValidMmdd(state.paintStartDate) ||
    !isValidMmdd(state.paintEndDate);
  if (!shouldRecover) {
    state.paintMonths = monthMaskForSeason(state.paintStartDate, state.paintEndDate);
    return false;
  }
  state.paintStartDate = '01-01';
  state.paintEndDate = '12-31';
  state.paintMonths = monthMaskForSeason(state.paintStartDate, state.paintEndDate);
  activeDateReset = true;
  window.TANIMAN.invalidActivePaintRangeAtStartup = false;
  if (save) window.TANIMAN.schedSave();
  return true;
}

function readoutModel() {
  const crop = CROPS[state.crop];
  const cropName = crop.name[state.lang] || crop.name.en;
  const valid = isValidMmdd(state.paintStartDate) && isValidMmdd(state.paintEndDate);
  const wrapped = valid && rangeWrapsYear(state.paintStartDate, state.paintEndDate);
  const text = valid
    ? tr('seasonPresentFromTo')
      .replace('{crop}', cropName)
      .replace('{start}', formatMmdd(state.paintStartDate))
      .replace('{end}', formatMmdd(state.paintEndDate))
    : tr('seasonDateResetAllYear');
  return {
    crop,
    text,
    wrapped,
    helper: activeDateReset ? tr('seasonDateResetAllYear') : (wrapped ? tr('seasonContinuesNextYear') : ''),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function updateScheduleReadout() {
  const el = document.getElementById('sched-readout');
  const model = readoutModel();
  el.innerHTML =
    `<span class="crop-dot" style="background:${model.crop.hex}"></span>` +
    `<span class="rng">${escapeHtml(model.text)}</span>` +
    (model.helper ? `<span class="rng-helper"> &middot; ${escapeHtml(model.helper)}</span>` : '');
  if (typeof updateHiddenBrushIndicator === 'function') updateHiddenBrushIndicator();
}
window.updateScheduleReadout = updateScheduleReadout;
window.updateScrubberReadout = updateScrubberReadout;

function updateSeasonStaticLabels() {
  document.getElementById('sched-label').textContent = tr('schedulePlantingHarvest');
  document.getElementById('season-planted-label').textContent = tr('seasonPlanted');
  document.getElementById('season-harvest-label').textContent = tr('seasonHarvest');
  document.getElementById('season-preset-label').textContent = tr('seasonPresetMonth');
  document.getElementById('season-planted-month').setAttribute('aria-label', `${tr('seasonPlanted')} ${tr('seasonMonth')}`);
  document.getElementById('season-planted-day').setAttribute('aria-label', `${tr('seasonPlanted')} ${tr('seasonDay')}`);
  document.getElementById('season-harvest-month').setAttribute('aria-label', `${tr('seasonHarvest')} ${tr('seasonMonth')}`);
  document.getElementById('season-harvest-day').setAttribute('aria-label', `${tr('seasonHarvest')} ${tr('seasonDay')}`);
}

window.updateSeasonStaticLabels = updateSeasonStaticLabels;

function clearChildren(el) {
  el.innerHTML = '';
  if (Array.isArray(el.children)) el.children.length = 0;
}

function populateMonthSelect(select, { short = false } = {}) {
  if (!select) return;
  const previous = select.value;
  clearChildren(select);
  for (let i=0; i<12; i++) {
    const option = document.createElement('option');
    option.value = String(i + 1);
    option.textContent = short ? monthShortLabel(i + 1) : MONTH_FULL_LONG[i];
    select.appendChild(option);
  }
  select.value = previous || '1';
}

function populateSeasonMonthSelects() {
  populateMonthSelect(document.getElementById('season-planted-month'), { short: true });
  populateMonthSelect(document.getElementById('season-harvest-month'), { short: true });
  const presetMonth = document.getElementById('season-preset-month');
  populateMonthSelect(presetMonth);
  const start = mmddToParts(state.paintStartDate);
  if (presetMonth && start) presetMonth.value = String(start.month);
}

function updateDayOptions(monthSelect, daySelect, desiredDay = Number(daySelect.value) || 1) {
  if (!monthSelect || !daySelect) return;
  const month = Number(monthSelect.value);
  const day = clampDayForMonth(desiredDay, month);
  const max = SeasonUtils.MONTH_DAYS[month - 1] || SeasonUtils.MONTH_DAYS[0];
  clearChildren(daySelect);
  for (let d=1; d<=max; d++) {
    const option = document.createElement('option');
    option.value = String(d);
    option.textContent = String(d);
    daySelect.appendChild(option);
  }
  daySelect.value = String(day);
}

function syncSeasonSelectors({ normalize = true } = {}) {
  if (normalize) normalizeActivePaintRange();
  const plantedMonth = document.getElementById('season-planted-month');
  const plantedDay = document.getElementById('season-planted-day');
  const harvestMonth = document.getElementById('season-harvest-month');
  const harvestDay = document.getElementById('season-harvest-day');
  const presetMonth = document.getElementById('season-preset-month');
  const start = mmddToParts(state.paintStartDate);
  const end = mmddToParts(state.paintEndDate);
  if (!plantedMonth || !plantedDay || !harvestMonth || !harvestDay || !start || !end) return;

  plantedMonth.value = String(start.month);
  updateDayOptions(plantedMonth, plantedDay, start.day);
  harvestMonth.value = String(end.month);
  updateDayOptions(harvestMonth, harvestDay, end.day);
  if (presetMonth && !presetMonth.value) presetMonth.value = String(start.month);
}

function updateShortcutLabels() {
  const preset = document.getElementById('season-preset-month');
  if (!preset) return;
  const labels = shortcutLabelsForPreset(Number(preset.value));
  document.querySelectorAll('[data-season-shortcut]').forEach(btn => {
    const label = labels[btn.dataset.seasonShortcut];
    if (label) btn.textContent = label;
  });
  updateSelectedShortcut(Number(preset.value));
}
window.updateShortcutLabels = updateShortcutLabels;

function updateSelectedShortcut(presetMonth) {
  const month = Number(presetMonth || document.getElementById('season-preset-month')?.value);
  const selected = shortcutKindForRange(state.paintStartDate, state.paintEndDate, month);
  document.querySelectorAll('[data-season-shortcut]').forEach(btn => {
    const isSelected = !!selected && btn.dataset.seasonShortcut === selected;
    btn.classList.toggle('on', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function setPaintSeasonRange(start, end) {
  state.paintStartDate = start;
  state.paintEndDate = end;
  activeDateReset = false;
  normalizeActivePaintRange({ save: false });
  syncSeasonSelectors({ normalize: false });
  updateScheduleReadout();
  updateSelectedShortcut();
  window.TANIMAN.schedSave();
}

function applyShortcut(kind, presetMonth) {
  const range = shortcutRange(Number(presetMonth), kind);
  if (range) setPaintSeasonRange(range.start, range.end);
}

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

function nearestMonth(track, clientX){
  const rect = track.getBoundingClientRect();
  const x = clientX - rect.left;
  let m = Math.floor((x / rect.width) * 12);
  if (m < 0) m = 0; if (m > 11) m = 11;
  return m;
}

function wireSeasonPicker() {
  const plantedMonth = document.getElementById('season-planted-month');
  const plantedDay = document.getElementById('season-planted-day');
  const harvestMonth = document.getElementById('season-harvest-month');
  const harvestDay = document.getElementById('season-harvest-day');
  const preset = document.getElementById('season-preset-month');
  if (!plantedMonth || !plantedDay || !harvestMonth || !harvestDay || !preset) return;

  const setFromSelectors = () => setPaintSeasonRange(
    partsToMmdd(plantedMonth.value, plantedDay.value),
    partsToMmdd(harvestMonth.value, harvestDay.value));

  plantedMonth.addEventListener('change', () => {
    updateDayOptions(plantedMonth, plantedDay);
    setFromSelectors();
  });
  plantedDay.addEventListener('change', setFromSelectors);
  harvestMonth.addEventListener('change', () => {
    updateDayOptions(harvestMonth, harvestDay);
    setFromSelectors();
  });
  harvestDay.addEventListener('change', setFromSelectors);
  preset.addEventListener('change', () => {
    updateShortcutLabels();
    updateSelectedShortcut(Number(preset.value));
  });

  document.querySelectorAll('[data-season-shortcut]').forEach(btn => {
    btn.addEventListener('click', () => applyShortcut(btn.dataset.seasonShortcut, Number(preset.value)));
  });
}

// ── MAP MONTH SCRUBBER LOGIC ──────────────────────────────────────
function updateHiddenBrushIndicator() {
  const el = document.getElementById('scrub-hidden-warning');
  if (!el) return;
  const hidden = isBrushHiddenOnMap(state.viewMonths, state.paintMonths);
  el.hidden = !hidden;
  el.textContent = hidden
    ? tr('brushHidden').replace('{range}', maskToDisplayLabel(state.paintMonths))
    : '';
}

function updateScrubberReadout() {
  const ro = document.getElementById('scrub-readout');
  const allBtn = document.getElementById('scrub-all');
  const isAll = state.viewMonths === ALL_MONTHS;
  const label = maskToDisplayLabel(state.viewMonths, { singleLong: true });
  ro.innerHTML = isAll ? `<span class="all">${label}</span>` : label;
  allBtn.classList.toggle('on', isAll);

  const { s, e } = scrubEndpointsFromMask(state.viewMonths);
  const fill = document.getElementById('scrubber-track-fill');
  if (fill) {
    fill.style.left = `${(s / 12) * 100}%`;
    fill.style.width = `${((e - s + 1) / 12) * 100}%`;
  }

  const track = document.getElementById('scrubber-track');
  track.querySelectorAll('.scrubber-month').forEach(el => {
    const m = +el.dataset.m;
    const inRange = !!(state.viewMonths & (1<<m));
    el.classList.toggle('in-range', inRange);
    el.classList.toggle('endpoint', !isAll && (m === s || m === e));
  });
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

function wireScrubber() {
  const track = document.getElementById('scrubber-track');
  const allBtn = document.getElementById('scrub-all');
  allBtn.onclick = () => { scrubStart = 0; scrubEnd = 11; setViewMonths(ALL_MONTHS); };

  let scrubDragging = null;

  const startInteract = (clientX) => {
    const m = nearestMonth(track, clientX);
    if (state.viewMonths === ALL_MONTHS) {
      scrubStart = m; scrubEnd = m;
      scrubDragging = 'end';
      setViewRange(m, m);
    } else {
      const { s, e } = scrubEndpointsFromMask(state.viewMonths);
      scrubStart = s; scrubEnd = e;
      scrubDragging = Math.abs(m - s) <= Math.abs(m - e) ? 'start' : 'end';
      if (scrubDragging === 'start') setViewRange(m, scrubEnd);
      else setViewEnd(m);
    }
  };
  const moveInteract = (clientX) => {
    if (!scrubDragging) return;
    const m = nearestMonth(track, clientX);
    if (scrubDragging === 'start') {
      if (m > scrubEnd) { scrubDragging = 'end'; setViewRange(scrubEnd, m); }
      else setViewRange(m, scrubEnd);
    } else {
      if (m < scrubStart) { scrubDragging = 'start'; setViewRange(m, scrubStart); }
      else setViewEnd(m);
    }
  };
  const endInteract = () => { scrubDragging = null; };

  track.addEventListener('mousedown', (e) => { e.preventDefault(); startInteract(e.clientX); });
  document.addEventListener('mousemove', (e) => { if (scrubDragging) moveInteract(e.clientX); });
  document.addEventListener('mouseup', endInteract);
  track.addEventListener('touchstart', (e) => { e.preventDefault(); startInteract(e.touches[0].clientX); }, {passive:false});
  track.addEventListener('touchmove', (e) => { if (scrubDragging) { e.preventDefault(); moveInteract(e.touches[0].clientX); } }, {passive:false});
  track.addEventListener('touchend', endInteract);
}

// ── INIT ──────────────────────────────────────────────────────────
buildScrubberTrack();
populateSeasonMonthSelects();
normalizeActivePaintRange();
syncSeasonSelectors({ normalize: false });
updateSeasonStaticLabels();
updateShortcutLabels();
wireSeasonPicker();
wireScrubber();
updateScheduleReadout();
updateScrubberReadout();

})();
