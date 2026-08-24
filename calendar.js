// ── Schedule picker (tools-bar above canvas) & map scrubber ───────
// Both interact through window.TANIMAN exposed by app.js.

(function(){
const {
  state, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils, monthsBetween, normalizeViewMonths, viewMonthFromMask,
  maskToDisplayLabel, isBrushHiddenOnMap, tr,
} = window.TANIMAN;
const { isValidMmdd, shortcutRange } = SeasonUtils;

let scrubStart = 0, scrubEnd = 11;

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
function updateScheduleReadout() {
  const el = document.getElementById('sched-readout');
  const crop = CROPS[state.crop];
  const valid = isValidMmdd(state.paintStartDate) && isValidMmdd(state.paintEndDate);
  el.innerHTML =
    `<span class="crop-dot" style="background:${crop.hex}"></span>` +
    `<span>${crop.name[state.lang]||crop.name.en} · </span>` +
    `<span class="rng">${valid ? `${state.paintStartDate}-${state.paintEndDate}` : 'Invalid date'}</span>`;
  if (typeof updateHiddenBrushIndicator === 'function') updateHiddenBrushIndicator();
}
window.updateScheduleReadout = updateScheduleReadout;
window.updateScrubberReadout = updateScrubberReadout;

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
function syncSeasonInputs() {
  const startInput = document.getElementById('season-start');
  const endInput = document.getElementById('season-end');
  if (startInput && startInput.value !== state.paintStartDate) startInput.value = state.paintStartDate;
  if (endInput && endInput.value !== state.paintEndDate) endInput.value = state.paintEndDate;
}
function setPaintSeasonRange(start, end) {
  state.paintStartDate = start;
  state.paintEndDate = end;
  state.paintMonths = monthMaskForSeason(start, end);
  syncSeasonInputs();
  updateScheduleReadout();
  window.TANIMAN.schedSave();
}

function nearestMonth(track, clientX){
  const rect = track.getBoundingClientRect();
  const x = clientX - rect.left;
  let m = Math.floor((x / rect.width) * 12);
  if (m < 0) m = 0; if (m > 11) m = 11;
  return m;
}

function populateSeasonMonthSelect() {
  const select = document.getElementById('season-month');
  if (!select) return;
  select.innerHTML = MONTH_FULL_LONG.map((name, i) =>
    `<option value="${i + 1}">${name}</option>`).join('');
}

function wireSeasonPicker() {
  const startInput = document.getElementById('season-start');
  const endInput = document.getElementById('season-end');
  const monthSelect = document.getElementById('season-month');
  if (!startInput || !endInput || !monthSelect) return;

  syncSeasonInputs();
  const applyInputs = () => setPaintSeasonRange(startInput.value.trim(), endInput.value.trim());
  startInput.addEventListener('change', applyInputs);
  startInput.addEventListener('blur', applyInputs);
  endInput.addEventListener('change', applyInputs);
  endInput.addEventListener('blur', applyInputs);

  document.querySelectorAll('[data-season-shortcut]').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = shortcutRange(Number(monthSelect.value), btn.dataset.seasonShortcut);
      if (range) setPaintSeasonRange(range.start, range.end);
    });
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
populateSeasonMonthSelect();
setPaintSeasonRange(state.paintStartDate, state.paintEndDate);
wireSeasonPicker();
wireScrubber();
updateScheduleReadout();
updateScrubberReadout();

})();
