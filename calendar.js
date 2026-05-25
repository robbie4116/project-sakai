// ── Schedule picker (tools-bar above canvas) & map scrubber ───────
// Both interact through window.TANIMAN exposed by app.js.

(function(){
const {
  state, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  monthsBetween, maskToLabel, normalizeViewMonths, viewMonthFromMask,
  maskToDisplayLabel, isBrushHiddenOnMap,
} = window.TANIMAN;

// ── BUILD: schedule track + scrubber DOM ──────────────────────────
function buildScheduleTrack() {
  const track = document.getElementById('sched-track');
  track.innerHTML = '';
  for (let m=0; m<12; m++) {
    const cell = document.createElement('div');
    cell.className = 'sched-month';
    cell.dataset.m = m;
    cell.textContent = MONTH_SHORT[m];
    track.appendChild(cell);
  }
  // fill bar overlay
  const fill = document.createElement('div');
  fill.className = 'sched-track-fill';
  fill.id = 'sched-track-fill';
  track.appendChild(fill);
}

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
}

// ── SCHEDULE PICKER LOGIC ─────────────────────────────────────────
function updateScheduleVisuals() {
  const track = document.getElementById('sched-track');
  const s = state.paintStart, e = state.paintEnd;
  const inRange = (m)=> !!(state.paintMonths & (1<<m));
  const showEndpoints = state.paintMonths !== ALL_MONTHS;
  track.querySelectorAll('.sched-month').forEach((el)=>{
    const m = +el.dataset.m;
    el.classList.toggle('in-range', inRange(m));
    el.classList.toggle('endpoint', showEndpoints && (m === s || m === e));
  });
}
function updateScheduleReadout() {
  const el = document.getElementById('sched-readout');
  const crop = CROPS[state.crop];
  el.innerHTML =
    `<span class="crop-dot" style="background:${crop.hex}"></span>` +
    `<span>${crop.name[state.lang]||crop.name.en} · </span>` +
    `<span class="rng">${maskToLabel(state.paintMonths)}</span>`;
  if (typeof updateHiddenBrushIndicator === 'function') updateHiddenBrushIndicator();
}
window.updateScheduleReadout = updateScheduleReadout;
window.updateScrubberReadout = updateScrubberReadout;

let dragging = null; // 'start' | 'end' | null
function setRange(s, e) {
  state.paintStart = s;
  state.paintEnd = e;
  state.paintMonths = monthsBetween(s, e);
  updateScheduleVisuals();
  updateScheduleReadout();
  syncQuickButtons();
  window.TANIMAN.schedSave();
}

function nearestMonth(track, clientX){
  const rect = track.getBoundingClientRect();
  const x = clientX - rect.left;
  let m = Math.floor((x / rect.width) * 12);
  if (m < 0) m = 0; if (m > 11) m = 11;
  return m;
}

function wireSchedulePicker() {
  const track = document.getElementById('sched-track');

  const startInteract = (clientX) => {
    const m = nearestMonth(track, clientX);
    // pick whichever endpoint is closer; ties go to end so user can extend
    const ds = Math.abs(m - state.paintStart);
    const de = Math.abs(m - state.paintEnd);
    dragging = ds < de ? 'start' : 'end';
    if (dragging === 'start') setRange(m, state.paintEnd);
    else setRange(state.paintStart, m);
  };
  const moveInteract = (clientX) => {
    if (!dragging) return;
    const m = nearestMonth(track, clientX);
    if (dragging === 'start') setRange(m, state.paintEnd);
    else setRange(state.paintStart, m);
  };
  const endInteract = () => { dragging = null; };

  track.addEventListener('mousedown', (e)=>{ e.preventDefault(); startInteract(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if (dragging) moveInteract(e.clientX); });
  document.addEventListener('mouseup', endInteract);
  track.addEventListener('touchstart', (e)=>{ e.preventDefault(); startInteract(e.touches[0].clientX); }, {passive:false});
  track.addEventListener('touchmove', (e)=>{ if (dragging) { e.preventDefault(); moveInteract(e.touches[0].clientX); } }, {passive:false});
  track.addEventListener('touchend', endInteract);
}

function wireQuickButtons() {
  const allBtn  = document.getElementById('q-all');
  const rainBtn = document.getElementById('q-rainy');
  const coolBtn = document.getElementById('q-cool');
  const hotBtn  = document.getElementById('q-hot');
  rainBtn.title = 'Rainy season · Jun–Nov';
  coolBtn.title = 'Cool dry season · Dec–Feb';
  hotBtn.title  = 'Hot dry season · Mar–May';
  allBtn.onclick  = ()=>{ setRange(0,11); state.paintMonths = ALL_MONTHS; updateScheduleVisuals(); updateScheduleReadout(); syncQuickButtons(); };
  rainBtn.onclick = ()=> setRange(5, 10);
  coolBtn.onclick = ()=> setRange(11, 1);
  hotBtn.onclick  = ()=> setRange(2, 4);
}
function syncQuickButtons() {
  const m = state.paintMonths;
  document.getElementById('q-all').classList.toggle('on',   m === ALL_MONTHS);
  document.getElementById('q-rainy').classList.toggle('on', m === monthsBetween(5,10));
  document.getElementById('q-cool').classList.toggle('on',  m === monthsBetween(11,1));
  document.getElementById('q-hot').classList.toggle('on',   m === monthsBetween(2,4));
}

// ── MAP MONTH SCRUBBER LOGIC ──────────────────────────────────────
function updateHiddenBrushIndicator() {
  const el = document.getElementById('scrub-hidden-warning');
  if (!el) return;
  const hidden = isBrushHiddenOnMap(state.viewMonths, state.paintMonths);
  el.hidden = !hidden;
  el.textContent = hidden
    ? `Current brush: ${maskToDisplayLabel(state.paintMonths)} hidden on map`
    : '';
}

function updateScrubberReadout() {
  const ro = document.getElementById('scrub-readout');
  const allBtn = document.getElementById('scrub-all');
  const label = maskToDisplayLabel(state.viewMonths, { singleLong: true });
  ro.innerHTML = state.viewMonths === ALL_MONTHS ? `<span class="all">${label}</span>` : label;
  allBtn.classList.toggle('on', state.viewMonths === ALL_MONTHS);
  const track = document.getElementById('scrubber-track');
  track.querySelectorAll('.scrubber-month').forEach(el=>{
    const m = +el.dataset.m;
    const inRange = !!(state.viewMonths & (1<<m));
    el.classList.toggle('on', inRange);
    el.classList.toggle('in-range', inRange);
    el.classList.toggle('endpoint', state.viewMonths !== ALL_MONTHS && inRange);
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
  allBtn.onclick = ()=> setViewMonths(ALL_MONTHS);

  let scrubDragging = false;
  let scrubStart = 0;
  let scrubMoved = false;
  const pickFromX = (clientX) => {
    return nearestMonth(track, clientX);
  };
  const startScrub = (clientX) => {
    scrubDragging = true;
    scrubMoved = false;
    scrubStart = pickFromX(clientX);
    setViewMonths(1 << scrubStart);
  };
  const moveScrub = (clientX) => {
    if (!scrubDragging) return;
    const m = pickFromX(clientX);
    scrubMoved = scrubMoved || m !== scrubStart;
    setViewMonths(scrubMoved ? monthsBetween(scrubStart, m) : (1 << scrubStart));
  };
  track.addEventListener('mousedown', (e)=>{ e.preventDefault(); startScrub(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ moveScrub(e.clientX); });
  document.addEventListener('mouseup', ()=>{ scrubDragging = false; });
  track.addEventListener('touchstart', (e)=>{ e.preventDefault(); startScrub(e.touches[0].clientX); }, {passive:false});
  track.addEventListener('touchmove', (e)=>{ if (scrubDragging) { e.preventDefault(); moveScrub(e.touches[0].clientX); } }, {passive:false});
  track.addEventListener('touchend', ()=>{ scrubDragging = false; });
}

// ── INIT ──────────────────────────────────────────────────────────
buildScheduleTrack();
buildScrubberTrack();
wireSchedulePicker();
wireQuickButtons();
wireScrubber();
updateScheduleVisuals();
updateScheduleReadout();
syncQuickButtons();
updateScrubberReadout();

})();
