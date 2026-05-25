// ── Taniman v3 ───────────────────────────────────────────────────
// Redesign adds: per-cell crop calendar (12 months), proper per-crop colors,
// optional Farmer ID + roster view, month scrubber on the map.

// ── CONFIG ────────────────────────────────────────────────────────
const GRID = 50;
const STORAGE_KEY = 'taniman_v3';
const PLOTS = window.AMBASSADOR_PLOTS;
const POLY  = window.AMBASSADOR_POLY;
const CROPS = window.CROPS;
const T     = window.STRINGS;

const MONTH_SHORT = ['J','F','M','A','M','J','J','A','S','O','N','D'];
const MONTH_FULL  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// month mask helpers (12-bit)
const ALL_MONTHS = 0xFFF;
function monthsBetween(s, e) {
  // inclusive range, supports wrap (s > e means e.g. Nov–Feb)
  let mask = 0;
  if (s <= e) {
    for (let i=s; i<=e; i++) mask |= (1<<i);
  } else {
    for (let i=s; i<12; i++) mask |= (1<<i);
    for (let i=0; i<=e; i++) mask |= (1<<i);
  }
  return mask;
}
function maskHas(mask, m) { return !!(mask & (1<<m)); }
function maskList(mask) {
  const out = [];
  for (let i=0; i<12; i++) if (mask & (1<<i)) out.push(i);
  return out;
}
function maskToLabel(mask) {
  if (mask === 0) return '—';
  if (mask === ALL_MONTHS) return 'All year';
  // find contiguous ranges (with wrap support)
  const months = maskList(mask);
  if (months.length === 1) return MONTH_FULL[months[0]];
  // simple: list ranges with wrap
  // shift so that gap is at start
  let startBit = 0;
  while (mask & (1<<startBit)) startBit++;
  if (startBit >= 12) return 'All year';
  const ranges = [];
  let cur = null;
  for (let k=0; k<12; k++) {
    const m = (startBit + k) % 12;
    if (mask & (1<<m)) {
      if (!cur) cur = { s:m, e:m };
      else cur.e = m;
    } else if (cur) {
      ranges.push(cur); cur = null;
    }
  }
  if (cur) ranges.push(cur);
  return ranges.map(r => r.s===r.e ? MONTH_FULL[r.s] : `${MONTH_FULL[r.s]}–${MONTH_FULL[r.e]}`).join(', ');
}

// ── STATE ─────────────────────────────────────────────────────────
const state = loadState() || {
  lang: 'en',
  theme: 'dark',
  brush: 1,
  crop: 0,
  plotIdx: 0,
  plots: {},
  // new in v3:
  paintMonths: ALL_MONTHS,    // mask of months that new paint applies to
  paintStart: 0,              // start month of current range (for UI handle dragging)
  paintEnd: 11,               // end month of current range
  viewMonth: -1,              // -1 = all months; 0..11 = scrub to month
  mixedStyle: 'diagonal',
  showTweaks: false,
  version: 3,
};

// fill in any missing keys (state was loaded from a previous version)
if (state.paintMonths === undefined) state.paintMonths = ALL_MONTHS;
if (state.paintStart === undefined) state.paintStart = 0;
if (state.paintEnd === undefined) state.paintEnd = 11;
if (state.viewMonth === undefined) state.viewMonth = -1;
if (!state.mixedStyle) state.mixedStyle = 'diagonal';

// Per-plot data structure:
//   p.cells   = [ Uint16Array(2500) per crop ]  -- 12-bit month mask per cell
//   p.farmerId = 'F-001' | ''
//   p.farmer  = '' (legacy: human name)
//   p.note, p.photos
function emptyCells() { return CROPS.map(() => new Uint16Array(GRID*GRID)); }
function ensurePlot(idx) {
  let p = state.plots[idx];
  if (!p) {
    p = state.plots[idx] = { cells: emptyCells(), farmerId:'', farmer:'', note:'', photos:[] };
    return p;
  }
  // Restore typed arrays from JSON
  if (p.cells && Array.isArray(p.cells) && p.cells.length === CROPS.length) {
    p.cells = p.cells.map(arr => arr instanceof Uint16Array ? arr : new Uint16Array(arr));
  } else {
    p.cells = emptyCells();
  }
  // Migrate v2 bitmask → v3 monthly mask (assume year-round)
  if (p.labels) {
    const arr = p.labels instanceof Uint8Array ? p.labels : new Uint8Array(p.labels);
    for (let i=0; i<arr.length; i++) {
      const v = arr[i];
      if (!v) continue;
      for (let c=0; c<CROPS.length; c++) {
        if (v & (1<<c)) p.cells[c][i] = ALL_MONTHS;
      }
    }
    delete p.labels;
  }
  if (p.farmerId === undefined) p.farmerId = '';
  if (p.photos === undefined) p.photos = [];
  return p;
}

// device id (kept for future cloud sync)
function getDeviceId() {
  let id = localStorage.getItem('taniman_device_id');
  if (!id) { id = 'dev_'+Math.random().toString(36).slice(2,10); localStorage.setItem('taniman_device_id', id); }
  return id;
}
const DEVICE_ID = getDeviceId();

// URL overrides
const _params = new URLSearchParams(location.search);
if (_params.get('theme'))   state.theme   = _params.get('theme');
if (_params.get('lang'))    state.lang    = _params.get('lang');
if (_params.get('plot'))    state.plotIdx = +_params.get('plot');

// ── HELPERS ───────────────────────────────────────────────────────
function tr(k){ return (T[state.lang]||T.en)[k] || k; }
function getCss(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

let map, plotRects = {}, plotMarkers = {};
let painting = false, lastIdx = -1;
let imgCache = {};
let lastSaveAt = Date.now();
let detailDraft = null;

// ── PERSISTENCE ───────────────────────────────────────────────────
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    for (const k of Object.keys(s.plots||{})) {
      const p = s.plots[k];
      if (p.cells) p.cells = p.cells.map(a => new Uint16Array(a));
    }
    return s;
  } catch(e){ console.warn('load failed', e); return null; }
}
function saveState(){
  try {
    const out = { ...state, plots:{} };
    for (const k of Object.keys(state.plots)) {
      const p = state.plots[k];
      out.plots[k] = {
        ...p,
        cells: p.cells ? p.cells.map(a => Array.from(a)) : null,
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    lastSaveAt = Date.now();
    updateAutosave();
  } catch(e){ console.warn('save failed', e); }
}

// ── CLOUD SYNC ───────────────────────────────────────────────────
const cloudDirty = new Set();
let cloudTimer = null;
const CLOUD_SYNC_DELAY = 1800;
const CLOUD_RETRY_DELAY = 30000;

function hasSyncPlots() { return typeof window.syncPlots === 'function'; }
function hasSyncInit() { return typeof window.syncInit === 'function'; }
function hasSyncOnNavigate() { return typeof window.syncOnNavigate === 'function'; }
function isCloudDirty(idx) {
  const p = state.plots[idx];
  return cloudDirty.has(idx) || !!(p && p._dirty_at);
}
function mayMergeRemote(idx) { return !isCloudDirty(idx); }
function hasPendingPhotoUpload(idx) {
  const p = state.plots[idx];
  return !!(p && p.photos && p.photos.some(ph => ph && ph.dataUrl && !ph.url));
}
function cloudRetryIndices(indices) {
  const candidates = indices
    ? indices.map(Number)
    : Object.keys(state.plots).map(Number);
  return [...new Set(candidates)]
    .filter(idx => Number.isInteger(idx) && state.plots[idx])
    .filter(idx => isCloudDirty(idx) || hasPendingPhotoUpload(idx));
}

function afterRemoteMerge(idx) {
  if (isCloudDirty(idx)) return;
  ensurePlot(idx);
  updateMapPlot(idx);
  if (idx === state.plotIdx) {
    renderCanvas();
    updatePlotHeader();
    refreshMetaToggle();
    if (drawer && drawer.classList.contains('on')) loadMetadataIntoDrawer();
  }
  updateProgress();
  saveState();
}

async function uploadPendingPhotos(idx) {
  if (typeof window.uploadPhoto !== 'function') return false;
  const p = ensurePlot(idx);
  let changed = false;
  for (let i = 0; i < p.photos.length; i++) {
    const ph = p.photos[i];
    if (!ph || ph.url || !ph.dataUrl) continue;
    const url = await window.uploadPhoto(idx, ph.dataUrl, `${Date.now()}_${i}`);
    if (url) {
      p.photos[i] = { ...ph, url };
      changed = true;
    }
  }
  return changed;
}

async function flushCloudSync(indices) {
  if (!hasSyncPlots()) return;
  const list = cloudRetryIndices(indices);
  if (!list.length) return;
  list.forEach(idx => {
    cloudDirty.add(idx);
    if (!state.plots[idx]._dirty_at) state.plots[idx]._dirty_at = new Date().toISOString();
  });
  const dirtySnapshot = new Map(list.map(idx => [idx, state.plots[idx]._dirty_at]));
  let photosChanged = false;
  for (const idx of list) photosChanged = (await uploadPendingPhotos(idx)) || photosChanged;
  if (photosChanged) saveState();
  const ok = await window.syncPlots(list, state, DEVICE_ID);
  if (ok) {
    list.forEach(idx => {
      if (!state.plots[idx]) return;
      if (state.plots[idx]._dirty_at !== dirtySnapshot.get(idx)) {
        cloudDirty.add(idx);
      } else if (hasPendingPhotoUpload(idx)) {
        cloudDirty.add(idx);
      } else {
        cloudDirty.delete(idx);
        delete state.plots[idx]._dirty_at;
      }
    });
    saveState();
    scheduleCloudRetry();
  } else {
    list.forEach(idx => {
      if (state.plots[idx]) {
        cloudDirty.add(idx);
        if (!state.plots[idx]._dirty_at) state.plots[idx]._dirty_at = new Date().toISOString();
      }
    });
    saveState();
    scheduleCloudRetry();
  }
  return ok;
}

function markCloudDirty(idx) {
  if (!Number.isInteger(idx) || !state.plots[idx]) return;
  cloudDirty.add(idx);
  state.plots[idx]._dirty_at = new Date().toISOString();
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    flushCloudSync().catch(e => console.warn('cloud sync failed:', e));
  }, CLOUD_SYNC_DELAY);
}

function scheduleCloudRetry() {
  if (!cloudDirty.size) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    flushCloudSync().catch(e => console.warn('cloud sync failed:', e));
  }, CLOUD_RETRY_DELAY);
}

function savePlotChange(idx) {
  schedSave();
  markCloudDirty(idx);
}

function restoreCloudDirtyQueue() {
  Object.keys(state.plots).forEach(k => {
    const idx = Number(k);
    if (state.plots[idx] && state.plots[idx]._dirty_at) cloudDirty.add(idx);
  });
  scheduleCloudRetry();
}

// ── CELL DATA QUERIES ─────────────────────────────────────────────
function cellVisibleCrops(p, cellIdx) {
  const out = [];
  const view = state.viewMonth;
  for (let c=0; c<CROPS.length; c++) {
    const v = p.cells[c][cellIdx];
    if (!v) continue;
    if (view === -1) out.push(c);
    else if (v & (1<<view)) out.push(c);
  }
  return out;
}
function plotHasPaint(idx) {
  const p = state.plots[idx];
  if (!p || !p.cells) return false;
  for (let c=0; c<CROPS.length; c++)
    for (let i=0; i<p.cells[c].length; i++)
      if (p.cells[c][i] > 0) return true;
  return false;
}
function plotHasData(idx) {
  const p = state.plots[idx];
  if (!p) return false;
  return plotHasPaint(idx) || p.farmer || p.farmerId || p.note || (p.photos && p.photos.length);
}
function dominantCropForView(idx) {
  const p = state.plots[idx];
  if (!p || !p.cells) return { crop:null, counts:null };
  const counts = new Array(CROPS.length).fill(0);
  const view = state.viewMonth;
  for (let c=0; c<CROPS.length; c++) {
    for (let i=0; i<p.cells[c].length; i++) {
      const v = p.cells[c][i];
      if (!v) continue;
      if (view === -1) counts[c]++;
      else if (v & (1<<view)) counts[c]++;
    }
  }
  const max = Math.max(...counts);
  if (max === 0) return { crop:null, counts };
  return { crop: CROPS[counts.indexOf(max)], cropIdx: counts.indexOf(max), counts };
}
function plotIsMixed(idx) {
  const dom = dominantCropForView(idx);
  if (!dom.counts) return false;
  let nonZero = 0;
  for (const c of dom.counts) if (c>0) nonZero++;
  return nonZero > 1;
}

// ── UNDO ──────────────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;

function snapshotForUndo(idx) {
  const p = ensurePlot(idx);
  const snap = p.cells.map(a => new Uint16Array(a));
  undoStack.push({ plotIdx: idx, cells: snap });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoBtn();
}
function undo() {
  const e = undoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  const p = ensurePlot(e.plotIdx);
  redoStack.push({ plotIdx: e.plotIdx, cells: p.cells.map(a => new Uint16Array(a)) });
  p.cells = e.cells.map(a => new Uint16Array(a));
  if (state.plotIdx !== e.plotIdx) { state.plotIdx = e.plotIdx; updatePlotHeader(); drawPlotsOnMap(); }
  else updateMapPlot(e.plotIdx);
  renderCanvas(); updateProgress(); refreshMetaToggle(); updateUndoBtn();
  savePlotChange(e.plotIdx);
  toast(tr('undone'));
}
function redo() {
  const e = redoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  const p = ensurePlot(e.plotIdx);
  undoStack.push({ plotIdx: e.plotIdx, cells: p.cells.map(a => new Uint16Array(a)) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  p.cells = e.cells.map(a => new Uint16Array(a));
  if (state.plotIdx !== e.plotIdx) { state.plotIdx = e.plotIdx; updatePlotHeader(); drawPlotsOnMap(); }
  else updateMapPlot(e.plotIdx);
  renderCanvas(); updateProgress(); refreshMetaToggle(); updateUndoBtn();
  savePlotChange(e.plotIdx);
}
function updateUndoBtn() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

// ── MIXED-CELL DRAWING ───────────────────────────────────────────
function drawMixedCell(ctx, x0, y0, w, h, cropIdxs, style){
  if (cropIdxs.length === 0) return;
  if (cropIdxs.length === 1){
    ctx.fillStyle = CROPS[cropIdxs[0]].hex;
    ctx.fillRect(x0, y0, w+0.5, h+0.5);
    return;
  }
  if (style === 'stripes'){
    const bw = w / cropIdxs.length;
    for (let i=0; i<cropIdxs.length; i++){
      ctx.fillStyle = CROPS[cropIdxs[i]].hex;
      ctx.fillRect(x0 + i*bw, y0, bw + 0.6, h + 0.5);
    }
    return;
  }
  if (style === 'diagonal' && cropIdxs.length === 2){
    ctx.fillStyle = CROPS[cropIdxs[0]].hex;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CROPS[cropIdxs[1]].hex;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.lineTo(x0, y0+h+0.5); ctx.closePath();
    ctx.fill();
    return;
  }
  // quadrants
  const hw = w/2, hh = h/2;
  const slots = [[0,0],[hw,0],[0,hh],[hw,hh]];
  let order;
  if (cropIdxs.length === 2) order = [0, 1, 1, 0];
  else if (cropIdxs.length === 3) order = [0, 1, 2, 0];
  else order = [0, 1, 2, 3];
  for (let i=0; i<4; i++){
    ctx.fillStyle = CROPS[cropIdxs[order[i]]].hex;
    ctx.fillRect(x0 + slots[i][0], y0 + slots[i][1], hw + 0.6, hh + 0.6);
  }
}

// ── MAP ───────────────────────────────────────────────────────────
let contextTileLayerRef = null;
let esriTileLayerRef = null;
let detailTileLayerRef = null;
const MAP_TILE_VERSION = '20260524-esri';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = 10;
const MAP_APP_MAX_ZOOM = 16;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [16.46141, 120.62388],
  [16.49551, 120.65667]
);

function makeContextTileLayer() {
  return L.tileLayer(`tiles/context/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`, {
    minZoom: MAP_APP_MIN_ZOOM,
    maxZoom: MAP_APP_MAX_ZOOM,
    minNativeZoom: MAP_CONTEXT_MIN_ZOOM,
    maxNativeZoom: MAP_CONTEXT_MAX_ZOOM,
    bounds: MAP_CONTEXT_BOUNDS,
    noWrap: true,
    errorTileUrl: 'tiles/context/empty.jpg',
    attribution: '',
  });
}

function makeEsriTileLayer() {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      noWrap: true,
      errorTileUrl: '',
      attribution: '',
    }
  );
}

function makeDetailTileLayer() {
  return L.tileLayer(`tiles/map/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`, {
    minZoom: MAP_DETAIL_MIN_ZOOM,
    maxZoom: MAP_APP_MAX_ZOOM,
    minNativeZoom: MAP_DETAIL_MIN_ZOOM,
    maxNativeZoom: MAP_DETAIL_MAX_ZOOM,
    bounds: MAP_DETAIL_BOUNDS,
    noWrap: true,
    errorTileUrl: 'tiles/map/empty.jpg',
    attribution: '',
  });
}

function initMap(){
  map = L.map('map', {
    center:[16.482,120.640],
    zoom:14,
    minZoom: MAP_APP_MIN_ZOOM,
    maxZoom: MAP_APP_MAX_ZOOM,
    maxBounds: MAP_CONTEXT_BOUNDS,
    maxBoundsViscosity: 0.85,
    zoomControl:false,
    attributionControl:false,
    zoomAnimation:false,
  });
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  detailTileLayerRef  = makeDetailTileLayer().addTo(map);
  esriTileLayerRef    = makeEsriTileLayer().addTo(map);
  L.polygon(POLY, {
    color:'#F2C84B', weight:2.5, dashArray:'7,5',
    fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
  }).addTo(map);
  drawPlotsOnMap();
  map.fitBounds(L.polygon(POLY).getBounds().pad(0.10));
  document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
  document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
}

function plotStyle(idx){
  const { crop } = dominantCropForView(idx);
  const isCurrent = idx === state.plotIdx;
  if (crop){
    const mixed = plotIsMixed(idx);
    return {
      color: isCurrent ? '#F2C84B' : (mixed ? '#FFFFFF' : crop.hex),
      weight: isCurrent ? 3 : (mixed ? 2 : 1.6),
      fillColor: crop.hex, fillOpacity: 0.65,
      dashArray: mixed && !isCurrent ? '4,3' : null,
    };
  }
  // EMPTY plot — grey (per requirement) — translucent so satellite shows through
  const greyFill = getCss('--empty-fill');
  const greyStroke = getCss('--empty-stroke');
  return isCurrent
    ? { color:'#F2C84B', weight:3, fillColor:greyFill, fillOpacity:0.30, dashArray:null }
    : { color:greyStroke, weight:1.2, fillColor:greyFill, fillOpacity:0.18, dashArray:'4,3' };
}

function drawPlotsOnMap(){
  Object.values(plotRects).forEach(r=>map.removeLayer(r));
  Object.values(plotMarkers).forEach(m=>map.removeLayer(m));
  plotRects = {}; plotMarkers = {};

  PLOTS.forEach(plot=>{
    const style = plotStyle(plot.idx);
    const rect = L.rectangle([[plot.latS, plot.lngW],[plot.latN, plot.lngE]], style).addTo(map);
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
      this.setStyle({ ...s, weight: Math.max(s.weight, 2.2), fillOpacity: Math.max(s.fillOpacity, 0.55) });
    });
    rect.on('mouseout', function(){
      if (plot.idx===state.plotIdx) return;
      this.setStyle(plotStyle(plot.idx));
    });
    plotRects[plot.idx] = rect;
    plotMarkers[plot.idx] = marker;
  });
}
function updateMapPlot(idx){
  const rect = plotRects[idx];
  if (rect) rect.setStyle(plotStyle(idx));
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

function renderCanvas(){
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  ctx.clearRect(0,0,w,h);

  // base panel
  ctx.fillStyle = getCss('--canvas-bg');
  ctx.fillRect(0, 0, w, h);
  // a faint vignette so it doesn't look completely flat
  const grd = ctx.createLinearGradient(0,0,w,h);
  grd.addColorStop(0,'rgba(255,255,255,.05)');
  grd.addColorStop(1,'rgba(0,0,0,.1)');
  ctx.fillStyle = grd; ctx.fillRect(0,0,w,h);

  if (state.theme === 'dark'){
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0,0,w,h);
  } else if (state.theme === 'contrast'){
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(0,0,w,h);
  }

  const p = ensurePlot(state.plotIdx);
  const cellW = w / GRID, cellH = h / GRID;
  const baseAlpha = state.theme==='contrast' ? 0.92 : 0.84;

  let painted = 0;
  for (let r=0;r<GRID;r++){
    for (let c=0;c<GRID;c++){
      const idx = r*GRID + c;
      const cropList = cellVisibleCrops(p, idx);
      if (!cropList.length) continue;
      painted++;
      const x0 = c*cellW, y0 = r*cellH;
      ctx.globalAlpha = cropList.length > 1 ? Math.min(.96, baseAlpha + 0.06) : baseAlpha;
      drawMixedCell(ctx, x0, y0, cellW, cellH, cropList, state.mixedStyle);
    }
  }
  ctx.globalAlpha = 1;

  // grid
  ctx.strokeStyle = getCss('--grid-line');
  ctx.lineWidth = 0.8;
  for (let i=5;i<GRID;i+=5){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.4;
  for (let i=10;i<GRID;i+=10){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0.5,0.5,w-1,h-1);

  // corner counter
  document.getElementById('canvas-corner').textContent = `${GRID}×${GRID} · ${painted} / ${GRID*GRID}`;
  // top-right "showing" tag
  const tag = document.getElementById('canvas-view-tag');
  tag.textContent = state.viewMonth === -1
    ? 'Showing · all year'
    : 'Showing · ' + MONTH_FULL_LONG[state.viewMonth];
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

  const p = ensurePlot(state.plotIdx);
  const size = state.brush==='erase' ? 1 : state.brush;
  const half = Math.floor(size/2);
  for (let dr=-half; dr<=half; dr++){
    for (let dc=-half; dc<=half; dc++){
      const rr = cell.r+dr, cc = cell.c+dc;
      if (rr<0||rr>=GRID||cc<0||cc>=GRID) continue;
      const k = rr*GRID+cc;
      if (state.brush==='erase') {
        // Erase ALL crops at this cell. Future iteration could erase only active crop or active months.
        for (let ci=0; ci<CROPS.length; ci++) p.cells[ci][k] = 0;
      } else {
        // OR the paint-month mask into this crop's cell
        p.cells[state.crop][k] |= state.paintMonths;
      }
    }
  }
  renderCanvas();
  updateProgress();
  updateMapPlot(state.plotIdx);
  savePlotChange(state.plotIdx);
}

let saveTimer = null;
function schedSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

function onDown(e){
  if (e.target !== canvas) return;
  painting = true; lastIdx = -1;
  snapshotForUndo(state.plotIdx);
  e.preventDefault();
  const pt = e.touches ? e.touches[0] : e;
  paintAt(pt.clientX, pt.clientY);
}
function onMove(e){
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

// ── CROP PALETTE ──────────────────────────────────────────────────
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
      if (state.brush==='erase') state.brush = 1;
      buildPalette();
      updateBrush();
      updateScheduleReadout();
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
  const plot = PLOTS[idx];
  const bounds = L.latLngBounds([[plot.latS,plot.lngW],[plot.latN,plot.lngE]]);
  if (!map.getBounds().contains(bounds)) map.panTo([plot.centerLat,plot.centerLng], {animate:true});
  document.getElementById('prev-btn').disabled = idx===0;
  document.getElementById('next-btn').disabled = idx===PLOTS.length-1;
  if (drawer.classList.contains('on')) loadMetadataIntoDrawer();
  else detailDraft = null;
  refreshMetaToggle();
  schedSave();
  if (hasSyncOnNavigate()) {
    window.syncOnNavigate(idx, state, afterRemoteMerge, mayMergeRemote).catch(e => console.warn('navigation sync failed:', e));
  }
}
function updatePlotHeader(){
  const plot = PLOTS[state.plotIdx];
  if (!plot) return;
  const p = state.plots[state.plotIdx];
  document.getElementById('plot-name').textContent = tr('plotN').replace('{n}', String(state.plotIdx+1).padStart(2,'0'));
  document.getElementById('plot-loc').textContent =
    `R${plot.r} · C${plot.c} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
  // farmer chip
  const chip = document.getElementById('ed-farmer-chip');
  if (p && p.farmerId) {
    chip.classList.remove('empty');
    chip.innerHTML = `<span class="ddot"></span>${p.farmerId}`;
  } else {
    chip.classList.add('empty');
    chip.innerHTML = `<span class="ddot"></span>${tr('noFarmer')}`;
  }
  document.getElementById('dr-title').textContent =
    tr('plotN').replace('{n}', String(state.plotIdx+1).padStart(2,'0')) + ' — ' + tr('plotSection').toLowerCase();
}
function refreshMetaToggle() {
  const p = state.plots[state.plotIdx];
  const has = p && (p.farmer || p.farmerId || p.note || (p.photos && p.photos.length));
  document.getElementById('meta-toggle').classList.toggle('has-data', !!has);
}

// ── PROGRESS ──────────────────────────────────────────────────────
function updateProgress(){
  const markedPlots = Object.keys(state.plots).filter(k=>plotHasPaint(+k));
  const done = markedPlots.length;
  let patches = 0;
  markedPlots.forEach(k=>{
    const p = state.plots[+k];
    for (let c=0; c<CROPS.length; c++) for (let i=0; i<p.cells[c].length; i++) if (p.cells[c][i]>0) patches++;
  });
  document.getElementById('prog-done').textContent = done;
  document.getElementById('prog-patches').textContent = patches.toLocaleString();
  document.getElementById('save-count').textContent = done;
  // update legend counts too
  updateLegend();
  // update roster button count
  const roster = buildRosterData();
  const farmerCnt = document.getElementById('hdr-farmer-count');
  if (farmerCnt) farmerCnt.textContent = roster.filter(r=>r.id).length;
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

// ── LEGEND ────────────────────────────────────────────────────────
function updateLegend(){
  const root = document.getElementById('map-legend-rows');
  if (!root) return;
  // count plots where each crop is visible-dominant under current view
  const tally = new Array(CROPS.length).fill(0);
  let empties = 0;
  PLOTS.forEach(plot=>{
    const { crop, cropIdx } = dominantCropForView(plot.idx);
    if (crop) tally[cropIdx]++;
    else empties++;
  });
  root.innerHTML = '';
  // empty row
  {
    const row = document.createElement('div');
    row.className = 'lgd-row';
    row.innerHTML = `<span class="lgd-sw empty"></span>
      <span class="lgd-nm">${tr('empty')}</span>
      <span class="lgd-ct">${empties}</span>`;
    root.appendChild(row);
  }
  CROPS.forEach((crop,i)=>{
    const row = document.createElement('div');
    row.className = 'lgd-row';
    row.innerHTML = `<span class="lgd-sw" style="background:${crop.hex};border-color:${crop.hex}"></span>
      <span class="lgd-nm">${crop.name[state.lang]||crop.name.en}</span>
      <span class="lgd-ct">${tally[i]}</span>`;
    root.appendChild(row);
  });
}

// ── LANGUAGE ──────────────────────────────────────────────────────
function applyLang(){
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.toggle('on', b.dataset.lang===state.lang));
  document.getElementById('brand-sub').textContent = tr('appSub');
  document.getElementById('map-title').textContent = 'Ambassador';
  document.getElementById('lab-brush').textContent = tr('brush');
  document.getElementById('lab-crop').textContent = tr('crop');
  document.getElementById('sched-label').textContent = tr('schedule');
  document.getElementById('scrub-label').textContent = tr('showing');
  document.getElementById('lgd-head').textContent = tr('legend');
  document.getElementById('btn-undo-txt').textContent = tr('undo');
  document.getElementById('btn-redo-txt').textContent = tr('redo');
  document.getElementById('btn-clear').textContent = tr('clear');
  document.getElementById('btn-save-txt').textContent = tr('saveAll');
  document.getElementById('meta-toggle-txt').textContent = tr('plotDetails');
  document.getElementById('roster-btn-txt').textContent = tr('roster');
  document.getElementById('lab-farmer-id').textContent = tr('farmerId');
  document.getElementById('lab-farmer').textContent = tr('farmer');
  document.getElementById('lab-note').textContent = tr('note');
  document.getElementById('lab-photo').textContent = tr('photo');
  document.getElementById('ph-farmer').textContent = tr('farmerPh');
  document.getElementById('ph-farmer-id').textContent = tr('farmerIdPh');
  document.getElementById('ph-note').textContent = tr('notePh');
  document.getElementById('lab-summary').textContent = tr('schedSummary');
  // quick range buttons
  document.getElementById('q-all').textContent = tr('allYear');
  document.getElementById('q-rainy').textContent = tr('rainy');
  document.getElementById('q-cool').textContent = tr('coolDry');
  document.getElementById('q-hot').textContent = tr('hotDry');
  buildPalette();
  updatePlotHeader();
  updateLegend();
  if (typeof updateScheduleReadout === 'function') updateScheduleReadout();
  if (typeof updateScrubberReadout === 'function') updateScrubberReadout();
}

// ── THEME ─────────────────────────────────────────────────────────
function applyTheme(){
  document.documentElement.setAttribute('data-theme', state.theme);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===state.theme));
  // re-render dependent visuals
  if (map && contextTileLayerRef && esriTileLayerRef && detailTileLayerRef) {
    map.removeLayer(esriTileLayerRef);
    map.removeLayer(detailTileLayerRef);
    map.removeLayer(contextTileLayerRef);
    contextTileLayerRef = makeContextTileLayer().addTo(map);
    detailTileLayerRef  = makeDetailTileLayer().addTo(map);
    esriTileLayerRef    = makeEsriTileLayer().addTo(map);
  }
  renderCanvas();
  if (map) {
    drawPlotsOnMap();
  }
}

// ── DRAWER ────────────────────────────────────────────────────────
const scrim = document.getElementById('scrim');
const drawer = document.getElementById('drawer');
function openDrawer(){
  loadMetadataIntoDrawer();
  scrim.classList.add('on');
  drawer.classList.add('on');
}
function closeDrawer() {
  detailDraft = null;
  scrim.classList.remove('on');
  drawer.classList.remove('on');
}
function nextFarmerId(){
  const used = new Set();
  Object.values(state.plots).forEach(p => { if (p.farmerId) used.add(p.farmerId); });
  for (let i=1; i<1000; i++){
    const id = 'F-' + String(i).padStart(3,'0');
    if (!used.has(id)) return id;
  }
  return 'F-001';
}
function loadMetadataIntoDrawer() {
  const p = ensurePlot(state.plotIdx);
  detailDraft = {
    farmerId: p.farmerId || '',
    farmer: p.farmer || '',
    note: p.note || '',
    photos: (p.photos || []).map(ph => ({ ...ph })),
  };
  document.getElementById('in-farmer-id').value = detailDraft.farmerId;
  document.getElementById('in-farmer').value = detailDraft.farmer;
  document.getElementById('in-note').value = detailDraft.note;
  document.getElementById('sug-farmer-id').textContent = nextFarmerId();
  renderPhotos(detailDraft.photos);
  renderScheduleSummary();
}
function renderPhotos(photos) {
  const area = document.getElementById('photo-area');
  const thumbs = photos.map((ph, i) => {
    const src = ph.dataUrl || ph.url || '';
    return `<div class="photo-thumb">
      <img src="${src}" alt="plot photo ${i + 1}">
      <button class="x" data-idx="${i}" aria-label="Remove">×</button>
    </div>`;
  }).join('');
  area.innerHTML = `<div class="photo-grid">
    ${thumbs}
    <button class="photo-add" id="photo-add-btn">
      <span class="ico">+</span>
      <span>${tr('addPhoto')}</span>
    </button>
  </div>`;
  document.getElementById('photo-add-btn').onclick = () => document.getElementById('in-photo').click();
  area.querySelectorAll('.photo-thumb .x').forEach(btn => {
    btn.onclick = () => {
      if (!detailDraft) return;
      detailDraft.photos.splice(+btn.dataset.idx, 1);
      renderPhotos(detailDraft.photos);
    };
  });
}
function renderScheduleSummary(){
  const root = document.getElementById('sched-summary-grid');
  const p = ensurePlot(state.plotIdx);
  // for each crop, OR together its month mask across all cells
  const masks = CROPS.map((_,c)=>{
    let m = 0;
    for (let i=0; i<p.cells[c].length; i++) m |= p.cells[c][i];
    return m;
  });
  const hasAny = masks.some(m=>m>0);
  if (!hasAny){
    root.innerHTML = `<div class="ss-empty">${tr('noSchedule')}</div>`;
    return;
  }
  let html = `<div class="ss-grid">`;
  html += `<div></div>`;
  for (let m=0; m<12; m++) html += `<div class="ss-mh">${MONTH_SHORT[m]}</div>`;
  CROPS.forEach((crop,c)=>{
    if (!masks[c]) return;
    html += `<div class="ss-crop-lbl"><span class="ss-dot" style="background:${crop.hex}"></span>${crop.name[state.lang]||crop.name.en}</div>`;
    for (let m=0; m<12; m++) {
      const on = masks[c] & (1<<m);
      html += `<div class="ss-cell ${on?'on':''}" style="${on?`background:${crop.hex}`:''}"></div>`;
    }
  });
  html += `</div>`;
  root.innerHTML = html;
}

document.getElementById('meta-toggle').onclick = openDrawer;
document.getElementById('dr-close').onclick = closeDrawer;
scrim.onclick = closeDrawer;

document.getElementById('dr-save').onclick = () => {
  if (!detailDraft) return;
  const idx = state.plotIdx;
  const p = ensurePlot(idx);
  p.farmerId = detailDraft.farmerId.trim();
  p.farmer = detailDraft.farmer.trim();
  p.note = detailDraft.note;
  p.photos = detailDraft.photos.map(ph => ({ ...ph }));
  markCloudDirty(idx);
  saveState();
  refreshMetaToggle();
  updatePlotHeader();
  updateProgress();
  toast(tr('saved'));
  closeDrawer();
};

document.getElementById('in-farmer-id').oninput = (e) => { if (detailDraft) detailDraft.farmerId = e.target.value; };
document.getElementById('in-farmer').oninput   = (e) => { if (detailDraft) detailDraft.farmer = e.target.value; };
document.getElementById('in-note').oninput     = (e) => { if (detailDraft) detailDraft.note = e.target.value; };
document.getElementById('sug-farmer-id').onclick = () => {
  if (!detailDraft) return;
  detailDraft.farmerId = nextFarmerId();
  document.getElementById('in-farmer-id').value = detailDraft.farmerId;
};
document.getElementById('in-photo').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  const dataUrl = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(file);
  });
  const img = new Image();
  img.onload = () => {
    const max = 800;
    const scale = Math.min(1, max / img.width, max / img.height);
    const c = document.createElement('canvas');
    c.width = img.width * scale; c.height = img.height * scale;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const small = c.toDataURL('image/jpeg', .82);
    if (detailDraft) {
      detailDraft.photos.push({ url: null, dataUrl: small });
      renderPhotos(detailDraft.photos);
    }
  };
  img.src = dataUrl;
};

// ── CLEAR ─────────────────────────────────────────────────────────
document.getElementById('btn-clear').onclick = ()=>{
  if (!plotHasData(state.plotIdx)) return;
  if (!confirm(tr('confirmClear'))) return;
  snapshotForUndo(state.plotIdx);
  const p = state.plots[state.plotIdx];
  p.cells = emptyCells();
  p.farmer=''; p.farmerId=''; p.note=''; p.photos=[];
  renderCanvas(); updateProgress(); updateMapPlot(state.plotIdx);
  if (drawer.classList.contains('on')) loadMetadataIntoDrawer();
  refreshMetaToggle(); updatePlotHeader();
  savePlotChange(state.plotIdx);
  toast(tr('cleared'));
};
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;

// ── ZIP EXPORT ────────────────────────────────────────────────────
// Output layout:
//   ambassador_cropmap_YYYY-MM-DD/
//     labels.csv          one row per (cell, crop) with 12 month columns
//     plots.csv           one row per plot with farmer + per-crop month masks
//     farmers.csv         one row per Farmer ID with their plot list
//     metadata.json       full structured dump
//     labels/plotXXX.png  rendered crop label PNG (500x500, 10px/cell)
//     photos/plotXXX_N.jpg
document.getElementById('btn-save').onclick = async () => {
  const indices = Object.keys(state.plots).map(k=>+k).filter(plotHasData);
  if (!indices.length){ toast(tr('empty')); return; }
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span>';
  try {
  await flushCloudSync();

  const zip = new JSZip();
  const dateStamp = new Date().toISOString().slice(0,10);
  const folder = zip.folder('ambassador_cropmap_' + dateStamp);

  // headers
  let labelsCsv =
    'plot_idx,plot_row,plot_col,centerLat,centerLng,farmer_id,crop_id,crop_en,patch_row,patch_col,' +
    'jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,month_count\n';
  let plotsCsv =
    'plot_idx,plot_row,plot_col,centerLat,centerLng,farmer_id,farmer_name,note,photo_count,' +
    CROPS.map(c=>`${c.id}_cells`).join(',') + ',' +
    CROPS.map(c=>`${c.id}_months_mask`).join(',') + '\n';
  const farmerMap = new Map(); // farmer_id -> { name, plots:[], patches }
  const metaPlots = [];

  // canvas for PNG label render
  const oc = document.createElement('canvas');
  oc.width = 500; oc.height = 500;
  const oct = oc.getContext('2d');

  for (const idx of indices) {
    const p = state.plots[idx];
    const plot = PLOTS[idx];
    const farmerId = (p.farmerId || '').trim();
    const farmerName = (p.farmer || '').trim();
    const note = (p.note || '').replaceAll('"', '""').replaceAll('\n', ' ');

    // PNG label image (snapshot in "all months" view)
    if (p.cells && p.cells.some(arr => arr.some(v => v > 0))) {
      oct.fillStyle = '#0A1A0A';
      oct.fillRect(0, 0, 500, 500);
      for (let r=0; r<GRID; r++) for (let c=0; c<GRID; c++) {
        const cellIdx = r*GRID + c;
        const present = [];
        for (let ci=0; ci<CROPS.length; ci++) if (p.cells[ci][cellIdx] > 0) present.push(ci);
        if (!present.length) continue;
        drawMixedCell(oct, c*10, r*10, 10, 10, present, state.mixedStyle);
      }
      folder.file(`labels/plot${String(idx).padStart(3,'0')}.png`,
        oc.toDataURL('image/png').split(',')[1], { base64: true });
    }

    // labels.csv — one row per (cell, crop) with 12-column month indicator
    for (let r=0; r<GRID; r++) for (let c=0; c<GRID; c++) {
      const cellIdx = r*GRID + c;
      for (let ci=0; ci<CROPS.length; ci++) {
        const mask = p.cells[ci][cellIdx];
        if (!mask) continue;
        const monthBits = [];
        let monthCount = 0;
        for (let m=0; m<12; m++) {
          const bit = (mask >> m) & 1;
          monthBits.push(bit);
          monthCount += bit;
        }
        labelsCsv += `${idx},${plot.r},${plot.c},${plot.centerLat},${plot.centerLng},` +
          `${farmerId},${CROPS[ci].id},${CROPS[ci].name.en},${r},${c},` +
          `${monthBits.join(',')},${monthCount}\n`;
      }
    }

    // plots.csv — one row per plot
    const cellCounts = CROPS.map((_,ci) => {
      let n=0; for (let i=0; i<p.cells[ci].length; i++) if (p.cells[ci][i]>0) n++; return n;
    });
    const monthMasks = CROPS.map((_,ci) => {
      let mm = 0; for (let i=0; i<p.cells[ci].length; i++) mm |= p.cells[ci][i]; return mm;
    });
    const photos = (p.photos || []).filter(ph => ph && (ph.url || ph.dataUrl));
    plotsCsv += `${idx},${plot.r},${plot.c},${plot.centerLat},${plot.centerLng},` +
      `${farmerId},"${farmerName}","${note}",${photos.length},` +
      `${cellCounts.join(',')},${monthMasks.join(',')}\n`;

    // Photos export
    photos.forEach((ph, pi) => {
      if (ph.dataUrl) {
        folder.file(`photos/plot${String(idx).padStart(3,'0')}_${pi}.jpg`,
          ph.dataUrl.split(',')[1], { base64: true });
      }
    });

    // farmer aggregation
    if (farmerId) {
      if (!farmerMap.has(farmerId)) farmerMap.set(farmerId, { name:'', plots:[], patches:0, crops:new Set() });
      const f = farmerMap.get(farmerId);
      if (farmerName && !f.name) f.name = farmerName;
      f.plots.push(idx);
      f.patches += cellCounts.reduce((a,b)=>a+b, 0);
      cellCounts.forEach((n,ci)=>{ if (n>0) f.crops.add(CROPS[ci].id); });
    }

    // metadata
    metaPlots.push({
      plot_idx: idx,
      row: plot.r, col: plot.c,
      centerLat: plot.centerLat, centerLng: plot.centerLng,
      farmer_id: farmerId,
      farmer_name: farmerName,
      note: p.note || '',
      photo_count: photos.length,
      crops: CROPS.map((crop,ci) => ({
        id: crop.id,
        en: crop.name.en,
        cells: cellCounts[ci],
        months_mask: monthMasks[ci],
        months: maskList(monthMasks[ci]).map(m => MONTH_FULL[m]),
      })).filter(x => x.cells > 0),
    });
  }

  // farmers.csv
  let farmersCsv = 'farmer_id,farmer_name,plot_count,plot_indices,total_patches,crops\n';
  for (const [id, f] of farmerMap.entries()) {
    farmersCsv += `${id},"${f.name}",${f.plots.length},"${f.plots.join(';')}",${f.patches},"${[...f.crops].join(';')}"\n`;
  }

  folder.file('labels.csv', labelsCsv);
  folder.file('plots.csv', plotsCsv);
  folder.file('farmers.csv', farmersCsv);
  folder.file('metadata.json', JSON.stringify({
    survey_area: 'Ambassador, Tublay, Benguet',
    surveyed_at: new Date().toISOString(),
    schema_version: 3,
    grid_resolution: `${GRID}x${GRID}`,
    month_encoding: {
      type: '12-bit mask',
      bit_to_month: MONTH_FULL,
      note: 'bit i (i=0..11) set means the crop is planted in that month',
    },
    crops: CROPS.map(c => ({ id:c.id, hex:c.hex, name:c.name })),
    farmers: [...farmerMap.entries()].map(([id, f]) => ({
      id, name: f.name, plot_count: f.plots.length,
      plot_indices: f.plots, total_patches: f.patches,
      crops: [...f.crops],
    })),
    plots: metaPlots,
  }, null, 2));

  const blob = await zip.generateAsync({type:'blob'});
  saveAs(blob, `ambassador_cropmap_${dateStamp}.zip`);
  toast(tr('saved'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHtml;
  }
};

// ── ROSTER ────────────────────────────────────────────────────────
function buildRosterData(){
  // group plots by farmerId. Include an "unassigned with paint" bucket too.
  const map = new Map();
  PLOTS.forEach(plot=>{
    const p = state.plots[plot.idx];
    if (!p || !plotHasPaint(plot.idx) && !p.farmerId && !p.farmer) return;
    const key = p.farmerId || '__unassigned__';
    if (!map.has(key)) map.set(key, { id: p.farmerId, name: p.farmer || '', plots: [], cropTotals: new Array(CROPS.length).fill(0), patchTotal: 0 });
    const r = map.get(key);
    if (!r.name && p.farmer) r.name = p.farmer;
    r.plots.push(plot.idx);
    if (p.cells) {
      for (let c=0; c<CROPS.length; c++) {
        let n = 0;
        for (let i=0; i<p.cells[c].length; i++) if (p.cells[c][i]>0) n++;
        r.cropTotals[c] += n;
        r.patchTotal += n;
      }
    }
  });
  const out = [...map.values()].sort((a,b)=>{
    if (!a.id && b.id) return 1;
    if (!b.id && a.id) return -1;
    return (a.id||'').localeCompare(b.id||'');
  });
  return out;
}
function openRoster(){
  document.getElementById('roster-modal').classList.add('on');
  scrim.classList.add('on');
  scrim.onclick = closeRoster;
  renderRoster('');
  document.getElementById('roster-search').focus();
}
function closeRoster(){
  document.getElementById('roster-modal').classList.remove('on');
  scrim.classList.remove('on');
  scrim.onclick = closeDrawer; // restore
}
function renderRoster(q){
  q = (q||'').trim().toLowerCase();
  const data = buildRosterData();
  const filtered = !q ? data : data.filter(r =>
    (r.id||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q)
  );
  document.getElementById('roster-stats').textContent =
    `${data.filter(r=>r.id).length} ${tr('rosterFarmers')} · ${data.filter(r=>!r.id).length} ${tr('rosterUnassigned')}`;
  const root = document.getElementById('roster-list');
  if (!filtered.length){
    root.innerHTML = `<div class="roster-empty">${tr('rosterEmpty')}</div>`;
    return;
  }
  root.innerHTML = filtered.map(r=>{
    const isU = !r.id;
    const cropTags = r.cropTotals.map((n,i)=> n>0 ? `<span class="crop-tag"><span class="cdot" style="background:${CROPS[i].hex}"></span>${(CROPS[i].name[state.lang]||CROPS[i].name.en)}</span>` : '').join('');
    const plotList = r.plots.slice(0,12).map(i=>String(i+1).padStart(2,'0')).join(', ') + (r.plots.length>12?' …':'');
    return `<div class="roster-card${isU?' unassigned':''}" data-plot="${r.plots[0]}">
      <div class="roster-id">${r.id || tr('rosterNoId')}</div>
      <div class="roster-mid">
        <div class="roster-name ${r.name?'':'empty'}">${r.name || tr('rosterNoName')}</div>
        <div class="roster-meta">
          <span>${r.plots.length} ${r.plots.length===1?tr('plotS'):tr('plotP')}</span>
          <span>${r.patchTotal.toLocaleString()} ${tr('patches')}</span>
          <div class="crop-tags">${cropTags}</div>
        </div>
        <div class="roster-plots">Plots: ${plotList}</div>
      </div>
      <div class="roster-go">→</div>
    </div>`;
  }).join('');
  root.querySelectorAll('.roster-card').forEach(card=>{
    card.onclick = ()=>{
      openPlot(+card.dataset.plot);
      closeRoster();
    };
  });
}
document.getElementById('roster-btn').onclick = openRoster;
document.getElementById('roster-close').onclick = closeRoster;
document.getElementById('roster-search').oninput = (e)=>renderRoster(e.target.value);

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
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); undo(); return; }
  if (e.key === 'ArrowLeft') openPlot(state.plotIdx-1);
  if (e.key === 'ArrowRight') openPlot(state.plotIdx+1);
  if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4'){
    state.crop = +e.key - 1; buildPalette(); updateScheduleReadout();
  }
  if (e.key === 'e' || e.key === 'E'){ state.brush = 'erase'; updateBrush(); }
  if (e.key === 'Escape'){
    if (document.getElementById('roster-modal').classList.contains('on')) closeRoster();
    else if (drawer.classList.contains('on')) closeDrawer();
  }
});

window.addEventListener('resize', ()=>{ fitCanvas(); renderCanvas(); });

// ── INIT ──────────────────────────────────────────────────────────
applyTheme();
applyLang();
initMap();
fitCanvas();
buildPalette();
updateBrush();
updateUndoBtn();
renderCanvas();
updateProgress();
updatePlotHeader();
updateAutosave();
refreshMetaToggle();
document.getElementById('prev-btn').disabled = state.plotIdx===0;
document.getElementById('next-btn').disabled = state.plotIdx===PLOTS.length-1;

const _ro = new ResizeObserver(()=>{ fitCanvas(); renderCanvas(); });
_ro.observe(document.querySelector('.canvas-zone'));

setTimeout(()=>{ if (map) map.invalidateSize(); fitCanvas(); renderCanvas(); }, 80);
setTimeout(()=>{ if (map) map.invalidateSize(); }, 400);

// Safety net for a known leaflet quirk where tiles stay at opacity 0 after
// invalidateSize during loading. Force-show any loaded but invisible tiles.
setInterval(()=>{
  document.querySelectorAll('.leaflet-tile').forEach(t=>{
    if (t.complete && (t.style.opacity === '0' || t.style.opacity === '')) {
      t.style.opacity = '1';
    }
  });
}, 500);

// ── DEMO SEED (so the prototype shows lively data on first open) ──
function seedDemoIfEmpty(){
  // Only seed if no plot has any paint.
  let any = false;
  Object.keys(state.plots).forEach(k=>{ if (plotHasPaint(+k)) any = true; });
  if (any) return;

  // Seed 8 plots with varied crop+month patterns + farmer IDs
  const seeds = [
    { idx: 18, farmerId:'F-001', farmer:'Manong Andoy', plan:[ {c:0, m:monthsBetween(0,4), n:1100}, {c:1, m:monthsBetween(5,11), n:600} ] },
    { idx: 19, farmerId:'F-001', farmer:'Manong Andoy', plan:[ {c:0, m:monthsBetween(0,5), n:1300} ] },
    { idx: 20, farmerId:'F-002', farmer:'Aling Letty',  plan:[ {c:3, m:monthsBetween(10,2), n:900}, {c:2, m:monthsBetween(3,7), n:700} ] },
    { idx: 26, farmerId:'F-002', farmer:'Aling Letty',  plan:[ {c:1, m:monthsBetween(0,11), n:1700} ] },
    { idx: 27, farmerId:'F-003', farmer:'',             plan:[ {c:2, m:monthsBetween(1,5), n:1200}, {c:3, m:monthsBetween(6,10), n:600} ] },
    { idx: 28, farmerId:'F-003', farmer:'',             plan:[ {c:0, m:monthsBetween(7,11), n:1400} ] },
    { idx: 34, farmerId:'',     farmer:'',              plan:[ {c:1, m:monthsBetween(2,8), n:1600} ] },
    { idx: 35, farmerId:'F-004', farmer:'Manang Rosing',plan:[ {c:3, m:monthsBetween(0,3), n:900}, {c:0, m:monthsBetween(4,9), n:1000} ] },
    { idx: 42, farmerId:'F-004', farmer:'Manang Rosing',plan:[ {c:0, m:monthsBetween(0,11), n:1100} ] },
  ];
  for (const s of seeds){
    const p = ensurePlot(s.idx);
    p.farmerId = s.farmerId;
    p.farmer = s.farmer;
    for (const block of s.plan) {
      // generate a blobby region
      const rand = mulberry32(s.idx*97 + block.c*7 + 11);
      const labels = new Uint8Array(GRID*GRID);
      const blobs = 5;
      for (let b=0;b<blobs;b++){
        const cx = Math.floor(rand()*GRID), cy = Math.floor(rand()*GRID);
        const rad = 4 + Math.floor(rand()*8);
        for (let r=0;r<GRID;r++) for (let c=0;c<GRID;c++){
          const dx=c-cx, dy=r-cy;
          if (dx*dx+dy*dy < rad*rad) labels[r*GRID+c] = 1;
        }
      }
      for (let i=0; i<labels.length; i++) if (labels[i]) p.cells[block.c][i] |= block.m;
    }
  }
  state.plotIdx = 27;
  saveState();
  drawPlotsOnMap();
  renderCanvas();
  updateProgress();
  updatePlotHeader();
}
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}}
seedDemoIfEmpty();
restoreCloudDirtyQueue();
if (hasSyncInit()) {
  window.syncInit(state, afterRemoteMerge, mayMergeRemote).catch(e => console.warn('initial sync failed:', e));
}

// ── EXPOSE UTILITIES for calendar.js to consume ───────────────────
window.TANIMAN = {
  state, GRID, PLOTS, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  monthsBetween, maskList, maskToLabel,
  renderCanvas, drawPlotsOnMap, updateMapPlot, updateLegend, updatePlotHeader,
  saveState, tr, schedSave,
};
