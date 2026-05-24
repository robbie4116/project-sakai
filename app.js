// ── Taniman app logic ─────────────────────────────────────────────
// Touches: localStorage autosave, paint-brush with size, metadata, ZIP export
// Single-screen tablet workflow

const GRID = 50;                  // 50 × 50 patches per plot (2500 cells)
const _vparam = new URLSearchParams(location.search).get('variant');
const STORAGE_KEY = _vparam ? `taniman_v2_${_vparam}` : 'taniman_v2';
const PLOTS = window.AMBASSADOR_PLOTS;
const POLY  = window.AMBASSADOR_POLY;
const CROPS = window.CROPS;
const T     = window.STRINGS;

// ── STATE ─────────────────────────────────────────────────────────
const state = loadState() || {
  lang: 'tl',
  theme: 'dark',
  brush: 1,                       // 1, 3, 5, or 'erase'
  crop: 0,                        // index into CROPS
  plotIdx: 0,
  plots: {},                      // {idx: {labels: Uint8Array(2500) of bitmasks, farmer, note, photo}}
  mixedStyle: 'diagonal',         // how to render multi-crop cells: 'diagonal' | 'quadrants' | 'stripes'
  version: 2,                     // v2 = labels are bitmasks (bit i = crop i present)
};
state.mixedStyle = state.mixedStyle || 'diagonal';

// Undo stack — NOT persisted to localStorage (kept in-memory only).
// Each entry: { plotIdx, labels:Uint8Array|null }
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;

// Migrate (Uint8Array → array on load, and v1 single-crop → v2 bitmask)
for (const k of Object.keys(state.plots||{})) {
  const p = state.plots[k];
  if (p && p.labels && !(p.labels instanceof Uint8Array)) {
    p.labels = new Uint8Array(p.labels);
  }
}
if (!state.version || state.version < 2) {
  // Old format stored crop-index+1 (1..4) per cell. Convert to bit (1<<idx).
  for (const k of Object.keys(state.plots||{})) {
    const p = state.plots[k];
    if (p && p.labels) {
      const out = new Uint8Array(p.labels.length);
      for (let i=0; i<p.labels.length; i++) {
        const v = p.labels[i];
        out[i] = v > 0 ? (1 << (v-1)) : 0;
      }
      p.labels = out;
    }
  }
  state.version = 2;
}

// URL-param overrides (for showing variants side-by-side in the design canvas)
const _params = new URLSearchParams(location.search);
if (_params.get('theme'))   state.theme   = _params.get('theme');
if (_params.get('lang'))    state.lang    = _params.get('lang');
if (_params.get('plot'))    state.plotIdx = +_params.get('plot');
if (_params.get('noscroll')) document.documentElement.style.overflow = 'hidden';
// Optional: seed a demo state so the canvas previews look alive
if (_params.get('demo')) {
  const seedDemo = ()=>{
    const seeds = [
      {idx:18, crop:2, n:1400}, {idx:19, crop:0, n:900}, {idx:20, crop:3, n:1100},
      {idx:26, crop:1, n:1700}, {idx:27, crop:2, n:600},  {idx:28, crop:0, n:1300},
      {idx:34, crop:1, n:2000}, {idx:35, crop:3, n:1500}, {idx:42, crop:0, n:800},
    ];
    for (const s of seeds){
      const labels = new Uint8Array(GRID*GRID);
      // paint a blobby region
      const rand = mulberry32(s.idx*97+11);
      const blobs = 6;
      for (let b=0;b<blobs;b++){
        const cx = Math.floor(rand()*GRID), cy = Math.floor(rand()*GRID);
        const rad = 4 + Math.floor(rand()*8);
        for (let r=0;r<GRID;r++) for (let c=0;c<GRID;c++){
          const dx=c-cx, dy=r-cy;
          if (dx*dx+dy*dy < rad*rad) labels[r*GRID+c] |= (1 << s.crop);
        }
      }
      // override the demo plot
      state.plots[s.idx] = { labels, farmer: s.idx===26?'Manong Andoy':'' , note:'', photo:null };
    }
    state.plotIdx = _params.get('plot') ? +_params.get('plot') : 27;
  };
  // run after init
  setTimeout(()=>{ seedDemo(); drawPlotsOnMap(); renderCanvas(); updateProgress(); updatePlotHeader(); }, 0);
}

let map, plotRects = {}, plotMarkers = {};
let painting = false, lastIdx = -1;
let imgCache = {};
let lastSaveAt = Date.now();

// ── HELPERS ───────────────────────────────────────────────────────
function tr(k){ return (T[state.lang]||T.tl)[k] || k; }

function getPlotData(idx) {
  if (!state.plots[idx]) state.plots[idx] = { labels: new Uint8Array(GRID*GRID), farmer:'', note:'', photo:null };
  if (!state.plots[idx].labels) state.plots[idx].labels = new Uint8Array(GRID*GRID);
  return state.plots[idx];
}
// Cells now store a BITMASK: bit i set ↔ crop i present in that cell.
// One cell can therefore hold any subset of the 4 crops.
function cellHasAny(v){ return v > 0; }
function cellCrops(v){
  const out = [];
  for (let i=0; i<CROPS.length; i++) if (v & (1<<i)) out.push(i);
  return out;
}

function plotHasData(idx) {
  const p = state.plots[idx];
  if (!p) return false;
  return (p.labels && p.labels.some(cellHasAny)) || p.farmer || p.note || p.photo;
}
function plotHasPaint(idx) {
  const p = state.plots[idx];
  return !!(p && p.labels && p.labels.some(cellHasAny));
}
function dominantCrop(idx) {
  const p = state.plots[idx];
  if (!p || !p.labels) return null;
  const counts = new Array(CROPS.length).fill(0);
  for (let i=0; i<p.labels.length; i++) {
    const v = p.labels[i];
    if (!v) continue;
    for (let b=0; b<CROPS.length; b++) if (v & (1<<b)) counts[b]++;
  }
  const max = Math.max(...counts);
  if (max === 0) return null;
  return CROPS[counts.indexOf(max)];
}
function plotIsMixed(idx) {
  const p = state.plots[idx];
  if (!p || !p.labels) return false;
  let seen = 0;
  for (let i=0; i<p.labels.length; i++) seen |= p.labels[i];
  // mixed = more than one bit set across the whole plot
  return seen && (seen & (seen-1)) !== 0;
}

// ── MIXED-CELL RENDERING ─────────────────────────────────────────────
function drawMixedCell(ctx, x0, y0, w, h, crops, style){
  if (crops.length === 1){
    ctx.fillStyle = CROPS[crops[0]].hex;
    ctx.fillRect(x0, y0, w+0.5, h+0.5);
    return;
  }
  if (style === 'stripes'){
    const bw = w / crops.length;
    for (let i=0; i<crops.length; i++){
      ctx.fillStyle = CROPS[crops[i]].hex;
      ctx.fillRect(x0 + i*bw, y0, bw + 0.6, h + 0.5);
    }
    return;
  }
  if (style === 'diagonal' && crops.length === 2){
    ctx.fillStyle = CROPS[crops[0]].hex;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CROPS[crops[1]].hex;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.lineTo(x0, y0+h+0.5); ctx.closePath();
    ctx.fill();
    return;
  }
  const hw = w/2, hh = h/2;
  const slots = [[0,0],[hw,0],[0,hh],[hw,hh]];
  let order;
  if (crops.length === 2) order = [0, 1, 1, 0];
  else if (crops.length === 3) order = [0, 1, 2, 0];
  else order = [0, 1, 2, 3];
  for (let i=0; i<4; i++){
    ctx.fillStyle = CROPS[crops[order[i]]].hex;
    ctx.fillRect(x0 + slots[i][0], y0 + slots[i][1], hw + 0.6, hh + 0.6);
  }
}

// ── UNDO ───────────────────────────────────────────────────────────────────
function snapshotForUndo(idx) {
  const p = state.plots[idx];
  const labels = p && p.labels ? new Uint8Array(p.labels) : null;
  undoStack.push({ plotIdx: idx, labels });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoBtn();
}
function undo() {
  const entry = undoStack.pop();
  if (!entry) { updateUndoBtn(); return; }
  // snapshot current state for redo before restoring
  const cur = state.plots[entry.plotIdx];
  redoStack.push({
    plotIdx: entry.plotIdx,
    labels: cur && cur.labels ? new Uint8Array(cur.labels) : null,
  });
  if (!state.plots[entry.plotIdx]) {
    state.plots[entry.plotIdx] = { labels: new Uint8Array(GRID * GRID), farmer: '', note: '', photo: null };
  }
  state.plots[entry.plotIdx].labels = entry.labels || new Uint8Array(GRID * GRID);
  if (state.plotIdx !== entry.plotIdx) {
    state.plotIdx = entry.plotIdx;
    updatePlotHeader();
    drawPlotsOnMap();
  } else {
    updateMapPlot(entry.plotIdx);
  }
  renderCanvas();
  updateProgress();
  refreshMetaToggle();
  schedSave(entry.plotIdx);
  updateUndoBtn();
  toast(tr('undone'));
}
function redo() {
  const entry = redoStack.pop();
  if (!entry) { updateUndoBtn(); return; }
  const cur = state.plots[entry.plotIdx];
  undoStack.push({
    plotIdx: entry.plotIdx,
    labels: cur && cur.labels ? new Uint8Array(cur.labels) : null,
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  if (!state.plots[entry.plotIdx]) {
    state.plots[entry.plotIdx] = { labels: new Uint8Array(GRID * GRID), farmer: '', note: '', photo: null };
  }
  state.plots[entry.plotIdx].labels = entry.labels || new Uint8Array(GRID * GRID);
  if (state.plotIdx !== entry.plotIdx) {
    state.plotIdx = entry.plotIdx;
    updatePlotHeader();
    drawPlotsOnMap();
  } else {
    updateMapPlot(entry.plotIdx);
  }
  renderCanvas();
  updateProgress();
  refreshMetaToggle();
  schedSave(entry.plotIdx);
  updateUndoBtn();
}
function updateUndoBtn() {
  const undo = document.getElementById('btn-undo');
  const redo = document.getElementById('btn-redo');
  if (undo) undo.disabled = undoStack.length === 0;
  if (redo) redo.disabled = redoStack.length === 0;
}
function updateMixedStyleBtn(){
  document.querySelectorAll('.mix-btn').forEach(b=>{
    b.classList.toggle('on', b.dataset.style === state.mixedStyle);
  });
}

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // labels are stored as plain arrays for JSON
    for (const k of Object.keys(s.plots||{})) {
      if (s.plots[k].labels) s.plots[k].labels = new Uint8Array(s.plots[k].labels);
    }
    return s;
  } catch(e){ console.warn('load failed', e); return null; }
}
function saveState(){
  try {
    const out = { ...state, plots:{} };
    for (const k of Object.keys(state.plots)) {
      const p = state.plots[k];
      out.plots[k] = { ...p, labels: p.labels ? Array.from(p.labels) : null };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    lastSaveAt = Date.now();
    updateAutosave();
  } catch(e){ console.warn('save failed', e); }
}

// ── THEME + LANG ──────────────────────────────────────────────────
function applyTheme(){
  document.documentElement.setAttribute('data-theme', state.theme);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===state.theme));
  // Re-tile the map with a theme-appropriate basemap
  if (map && tileLayerRef) {
    map.removeLayer(tileLayerRef);
    tileLayerRef = makeTileLayer().addTo(map);
  }
  // Re-render plot canvas (grid colors depend on theme)
  renderCanvas();
}

function applyLang(){
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.toggle('on', b.dataset.lang===state.lang));
  document.getElementById('brand-sub').textContent = tr('appSub');
  document.getElementById('map-title').textContent = state.lang==='tl' ? 'Ambassador' : state.lang==='ib' ? 'Ambassador' : 'Ambassador';
  document.getElementById('map-hint').textContent = '8 × 8 · 64 ' + (state.lang==='tl'?'plot':'plot');
  document.getElementById('lg-todo').textContent = tr('todo');
  document.getElementById('lg-done').textContent = tr('done');
  document.getElementById('lab-brush').textContent = tr('brush');
  document.getElementById('lab-crop').textContent = tr('crop') + ' · ' + tr('cropsSection');
  const labMix = document.getElementById('lab-mix');
  if (labMix) labMix.textContent = tr('mixedLabel');
  const undoTxt = document.getElementById('btn-undo-txt');
  if (undoTxt) undoTxt.textContent = tr('undo');
  document.getElementById('btn-clear').textContent = tr('clear');
  document.getElementById('btn-save-txt').textContent = tr('saveAll');
  document.getElementById('meta-toggle-txt').textContent = tr('farmerSection');
  document.getElementById('lab-farmer').textContent = tr('farmer');
  document.getElementById('lab-note').textContent = tr('note');
  document.getElementById('lab-photo').textContent = tr('photo');
  document.getElementById('ph-farmer').textContent = tr('farmerPh');
  document.getElementById('ph-note').textContent = tr('notePh');
  // (no progress label translation — using static markup)
  buildPalette();
  updatePlotHeader();
}

// ── MAP ───────────────────────────────────────────────────────────
let tileLayerRef = null;
function makeTileLayer() {
  return L.tileLayer('tiles/map/{z}/{x}/{y}.jpg', {
    minZoom: 12,
    maxZoom: 16,
    errorTileUrl: 'tiles/map/empty.jpg',
    attribution: 'Imagery © Map Tiles API',
  });
}

function initMap(){
  map = L.map('map', { center:[16.482,120.640], zoom:14, zoomControl:false, attributionControl:false });
  tileLayerRef = makeTileLayer().addTo(map);
  L.polygon(POLY, {
    color:'var(--gold)' === 'var(--gold)' ? '#F2C84B' : '#F2C84B',
    weight:2.5, dashArray:'7,5',
    fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
  }).addTo(map);
  drawPlotsOnMap();
  map.fitBounds(L.polygon(POLY).getBounds().pad(0.10));
  document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
  document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
}

function plotStyle(idx){
  const dom = dominantCrop(idx);
  const isCurrent = idx === state.plotIdx;
  if (dom){
    // Mixed beds (>1 crop in the plot) get a white dashed inner border
    const mixed = plotIsMixed(idx);
    return {
      color: isCurrent ? '#F2C84B' : (mixed ? '#FFFFFF' : dom.hex),
      weight: isCurrent ? 3 : (mixed ? 2 : 1.6),
      fillColor: dom.hex, fillOpacity: 0.62,
      dashArray: mixed && !isCurrent ? '4,3' : null,
    };
  }
  // Empty plot. Gold highlight if it’s the one being edited; otherwise faint outline.
  return isCurrent
    ? { color:'#F2C84B', weight:3, fillColor:'#F2C84B', fillOpacity:0.18, dashArray:null }
    : { color:'#7EA77E', weight:1.2, fillColor:'#7EA77E', fillOpacity:0.05, dashArray:'4,3' };
}

function drawPlotsOnMap(){
  Object.values(plotRects).forEach(r=>map.removeLayer(r));
  Object.values(plotMarkers).forEach(m=>map.removeLayer(m));
  plotRects = {}; plotMarkers = {};

  PLOTS.forEach(plot=>{
    const style = plotStyle(plot.idx);
    const rect = L.rectangle(
      [[plot.latS, plot.lngW],[plot.latN, plot.lngE]],
      style
    ).addTo(map);

    const marker = L.marker([plot.centerLat, plot.centerLng], {
      icon: L.divIcon({
        className:'',
        html:`<div class="plot-num">${plot.idx+1}</div>`,
        iconSize:[24,14], iconAnchor:[12,7]
      }),
      interactive:false
    }).addTo(map);

    rect.on('click', ()=>openPlot(plot.idx));
    rect.on('mouseover', function(){
      if (plot.idx===state.plotIdx) return;
      const s = plotStyle(plot.idx);
      this.setStyle({ ...s, weight: Math.max(s.weight, 2.2), fillOpacity: Math.max(s.fillOpacity, 0.25) });
    });
    rect.on('mouseout', function(){
      if (plot.idx===state.plotIdx) return;
      this.setStyle(plotStyle(plot.idx));
    });

    plotRects[plot.idx] = rect;
    plotMarkers[plot.idx] = marker;
  });
}

// ── PLOT CANVAS ───────────────────────────────────────────────────
const canvas = document.getElementById('plot-canvas');
const ctx = canvas.getContext('2d');

function fitCanvas(){
  const frame = document.getElementById('canvas-frame');
  const zone = document.querySelector('.canvas-zone');
  const pad = 36;
  const size = Math.max(120, Math.min(zone.clientWidth - pad, zone.clientHeight - pad));
  frame.style.width = size + 'px';
  frame.style.height = size + 'px';
  canvas.width = size;
  canvas.height = size;
}

function getTile(idx) {
  if (!imgCache[idx]) {
    const img = new Image();
    img.onload = () => renderCanvas();
    img.src = `tiles/plots/plot_${String(idx).padStart(3, '0')}.jpg`;
    imgCache[idx] = img;
  }
  return imgCache[idx];
}

function renderCanvas(){
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  ctx.clearRect(0,0,w,h);

  // base image
  const tile = getTile(state.plotIdx);
  if (tile.complete && tile.naturalWidth > 0) {
    ctx.drawImage(tile, 0, 0, w, h);
  } else {
    ctx.fillStyle = getCss('--canvas-bg');
    ctx.fillRect(0, 0, w, h);
  }

  // semi-transparent darkening overlay in dark theme so paint pops
  if (state.theme === 'dark'){
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0,0,w,h);
  } else if (state.theme === 'contrast'){
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(0,0,w,h);
  }

  // crop labels — each cell is a bitmask of crops present.
  // Multi-crop cells use the active mixedStyle.
  const p = getPlotData(state.plotIdx);
  const cellW = w / GRID, cellH = h / GRID;
  const baseAlpha = state.theme==='contrast' ? 0.92 : 0.80;
  for (let r=0;r<GRID;r++){
    for (let c=0;c<GRID;c++){
      const v = p.labels[r*GRID+c];
      if (!v) continue;
      const crops = cellCrops(v);
      const x0 = c*cellW, y0 = r*cellH;
      ctx.globalAlpha = crops.length > 1 ? Math.min(.94, baseAlpha + 0.06) : baseAlpha;
      drawMixedCell(ctx, x0, y0, cellW, cellH, crops, state.mixedStyle);
    }
  }
  ctx.globalAlpha = 1;

  // minor grid (subtle, every 5 cells)
  ctx.strokeStyle = getCss('--grid-line');
  ctx.lineWidth = 0.8;
  for (let i=5;i<GRID;i+=5){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  // major grid (every 10)
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.4;
  for (let i=10;i<GRID;i+=10){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  // outer frame
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0.5,0.5,w-1,h-1);

  // patch counter
  const cnt = p.labels.reduce((n,v)=>n + (v?1:0), 0);
  document.getElementById('canvas-corner').textContent =
    `${GRID}×${GRID} · ${cnt} / ${GRID*GRID}`;
}

function getCss(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

// ── PAINTING ──────────────────────────────────────────────────────
function cellAt(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const c = Math.floor(x / (rect.width / GRID));
  const r = Math.floor(y / (rect.height / GRID));
  if (c<0||c>=GRID||r<0||r>=GRID) return null;
  return {r,c};
}

function paintAt(clientX, clientY){
  const cell = cellAt(clientX, clientY);
  if (!cell) return;
  const linear = cell.r*GRID + cell.c;
  if (linear === lastIdx) return;
  lastIdx = linear;

  const p = getPlotData(state.plotIdx);
  const size = state.brush==='erase' ? 1 : state.brush;
  const half = Math.floor(size/2);
  const bit = 1 << state.crop;
  for (let dr=-half; dr<=half; dr++){
    for (let dc=-half; dc<=half; dc++){
      const rr = cell.r+dr, cc = cell.c+dc;
      if (rr<0||rr>=GRID||cc<0||cc>=GRID) continue;
      const k = rr*GRID+cc;
      if (state.brush==='erase') p.labels[k] = 0;
      else p.labels[k] |= bit;            // ADD this crop to whatever is already here
    }
  }
  renderCanvas();
  updateProgress();
  updateMapPlot(state.plotIdx);
  schedSave();
}

function updateMapPlot(idx){
  const rect = plotRects[idx];
  if (rect) rect.setStyle(plotStyle(idx));
}

let saveTimer = null;
function schedSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

// Mouse + touch handlers
function onDown(e){
  if (e.target !== canvas) return;
  painting = true; lastIdx = -1;
  snapshotForUndo(state.plotIdx);
  e.preventDefault();
  const pt = e.touches ? e.touches[0] : e;
  paintAt(pt.clientX, pt.clientY);
}
function onMove(e){
  // Brush cursor
  const cursor = document.getElementById('brush-cursor');
  const rect = canvas.getBoundingClientRect();
  const pt = e.touches ? e.touches[0] : e;
  if (pt && pt.clientX>=rect.left && pt.clientX<=rect.right && pt.clientY>=rect.top && pt.clientY<=rect.bottom){
    const size = state.brush==='erase' ? 1 : state.brush;
    const cellPx = rect.width / GRID;
    cursor.style.display = 'block';
    cursor.style.width = (cellPx*size) + 'px';
    cursor.style.height = (cellPx*size) + 'px';
    const cell = cellAt(pt.clientX, pt.clientY);
    if (cell){
      const half = Math.floor(size/2);
      cursor.style.left = ((cell.c-half)*cellPx) + 'px';
      cursor.style.top  = ((cell.r-half)*cellPx) + 'px';
      cursor.style.borderColor = state.brush==='erase' ? 'var(--danger)' : CROPS[state.crop].hex;
    }
  } else {
    cursor.style.display = 'none';
  }
  if (painting && pt){
    e.preventDefault();
    paintAt(pt.clientX, pt.clientY);
  }
}
function onUp(){ painting = false; }

canvas.addEventListener('mousedown', onDown);
document.addEventListener('mousemove', onMove);
document.addEventListener('mouseup', onUp);
canvas.addEventListener('touchstart', onDown, {passive:false});
canvas.addEventListener('touchmove', onMove, {passive:false});
canvas.addEventListener('touchend', onUp);
canvas.addEventListener('mouseleave', ()=>{ document.getElementById('brush-cursor').style.display='none'; });

// ── PALETTE ───────────────────────────────────────────────────────
function buildPalette(){
  const root = document.getElementById('crop-grid');
  root.innerHTML = '';
  CROPS.forEach((crop,i)=>{
    const b = document.createElement('button');
    b.className = 'crop-btn' + (i===state.crop?' on':'');
    b.style.borderColor = i===state.crop ? crop.hex : '';
    b.innerHTML = `
      <div class="swatch" style="background:${crop.hex}"></div>
      <div class="info">
        <div class="nm">${crop.name[state.lang]||crop.name.en}</div>
        <div class="ct">${crop.name.en}</div>
      </div>
      <div class="chk">✓</div>
    `;
    b.onclick = ()=>{
      state.crop = i;
      // also exit erase mode when picking a crop
      if (state.brush==='erase') state.brush = 1;
      buildPalette();
      updateBrush();
      schedSave();
    };
    root.appendChild(b);
  });
}

function updateBrush(){
  document.querySelectorAll('.brush-btn').forEach(b=>{
    const v = b.dataset.brush;
    b.classList.toggle('on', (v==='erase' && state.brush==='erase') || (v!=='erase' && +v===state.brush));
  });
}

// ── PLOT NAVIGATION ───────────────────────────────────────────────
function openPlot(idx){
  if (idx<0||idx>=PLOTS.length) return;
  const prev = state.plotIdx;
  state.plotIdx = idx;
  updatePlotHeader();
  renderCanvas();
  updateMapPlot(prev);
  updateMapPlot(idx);
  // pan to plot if off-screen
  const plot = PLOTS[idx];
  const bounds = L.latLngBounds([[plot.latS,plot.lngW],[plot.latN,plot.lngE]]);
  if (!map.getBounds().contains(bounds)) map.panTo([plot.centerLat,plot.centerLng], {animate:true});
  document.getElementById('prev-btn').disabled = idx===0;
  document.getElementById('next-btn').disabled = idx===PLOTS.length-1;
  loadMetadataIntoDrawer();
  refreshMetaToggle();
  schedSave();
}

function updatePlotHeader(){
  const plot = PLOTS[state.plotIdx];
  if (!plot) return;
  document.getElementById('plot-name').textContent = tr('plotN').replace('{n}', String(state.plotIdx+1).padStart(2,'0'));
  document.getElementById('plot-of').textContent = '';
  document.getElementById('plot-loc').textContent =
    `R${plot.r} · C${plot.c} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
  document.getElementById('dr-title').textContent =
    tr('plotN').replace('{n}', String(state.plotIdx+1).padStart(2,'0')) + ' — ' + tr('plotSection').toLowerCase();
}

function refreshMetaToggle(){
  const p = state.plots[state.plotIdx];
  const has = p && (p.farmer || p.note || p.photo);
  document.getElementById('meta-toggle').classList.toggle('has-data', !!has);
}

// ── PROGRESS ──────────────────────────────────────────────────────
function updateProgress(){
  const markedPlots = Object.keys(state.plots).filter(k=>plotHasPaint(+k));
  const done = markedPlots.length;
  // Count painted patches (non-zero labels) across all marked plots
  let patches = 0;
  markedPlots.forEach(k=>{
    const labels = state.plots[+k].labels;
    if (!labels) return;
    const arr = Array.isArray(labels) ? labels : Array.from(labels);
    for (let i=0;i<arr.length;i++) if (arr[i]>0) patches++;
  });
  document.getElementById('prog-done').textContent = done;
  document.getElementById('prog-patches').textContent = patches.toLocaleString();
  document.getElementById('save-count').textContent = done;
}

// ── AUTOSAVE INDICATOR ────────────────────────────────────────────
function updateAutosave(){
  const ago = Date.now() - lastSaveAt;
  let txt;
  if (ago < 3000)       txt = tr('autosaved') + ' · ' + tr('justNow');
  else if (ago < 60000) txt = tr('autosaved') + ' · ' + Math.floor(ago/1000) + 's';
  else                  txt = tr('autosaved') + ' · ' + Math.floor(ago/60000) + 'm';
  document.getElementById('autosave-txt').textContent = txt;
}
setInterval(updateAutosave, 1000);

// ── METADATA DRAWER ───────────────────────────────────────────────
const scrim = document.getElementById('scrim');
const drawer = document.getElementById('drawer');
function openDrawer(){
  loadMetadataIntoDrawer();
  scrim.classList.add('on');
  drawer.classList.add('on');
}
function closeDrawer(){
  scrim.classList.remove('on');
  drawer.classList.remove('on');
}
document.getElementById('meta-toggle').onclick = openDrawer;
document.getElementById('dr-close').onclick = closeDrawer;
scrim.onclick = closeDrawer;

function loadMetadataIntoDrawer(){
  const p = getPlotData(state.plotIdx);
  document.getElementById('in-farmer').value = p.farmer || '';
  document.getElementById('in-note').value = p.note || '';
  renderPhoto(p.photo);
}
function renderPhoto(dataUrl){
  const area = document.getElementById('photo-area');
  if (dataUrl){
    area.innerHTML = `<div class="photo-preview"><img src="${dataUrl}"><button class="x" id="photo-x">×</button></div>`;
    document.getElementById('photo-x').onclick = ()=>{
      getPlotData(state.plotIdx).photo = null;
      renderPhoto(null);
      schedSave(); refreshMetaToggle();
    };
  } else {
    area.innerHTML = `<div class="photo-slot" id="photo-slot">
      <span class="ico">📷</span>
      <div class="lab">${tr('addPhoto')}</div>
    </div>`;
    document.getElementById('photo-slot').onclick = ()=>document.getElementById('in-photo').click();
  }
}
document.getElementById('in-farmer').oninput = (e)=>{
  getPlotData(state.plotIdx).farmer = e.target.value;
  schedSave(); refreshMetaToggle();
};
document.getElementById('in-note').oninput = (e)=>{
  getPlotData(state.plotIdx).note = e.target.value;
  schedSave(); refreshMetaToggle();
};
document.getElementById('in-photo').onchange = async (e)=>{
  const file = e.target.files[0]; if (!file) return;
  const dataUrl = await new Promise(res=>{
    const fr = new FileReader();
    fr.onload = ()=>res(fr.result);
    fr.readAsDataURL(file);
  });
  // Shrink to 800px max width
  const img = new Image();
  img.onload = ()=>{
    const max = 800;
    const scale = Math.min(1, max/img.width, max/img.height);
    const c = document.createElement('canvas');
    c.width = img.width*scale; c.height = img.height*scale;
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const small = c.toDataURL('image/jpeg', .82);
    getPlotData(state.plotIdx).photo = small;
    renderPhoto(small);
    schedSave(); refreshMetaToggle();
  };
  img.src = dataUrl;
};

// ── CLEAR ─────────────────────────────────────────────────────────
document.getElementById('btn-clear').onclick = ()=>{
  if (!plotHasData(state.plotIdx)) return;
  if (!confirm(tr('confirmClear'))) return;
  snapshotForUndo(state.plotIdx);
  delete state.plots[state.plotIdx];
  renderCanvas(); updateProgress(); updateMapPlot(state.plotIdx);
  loadMetadataIntoDrawer(); refreshMetaToggle();
  saveState();
  toast(tr('cleared'));
};

document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;
document.querySelectorAll('.mix-btn').forEach(b=>{
  b.onclick = ()=>{
    state.mixedStyle = b.dataset.style;
    updateMixedStyleBtn();
    renderCanvas();
    saveState();
  };
});

// ── ZIP EXPORT ────────────────────────────────────────────────────
document.getElementById('btn-save').onclick = async ()=>{
  const indices = Object.keys(state.plots).map(k=>+k).filter(plotHasData);
  if (!indices.length){ toast(tr('empty')); return; }
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span>';

  const zip = new JSZip();
  const folder = zip.folder('ambassador_cropmap_'+new Date().toISOString().slice(0,10));

  let csv = 'plot_idx,row,col,centerLat,centerLng,crop_id,crop_en,patch_row,patch_col\n';
  const meta = [];

  const oc = document.createElement('canvas');
  oc.width = 500; oc.height = 500;
  const oct = oc.getContext('2d');

  for (const idx of indices){
    const p = state.plots[idx];
    const plot = PLOTS[idx];

    // png label map — one row per cell. Multi-crop cells use the active mixed style.
    if (p.labels && p.labels.some(cellHasAny)){
      oct.fillStyle = '#0A1A0A'; oct.fillRect(0,0,500,500);
      for (let r=0;r<GRID;r++) for (let c=0;c<GRID;c++){
        const v = p.labels[r*GRID+c];
        if (!v) continue;
        const crops = cellCrops(v);
        drawMixedCell(oct, c*10, r*10, 10, 10, crops, state.mixedStyle);
      }
      folder.file(`labels/plot${String(idx).padStart(3,'0')}.png`,
        oc.toDataURL('image/png').split(',')[1], {base64:true});

      // CSV — one row per (cell, crop) pair so mixed cells appear N times.
      for (let r=0;r<GRID;r++) for (let c=0;c<GRID;c++){
        const v = p.labels[r*GRID+c];
        if (!v) continue;
        for (const ci of cellCrops(v)){
          csv += `${idx},${plot.r},${plot.c},${plot.centerLat},${plot.centerLng},${CROPS[ci].id},${CROPS[ci].name.en},${r},${c}\n`;
        }
      }
    }

    // farmer photo
    if (p.photo){
      folder.file(`photos/plot${String(idx).padStart(3,'0')}.jpg`,
        p.photo.split(',')[1], {base64:true});
    }

    meta.push({
      plot_idx: idx,
      row: plot.r, col: plot.c,
      centerLat: plot.centerLat, centerLng: plot.centerLng,
      farmer: p.farmer || '',
      note: p.note || '',
      has_photo: !!p.photo,
      crop_counts: (() => {
        const out = {};
        if (p.labels) {
          for (let i=0; i<CROPS.length; i++) {
            const bit = 1 << i;
            let c = 0;
            for (let j=0; j<p.labels.length; j++) if (p.labels[j] & bit) c++;
            if (c>0) out[CROPS[i].id] = c;
          }
        }
        return out;
      })(),
    });
  }

  folder.file('labels.csv', csv);
  folder.file('metadata.json', JSON.stringify({
    survey_area:'Ambassador, Tublay, Benguet',
    surveyed_at: new Date().toISOString(),
    grid_resolution: `${GRID}x${GRID}`,
    crops: CROPS.map(c=>({id:c.id, hex:c.hex, name:c.name})),
    plots: meta
  }, null, 2));

  const blob = await zip.generateAsync({type:'blob'});
  saveAs(blob, `ambassador_cropmap_${new Date().toISOString().slice(0,10)}.zip`);
  btn.disabled = false;
  btn.innerHTML = oldHtml;
  toast(tr('saved'));
};

// ── TOAST ─────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  document.getElementById('toast-txt').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ── EVENT WIRING ──────────────────────────────────────────────────
document.querySelectorAll('.theme-btn').forEach(b=>{
  b.onclick = ()=>{ state.theme = b.dataset.theme; applyTheme(); saveState(); };
});
document.querySelectorAll('.lang-btn').forEach(b=>{
  b.onclick = ()=>{ state.lang = b.dataset.lang; applyLang(); saveState(); };
});
document.querySelectorAll('.brush-btn').forEach(b=>{
  b.onclick = ()=>{
    const v = b.dataset.brush;
    state.brush = v==='erase' ? 'erase' : +v;
    updateBrush();
    saveState();
  };
});
document.getElementById('prev-btn').onclick = ()=>openPlot(state.plotIdx-1);
document.getElementById('next-btn').onclick = ()=>openPlot(state.plotIdx+1);
document.addEventListener('keydown', (e)=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault(); redo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault(); redo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){
    e.preventDefault(); undo(); return;
  }
  if (e.key === 'ArrowLeft') openPlot(state.plotIdx-1);
  if (e.key === 'ArrowRight') openPlot(state.plotIdx+1);
  if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4'){
    state.crop = +e.key - 1; buildPalette();
  }
  if (e.key === 'e' || e.key === 'E'){ state.brush = 'erase'; updateBrush(); }
});

window.addEventListener('resize', ()=>{ fitCanvas(); renderCanvas(); });

// ── INIT ──────────────────────────────────────────────────────────
applyTheme();
applyLang();
initMap();
fitCanvas();
buildPalette();
updateBrush();
updateMixedStyleBtn();
updateUndoBtn();
renderCanvas();
updateProgress();
updatePlotHeader();
updateAutosave();
refreshMetaToggle();
document.getElementById('prev-btn').disabled = state.plotIdx===0;
document.getElementById('next-btn').disabled = state.plotIdx===PLOTS.length-1;

// Use ResizeObserver so canvas always matches its container.
const _ro = new ResizeObserver(()=>{ fitCanvas(); renderCanvas(); });
_ro.observe(document.querySelector('.canvas-zone'));

// Force map size recalc after layout settles
setTimeout(()=>{ if (map) map.invalidateSize(); fitCanvas(); renderCanvas(); }, 80);
setTimeout(()=>{ if (map) map.invalidateSize(); }, 400);
