// ── Schedule picker (tools-bar above canvas) & map scrubber ───────
// Both interact through window.TANIMAN exposed by app.js.

(function(){
const { state, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS, monthsBetween, maskToLabel } = window.TANIMAN;

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
  // indicator pill
  const ind = document.createElement('div');
  ind.className = 'scrubber-indicator';
  ind.id = 'scrubber-indicator';
  track.appendChild(ind);
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
function updateScrubberReadout() {
  const ro = document.getElementById('scrub-readout');
  const allBtn = document.getElementById('scrub-all');
  if (state.viewMonth === -1) {
    ro.innerHTML = `<span class="all">${window.TANIMAN.tr('allYear')}</span>`;
    allBtn.classList.add('on');
  } else {
    ro.textContent = MONTH_FULL_LONG[state.viewMonth];
    allBtn.classList.remove('on');
  }
  // update the highlighted month + indicator position
  const track = document.getElementById('scrubber-track');
  track.querySelectorAll('.scrubber-month').forEach(el=>{
    el.classList.toggle('on', +el.dataset.m === state.viewMonth);
  });
  const ind = document.getElementById('scrubber-indicator');
  if (state.viewMonth === -1) {
    ind.style.opacity = '0';
  } else {
    ind.style.opacity = '1';
    // left = month index * (track width / 12) + 6 (padding)
    ind.style.left = `calc(6px + (100% - 12px) * ${state.viewMonth} / 12)`;
  }
}

function setViewMonth(m) {
  state.viewMonth = m;
  updateScrubberReadout();
  window.TANIMAN.renderCanvas();
  window.TANIMAN.drawPlotsOnMap();
  window.TANIMAN.updateLegend();
  window.TANIMAN.saveState();
}

function wireScrubber() {
  const track = document.getElementById('scrubber-track');
  const allBtn = document.getElementById('scrub-all');
  allBtn.onclick = ()=> setViewMonth(-1);
  track.querySelectorAll('.scrubber-month').forEach(el=>{
    el.addEventListener('click', ()=> setViewMonth(+el.dataset.m));
  });
  // also drag-to-scrub
  let scrubDragging = false;
  const pickFromX = (clientX) => {
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    let m = Math.floor(((x - 6) / (rect.width - 12)) * 12);
    if (m < 0) m = 0; if (m > 11) m = 11;
    setViewMonth(m);
  };
  track.addEventListener('mousedown', (e)=>{ scrubDragging = true; pickFromX(e.clientX); });
  document.addEventListener('mousemove', (e)=>{ if (scrubDragging) pickFromX(e.clientX); });
  document.addEventListener('mouseup', ()=>{ scrubDragging = false; });
  track.addEventListener('touchstart', (e)=>{ scrubDragging = true; pickFromX(e.touches[0].clientX); }, {passive:false});
  track.addEventListener('touchmove', (e)=>{ if (scrubDragging) { e.preventDefault(); pickFromX(e.touches[0].clientX); } }, {passive:false});
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
