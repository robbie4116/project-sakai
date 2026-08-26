// ── Taniman v3 ───────────────────────────────────────────────────
// Redesign adds: per-cell crop calendar (12 months), proper per-crop colors,
// optional Farmer ID + roster view, month scrubber on the map.

// ── CONFIG ────────────────────────────────────────────────────────
const GRID = 50;
const STORAGE_KEY = 'taniman_v4_atok_paoay';
const ATOK_POLY = window.ATOK_POLY;
const PAOAY_POLY = window.PAOAY_POLY;
const PAOAY_PLOTS = window.PAOAY_PLOTS;
const CROPS = window.CROPS;
const T     = window.STRINGS;
const PLOTS = PAOAY_PLOTS;
const CORE_PLOT_COUNT = PAOAY_PLOTS.length;
const PAOAY_GRID_BOUNDS = PAOAY_PLOTS.reduce((bounds, plot) => ({
  latS: Math.min(bounds.latS, plot.latS),
  latN: Math.max(bounds.latN, plot.latN),
  lngW: Math.min(bounds.lngW, plot.lngW),
  lngE: Math.max(bounds.lngE, plot.lngE),
}), {
  latS: Infinity,
  latN: -Infinity,
  lngW: Infinity,
  lngE: -Infinity,
});
const ATOK_DETAIL_BOUNDS = ATOK_POLY.reduce((bounds, [lat, lng]) => ({
  n: Math.max(bounds.n, lat),
  s: Math.min(bounds.s, lat),
  e: Math.max(bounds.e, lng),
  w: Math.min(bounds.w, lng),
}), {
  n: -Infinity,
  s: Infinity,
  e: -Infinity,
  w: Infinity,
});
const GEOMETRY_EPSILON = 1e-12;

function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRect(lat, lng, rect) {
  return lat >= rect.latS && lat <= rect.latN && lng >= rect.lngW && lng <= rect.lngE;
}

function classifyZone(lat, lng) {
  if (pointInPolygon(lat, lng, PAOAY_POLY)) return 'paoay';
  if (pointInPolygon(lat, lng, ATOK_POLY)) return 'atok';
  return 'outside';
}

const MONTH_SHORT = ['J','F','M','A','M','J','J','A','S','O','N','D'];
const MONTH_FULL  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// month mask helpers (12-bit)
const MonthView = window.TANIMAN_MONTH_VIEW;
const {
  ALL_MONTHS,
  monthsBetween,
  maskList,
  maskIntersects,
  maskContains,
  normalizeViewMonths,
  viewMonthFromMask,
  maskToDisplayLabel,
  shouldAutoSwitchViewMonths,
  isBrushHiddenOnMap,
} = MonthView;
const SeasonUtils = window.TANIMAN_SEASONS;
const {
  isValidMmdd,
  rangeWrapsYear,
  seasonsOverlap,
  seasonExportRows,
} = SeasonUtils;
function maskHas(mask, m) { return !!(mask & (1<<m)); }
function maskToLabel(mask) {
  if (mask === 0) return '—';
  return maskToDisplayLabel(mask);
}

// ── STATE ─────────────────────────────────────────────────────────
const state = loadState() || {
  lang: 'en',
  theme: 'dark',
  brush: 1,
  crop: 0,
  plotIdx: 0,
  plots: {},
  paintStartDate: '01-01',
  paintEndDate: '12-31',
  viewMonth: -1,              // -1 = all months; 0..11 = scrub to month
  viewMonths: ALL_MONTHS,     // mask of months displayed on map/canvas
  mixedStyle: 'diagonal',
  showTweaks: false,
  version: 4,
};

// fill in any missing keys (state was loaded from a previous version)
const invalidActivePaintRangeAtStartup =
  !isValidMmdd(state.paintStartDate) || !isValidMmdd(state.paintEndDate);
if (invalidActivePaintRangeAtStartup) {
  state.paintStartDate = '01-01';
  state.paintEndDate = '12-31';
}
if (state.viewMonth === undefined) state.viewMonth = -1;
state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth);
state.viewMonth = viewMonthFromMask(state.viewMonths);
if (!state.mixedStyle) state.mixedStyle = 'diagonal';
if (!PLOTS[state.plotIdx]) state.plotIdx = 0;

// Per-plot data structure:
//   p.seasons = recurring annual crop windows with painted cell indexes
//   p.farmerId = 'F-001' | ''
//   p.farmer  = '' (legacy: human name)
//   p.note, p.photos
function emptySeasons() { return []; }
function newSeasonId() {
  return 'season_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function ensurePlot(idx) {
  let p = state.plots[idx];
  if (!p) {
    p = state.plots[idx] = { seasons: emptySeasons(), farmerId:'', farmer:'', note:'', photos:[] };
    return p;
  }
  if (!Array.isArray(p.seasons)) p.seasons = [];
  delete p.cells;
  delete p.labels;
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
if (!Object.prototype.hasOwnProperty.call(T, state.lang)) state.lang = 'en';

// ── HELPERS ───────────────────────────────────────────────────────
function tr(k){ return (T[state.lang]||T.en)[k] || k; }
function getCss(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

let map, plotRects = {}, plotMarkers = {}, plotCompositionBars = {};
let painting = false, lastIdx = -1;
let imgCache = {};
let lastSaveAt = Date.now();
let detailDraft = null;
let mapTileCache = {};

function visiblePlots() {
  return PLOTS;
}

function visiblePlotIndices() {
  return PLOTS.map(plot => plot.idx);
}

function adjacentVisiblePlotIdx(idx, direction) {
  const indices = visiblePlotIndices();
  const pos = indices.indexOf(idx);
  if (pos < 0) return indices[0] ?? 0;
  return indices[pos + direction] ?? idx;
}

function plotDisplayLabel(plot) {
  if (!plot) return '';
  return String(plot.idx + 1).padStart(2, '0');
}

function updateNavButtons() {
  const indices = visiblePlotIndices();
  const pos = indices.indexOf(state.plotIdx);
  document.getElementById('prev-btn').disabled = pos <= 0;
  document.getElementById('next-btn').disabled = pos < 0 || pos >= indices.length - 1;
}

// ── PERSISTENCE ───────────────────────────────────────────────────
function loadState(){
  try {
    const isTauri = typeof window.loadPersisted === 'function';
    let s = isTauri ? window.loadPersisted() : null;
    if (!s) {
      if (isTauri) return null; // disk is authoritative; never fall back to localStorage
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      s = JSON.parse(raw);
    }
    return s;
  } catch(e){ console.warn('load failed', e); return null; }
}
function saveState(){
  try {
    const out = { ...state, plots:{} };
    for (const k of Object.keys(state.plots)) {
      const p = state.plots[k];
      out.plots[k] = { ...p, seasons: cloneSeasons(p.seasons) };
    }
    if (typeof window.persistState === 'function') {
      window.persistState(out);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    }
    lastSaveAt = Date.now();
    updateAutosave();
  } catch(e){ console.warn('save failed', e); }
}

// ── CLOUD SYNC ───────────────────────────────────────────────────
const cloudDirty = new Set();
let cloudTimer = null;
const CLOUD_SYNC_DELAY = 4000;
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
function cropIndexFromId(cropId) {
  return CROPS.findIndex(c => c.id === cropId);
}
function monthRangeForViewMonth(m) {
  const mm = String(m + 1).padStart(2, '0');
  return {
    start: `${mm}-01`,
    end: `${mm}-${String(SeasonUtils.MONTH_DAYS[m]).padStart(2, '0')}`,
  };
}
function seasonIntersectsViewMonths(season, viewMonths = state.viewMonths) {
  if (!season || !isValidMmdd(season.start) || !isValidMmdd(season.end)) return false;
  for (let m=0; m<12; m++) {
    if (!(viewMonths & (1 << m))) continue;
    const monthRange = monthRangeForViewMonth(m);
    if (seasonsOverlap(season.start, season.end, monthRange.start, monthRange.end)) return true;
  }
  return false;
}
function seasonMonthsMask(start, end) {
  let mask = 0;
  for (let m=0; m<12; m++) {
    const monthRange = monthRangeForViewMonth(m);
    if (seasonsOverlap(start, end, monthRange.start, monthRange.end)) mask |= (1 << m);
  }
  return mask || ALL_MONTHS;
}
function activePaintSeasonData() {
  const crop = CROPS[state.crop];
  if (!crop || !isValidMmdd(state.paintStartDate) || !isValidMmdd(state.paintEndDate)) return null;
  return { cropId: crop.id, start: state.paintStartDate, end: state.paintEndDate };
}
function activePaintMonthsMask() {
  const data = activePaintSeasonData();
  return data ? seasonMonthsMask(data.start, data.end) : ALL_MONTHS;
}
function cellVisibleCropIds(p, cellIdx, viewMonths = state.viewMonths) {
  const out = [];
  const seen = new Set();
  for (const season of p.seasons || []) {
    if (!Array.isArray(season.cells) || !season.cells.includes(cellIdx)) continue;
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    if (!seen.has(season.cropId)) {
      seen.add(season.cropId);
      out.push(season.cropId);
    }
  }
  return out;
}
function cellVisibleCrops(p, cellIdx) {
  return cellVisibleCropIds(p, cellIdx).map(cropIndexFromId).filter(i => i >= 0);
}
function plotCompositionForView(idx, viewMonths = state.viewMonths) {
  const p = state.plots[idx];
  const gridCells = GRID * GRID;
  const counts = new Array(CROPS.length).fill(0);
  const percentages = new Array(CROPS.length).fill(0);
  if (!p || !Array.isArray(p.seasons)) {
    return {
      crop: null,
      cropIdx: -1,
      counts,
      percentages,
      totalVisibleCells: 0,
      visiblePaintedCells: 0,
      emptyCells: gridCells,
      nonZeroCropCount: 0,
      isMixed: false,
    };
  }

  const visibleCells = new Uint8Array(gridCells);
  const cropCellSeen = new Set();
  for (const season of p.seasons || []) {
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    const cropIdx = cropIndexFromId(season.cropId);
    if (cropIdx < 0) continue;
    for (const cellIdx of season.cells || []) {
      if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= gridCells) continue;
      const key = `${cropIdx}:${cellIdx}`;
      if (cropCellSeen.has(key)) continue;
      cropCellSeen.add(key);
      counts[cropIdx]++;
      visibleCells[cellIdx] = 1;
    }
  }

  const totalVisibleCells = counts.reduce((sum, n) => sum + n, 0);
  let visiblePaintedCells = 0;
  for (let i=0; i<visibleCells.length; i++) if (visibleCells[i]) visiblePaintedCells++;
  const emptyCells = Math.max(0, gridCells - visiblePaintedCells);
  for (let i=0; i<counts.length; i++) percentages[i] = totalVisibleCells ? counts[i] / totalVisibleCells : 0;

  const max = Math.max(...counts);
  const cropIdx = max > 0 ? counts.indexOf(max) : -1;
  const nonZeroCropCount = counts.filter(n => n > 0).length;
  return {
    crop: cropIdx >= 0 ? CROPS[cropIdx] : null,
    cropIdx,
    counts,
    percentages,
    totalVisibleCells,
    visiblePaintedCells,
    emptyCells,
    nonZeroCropCount,
    isMixed: nonZeroCropCount > 1,
  };
}
function plotHasPaint(idx) {
  const p = state.plots[idx];
  return !!(p && Array.isArray(p.seasons) && p.seasons.some(season => Array.isArray(season.cells) && season.cells.length));
}
function plotHasData(idx) {
  const p = state.plots[idx];
  if (!p) return false;
  return plotHasPaint(idx) || p.farmer || p.farmerId || p.note || (p.photos && p.photos.length);
}
function dominantCropForView(idx) {
  return plotCompositionForView(idx);
}
function plotIsMixed(idx) {
  return plotCompositionForView(idx).isMixed;
}

// ── UNDO ──────────────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;

function cloneSeasons(seasons) {
  return JSON.parse(JSON.stringify(seasons || []));
}
function snapshotForUndo(idx) {
  const p = ensurePlot(idx);
  undoStack.push({ plotIdx: idx, seasons: cloneSeasons(p.seasons) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoBtn();
}
function undo() {
  const e = undoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  const p = ensurePlot(e.plotIdx);
  redoStack.push({ plotIdx: e.plotIdx, seasons: cloneSeasons(p.seasons) });
  p.seasons = cloneSeasons(e.seasons);
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
  undoStack.push({ plotIdx: e.plotIdx, seasons: cloneSeasons(p.seasons) });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  p.seasons = cloneSeasons(e.seasons);
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
let detailTileLayerRef = null;
let esriTileLayerRef = null;
const MAP_TILE_VERSION = '20260603-z17';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 14;
const MAP_DETAIL_MAX_ZOOM = 14;
const CANVAS_DETAIL_ZOOM = MAP_DETAIL_MAX_ZOOM;
const ONLINE_IMAGERY_MAX_ZOOM = 19;
const ONLINE_IMAGERY_NATIVE_ZOOM = 18;
const ESRI_TILE_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_MIN_ZOOM = 14;
const MAP_APP_MIN_ZOOM = 10;
const MAP_APP_MAX_ZOOM = 14;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [ATOK_DETAIL_BOUNDS.s, ATOK_DETAIL_BOUNDS.w],
  [ATOK_DETAIL_BOUNDS.n, ATOK_DETAIL_BOUNDS.e]
);

function useOnlineImagery() {
  return !window.__TAURI__;
}

function getMapMaxZoom() {
  return useOnlineImagery() ? ONLINE_IMAGERY_MAX_ZOOM : MAP_APP_MAX_ZOOM;
}

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
  return L.tileLayer(ESRI_TILE_TEMPLATE, {
    minZoom: MAP_APP_MIN_ZOOM,
    maxZoom: ONLINE_IMAGERY_MAX_ZOOM,
    maxNativeZoom: ONLINE_IMAGERY_NATIVE_ZOOM,
    noWrap: true,
    errorTileUrl: '',
    attribution: '',
  });
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

function removeBaseImageryLayers() {
  [esriTileLayerRef, detailTileLayerRef, contextTileLayerRef].forEach(layer => {
    if (map && layer) map.removeLayer(layer);
  });
  esriTileLayerRef = null;
  detailTileLayerRef = null;
  contextTileLayerRef = null;
}

function addBaseImageryLayers() {
  if (useOnlineImagery()) {
    esriTileLayerRef = makeEsriTileLayer().addTo(map);
    return;
  }
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  detailTileLayerRef  = makeDetailTileLayer().addTo(map);
}

function refreshBaseImageryLayers() {
  removeBaseImageryLayers();
  addBaseImageryLayers();
}

function initMap(){
  map = L.map('map', {
    center:[16.62,120.75],
    zoom:14,
    minZoom: MAP_APP_MIN_ZOOM,
    maxZoom: getMapMaxZoom(),
    maxBounds: MAP_CONTEXT_BOUNDS,
    maxBoundsViscosity: 0.85,
    zoomControl:false,
    attributionControl:false,
    zoomAnimation:false,
  });
  addBaseImageryLayers();
  L.polygon(ATOK_POLY, {
    color: '#FFFFFF', weight: 1.5,
    fill: false, interactive: false
  }).addTo(map);

  L.polygon(PAOAY_POLY, {
    color:'#F2C84B', weight:2.5, dashArray:'7,5',
    fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
  }).addTo(map);
  drawPlotsOnMap();
  map.fitBounds([
    [ATOK_DETAIL_BOUNDS.s, ATOK_DETAIL_BOUNDS.w],
    [ATOK_DETAIL_BOUNDS.n, ATOK_DETAIL_BOUNDS.e]
  ]);
  document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
  document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
  function updateLabelVisibility() {
    const zoom = map.getZoom();
    map.getContainer().classList.toggle('labels-visible', zoom >= LABELS_MIN_ZOOM);
    map.getContainer().classList.toggle('bars-visible', zoom >= LABELS_MIN_ZOOM);
  }
  map.on('zoomend', updateLabelVisibility);
  updateLabelVisibility();
}

function plotStyle(idx){
  const plot = PLOTS[idx];
  const composition = plotCompositionForView(idx);
  const { crop } = composition;
  const isCurrent = idx === state.plotIdx;
  if (crop){
    return {
      color: isCurrent ? '#F2C84B' : getCss('--mixed-stroke'),
      weight: isCurrent ? 3 : 2,
      fillColor: getCss('--mixed-fill'),
      fillOpacity: 0.46,
      dashArray: isCurrent ? null : '4,3',
    };
  }
  // EMPTY plot — grey (per requirement) — translucent so satellite shows through
  const greyFill = getCss('--empty-fill');
  const greyStroke = getCss('--empty-stroke');
  return isCurrent
    ? { color:'#F2C84B', weight:3, fillColor:greyFill, fillOpacity:0.30, dashArray:null }
    : { color:greyStroke, weight:1.2, fillColor:greyFill, fillOpacity:0.18, dashArray:'4,3' };
}

function compositionBarHtml(composition) {
  if (!composition || composition.totalVisibleCells <= 0) return '';
  const segments = composition.counts.map((count, i) => {
    if (count <= 0) return '';
    const pct = Math.max(4, composition.percentages[i] * 100);
    return `<span class="mix-seg" style="width:${pct}%;background:${CROPS[i].hex}"></span>`;
  }).join('');
  return `<div class="mix-bar" aria-hidden="true">${segments}</div>`;
}

function updateCompositionBar(plot) {
  const existing = plotCompositionBars[plot.idx];
  const composition = plotCompositionForView(plot.idx);
  if (composition.totalVisibleCells <= 0) {
    if (existing) {
      map.removeLayer(existing);
      delete plotCompositionBars[plot.idx];
    }
    return;
  }

  const icon = L.divIcon({
    className: '',
    html: compositionBarHtml(composition),
    iconSize: [44, 10],
    iconAnchor: [22, -8],
  });
  if (existing) {
    existing.setIcon(icon);
    return;
  }
  plotCompositionBars[plot.idx] = L.marker([plot.centerLat, plot.centerLng], {
    icon,
    interactive: false,
    keyboard: false,
  }).addTo(map);
}

function drawPlotsOnMap(){
  Object.values(plotRects).forEach(r=>map.removeLayer(r));
  Object.values(plotMarkers).forEach(m=>map.removeLayer(m));
  Object.values(plotCompositionBars).forEach(m=>map.removeLayer(m));
  plotRects = {}; plotMarkers = {}; plotCompositionBars = {};

  PLOTS.forEach(plot=>{
    const style = plotStyle(plot.idx);
    const rect = L.rectangle([[plot.latS, plot.lngW],[plot.latN, plot.lngE]], style).addTo(map);
    const marker = L.marker([plot.centerLat, plot.centerLng], {
      icon: L.divIcon({
        className:'',
        html:`<div class="plot-num">${plotDisplayLabel(plot)}</div>`,
        iconSize:[24,14], iconAnchor:[12,7]
      }),
      interactive:false
    }).addTo(map);
    updateCompositionBar(plot);
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
  const plot = PLOTS[idx];
  if (plot) updateCompositionBar(plot);
}

// ── PLOT CANVAS ───────────────────────────────────────────────────
const canvas = document.getElementById('plot-canvas');
const ctx = canvas.getContext('2d');

function fitCanvas(){
  const frame = document.getElementById('canvas-frame');
  const zone = document.querySelector('.canvas-zone');
  const status = document.querySelector('.canvas-status');
  const pad = 36;
  const statusH = status ? status.offsetHeight + 10 : 0;
  const size = Math.max(120, Math.min(zone.clientWidth - pad, zone.clientHeight - pad - statusH));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  frame.style.width = size + 'px';
  frame.style.height = size + 'px';
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
}

function getPlotTile(idx) {
  const plot = PLOTS[idx];
  if (!plot || !plot.tilePath) return null;
  if (!imgCache[idx]) {
    const img = new Image();
    img.onload = () => {
      if (idx === state.plotIdx) renderCanvas();
    };
    img.src = plot.tilePath;
    imgCache[idx] = img;
  }
  return imgCache[idx];
}

function latLngToGlobalPixel(lat, lng, zoom) {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoom);
  const sinLat = Math.sin(lat * Math.PI / 180);
  const clamped = Math.min(0.9999, Math.max(-0.9999, sinLat));
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale,
  };
}

function getMapTileImage(z, x, y, idx, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg') {
  const key = `${urlTemplate}:${z}/${x}/${y}`;
  if (!mapTileCache[key]) {
    const img = new Image();
    img.onload = () => {
      if (idx === state.plotIdx) renderCanvas();
    };
    img.onerror = () => {
      img.failed = true;
      if (idx === state.plotIdx) renderCanvas();
    };
    const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const isExternal = urlTemplate.startsWith('http');
    if (isExternal) img.crossOrigin = 'anonymous';
    img.src = isExternal ? url : `${url}?v=${MAP_TILE_VERSION}`;
    mapTileCache[key] = img;
  }
  return mapTileCache[key];
}

function drawMapTileBackground(plot, w, h, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg', zoom = MAP_DETAIL_MAX_ZOOM) {
  if (!plot) return false;
  const tileSize = 256;
  const nw = latLngToGlobalPixel(plot.latN, plot.lngW, zoom);
  const se = latLngToGlobalPixel(plot.latS, plot.lngE, zoom);
  const sourceW = se.x - nw.x;
  const sourceH = se.y - nw.y;
  if (sourceW <= 0 || sourceH <= 0) return false;

  const minTileX = Math.floor(nw.x / tileSize);
  const maxTileX = Math.floor((se.x - GEOMETRY_EPSILON) / tileSize);
  const minTileY = Math.floor(nw.y / tileSize);
  const maxTileY = Math.floor((se.y - GEOMETRY_EPSILON) / tileSize);
  let hasBackground = false;

  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const img = getMapTileImage(zoom, tx, ty, plot.idx, urlTemplate);
      if (img.failed) continue;
      if (!img.complete || img.naturalWidth <= 0) {
        hasBackground = true;
        continue;
      }

      const tileLeft = tx * tileSize;
      const tileTop = ty * tileSize;
      const sx0 = Math.max(nw.x, tileLeft);
      const sy0 = Math.max(nw.y, tileTop);
      const sx1 = Math.min(se.x, tileLeft + tileSize);
      const sy1 = Math.min(se.y, tileTop + tileSize);
      if (sx1 <= sx0 || sy1 <= sy0) continue;

      const dx = (sx0 - nw.x) / sourceW * w;
      const dy = (sy0 - nw.y) / sourceH * h;
      const dw = (sx1 - sx0) / sourceW * w;
      const dh = (sy1 - sy0) / sourceH * h;
      ctx.drawImage(
        img,
        sx0 - tileLeft,
        sy0 - tileTop,
        sx1 - sx0,
        sy1 - sy0,
        dx,
        dy,
        dw,
        dh,
      );
      hasBackground = true;
    }
  }

  return hasBackground;
}

function renderCanvas(){
  const dpr = Math.max(1, canvas.width / Math.max(1, canvas.clientWidth || canvas.width));
  const w = Math.round(canvas.width / dpr);
  const h = Math.round(canvas.height / dpr);
  if (!w || !h) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = getCss('--canvas-bg');
  ctx.fillRect(0, 0, w, h);

  const plot = PLOTS[state.plotIdx];
  if (plot) {
    if (useOnlineImagery()) {
      drawMapTileBackground(plot, w, h, ESRI_TILE_TEMPLATE, ONLINE_IMAGERY_NATIVE_ZOOM);
    } else {
      const tile = getPlotTile(state.plotIdx);
      if (tile && tile.complete && tile.naturalWidth > 0) {
        ctx.drawImage(tile, 0, 0, w, h);
      } else if (!drawMapTileBackground(plot, w, h, 'tiles/map/{z}/{x}/{y}.jpg', CANVAS_DETAIL_ZOOM)) {
        drawMapTileBackground(plot, w, h);
      }
    }
  }

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
  const paintMonths = activePaintMonthsMask();
  state.paintMonths = paintMonths;
  const brushHidden = isBrushHiddenOnMap(state.viewMonths, paintMonths);
  tag.classList.toggle('hidden-brush', brushHidden);
  tag.textContent = brushHidden
    ? `Hidden · ${maskToDisplayLabel(paintMonths)} brush`
    : 'Showing · ' + maskToDisplayLabel(state.viewMonths, { singleLong: true }).toLowerCase();
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
function ensurePaintVisibleOnMap() {
  const paintMonths = activePaintMonthsMask();
  state.paintMonths = paintMonths;
  if (!shouldAutoSwitchViewMonths(state.viewMonths, paintMonths)) return;
  if (typeof window.setViewMonths === 'function') {
    window.setViewMonths(paintMonths, { source: 'paintAuto' });
  } else {
    state.viewMonths = normalizeViewMonths(paintMonths, state.viewMonth);
    state.viewMonth = viewMonthFromMask(state.viewMonths);
  }
}
function addCellsToPaintSeason(p, cellIds) {
  const crop = CROPS[state.crop];
  const data = activePaintSeasonData();
  if (!data || !cellIds.length) return false;
  let season = p.seasons.find(s =>
    s.cropId === data.cropId && s.start === data.start && s.end === data.end);
  const now = new Date().toISOString();
  if (!season) {
    season = { id: newSeasonId(), cropId: crop.id, start: data.start, end: data.end, cells: [], createdAt: now, updatedAt: now };
    p.seasons.push(season);
  }
  const seen = new Set(season.cells || []);
  cellIds.forEach(id => seen.add(id));
  season.cells = [...seen].sort((a, b) => a - b);
  season.updatedAt = now;
  return true;
}
function eraseCellsFromSeasons(p, cellIds) {
  const remove = new Set(cellIds);
  const now = new Date().toISOString();
  for (const season of p.seasons || []) {
    if (!Array.isArray(season.cells)) season.cells = [];
    season.cells = season.cells.filter(cellIdx => !remove.has(cellIdx));
    season.updatedAt = now;
  }
  p.seasons = (p.seasons || []).filter(season => season.cells && season.cells.length);
  return true;
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
  const cellIds = [];
  for (let dr=-half; dr<=half; dr++){
    for (let dc=-half; dc<=half; dc++){
      const rr = cell.r+dr, cc = cell.c+dc;
      if (rr<0||rr>=GRID||cc<0||cc>=GRID) continue;
      cellIds.push(rr*GRID+cc);
    }
  }
  if (state.brush === 'erase') eraseCellsFromSeasons(p, cellIds);
  else if (!addCellsToPaintSeason(p, cellIds)) return;
  if (state.brush !== 'erase') ensurePaintVisibleOnMap();
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
  if (!PLOTS[idx]) return;
  const prev = state.plotIdx;
  state.plotIdx = idx;
  updatePlotHeader();
  renderCanvas();
  updateMapPlot(prev);
  updateMapPlot(idx);
  const plot = PLOTS[idx];
  const bounds = L.latLngBounds([[plot.latS,plot.lngW],[plot.latN,plot.lngE]]);
  if (!map.getBounds().contains(bounds)) map.panTo([plot.centerLat,plot.centerLng], {animate:true});
  updateNavButtons();
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
  document.getElementById('plot-name').textContent = tr('plotN').replace('{n}', plotDisplayLabel(plot));
  document.getElementById('plot-loc').textContent = `R${plot.r} · C${plot.c} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
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
    document.getElementById('plot-name').textContent + ' — ' + tr('plotSection').toLowerCase();
  updateNavButtons();
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
    for (const season of p.seasons || []) patches += (season.cells || []).length;
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
  const visibleCellsByCrop = new Array(CROPS.length).fill(0);
  const plotsContainingCrop = new Array(CROPS.length).fill(0);
  let emptyVisibleCells = 0;
  let totalVisibleCells = 0;
  PLOTS.forEach(plot=>{
    const composition = plotCompositionForView(plot.idx);
    totalVisibleCells += GRID * GRID;
    emptyVisibleCells += composition.emptyCells;
    composition.counts.forEach((count, i) => {
      visibleCellsByCrop[i] += count;
      if (count > 0) plotsContainingCrop[i]++;
    });
  });
  const coveragePct = (count) => totalVisibleCells ? Math.round((count / totalVisibleCells) * 100) : 0;
  root.innerHTML = '';

  {
    const row = document.createElement('div');
    row.className = 'lgd-row';
    row.innerHTML = `<span class="lgd-sw empty"></span>
      <span class="lgd-nm">${tr('unpainted')}</span>
      <span class="lgd-val"><span class="lgd-ct">${coveragePct(emptyVisibleCells)}%</span><span class="lgd-sub">${emptyVisibleCells} cells</span></span>`;
    root.appendChild(row);
  }
  CROPS.forEach((crop,i)=>{
    const count = visibleCellsByCrop[i];
    const row = document.createElement('div');
    row.className = 'lgd-row';
    row.innerHTML = `<span class="lgd-sw" style="background:${crop.hex};border-color:${crop.hex}"></span>
      <span class="lgd-nm">${crop.name[state.lang]||crop.name.en}</span>
      <span class="lgd-val"><span class="lgd-ct">${coveragePct(count)}%</span><span class="lgd-sub">${count} cells · ${plotsContainingCrop[i]} plots</span></span>`;
    root.appendChild(row);
  });
}

function setLegendCollapsed(collapsed){
  const legend = document.getElementById('map-legend');
  const head = document.getElementById('lgd-head');
  const headText = document.getElementById('lgd-head-txt');
  if (!legend || !head || !headText) return;

  legend.classList.toggle('collapsed', collapsed);
  head.setAttribute('aria-expanded', String(!collapsed));
  head.setAttribute('aria-label', collapsed ? 'Show visible crop coverage' : 'Hide visible crop coverage');
  headText.textContent = headText.dataset.collapsedLabel;
}

// ── LANGUAGE ──────────────────────────────────────────────────────
function applyLang(){
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.toggle('on', b.dataset.lang===state.lang));
  document.getElementById('brand-sub').textContent = tr('appSub');
  document.getElementById('map-title').textContent = tr('mapTitle');
  document.getElementById('lab-brush').textContent = tr('brush');
  document.getElementById('lab-crop').textContent = tr('crop');
  if (typeof updateSeasonStaticLabels === 'function') updateSeasonStaticLabels();
  else document.getElementById('sched-label').textContent = tr('schedulePlantingHarvest');
  document.getElementById('scrub-label').textContent = tr('showing');
  setLegendCollapsed(document.getElementById('map-legend').classList.contains('collapsed'));
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
  document.getElementById('prog-marked-label').textContent = tr('plotsMarked');
  document.getElementById('prog-painted-label').textContent = tr('patchesPainted');
  buildPalette();
  updatePlotHeader();
  updateLegend();
  if (typeof updateScheduleReadout === 'function') updateScheduleReadout();
  if (typeof updateShortcutLabels === 'function') updateShortcutLabels();
  if (typeof updateScrubberReadout === 'function') updateScrubberReadout();
}

// ── THEME ─────────────────────────────────────────────────────────
function applyTheme(){
  document.documentElement.setAttribute('data-theme', state.theme);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===state.theme));
  // re-render dependent visuals
  if (map) refreshBaseImageryLayers();
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
  const seasons = (p.seasons || []).filter(season =>
    cropIndexFromId(season.cropId) >= 0 &&
    isValidMmdd(season.start) &&
    isValidMmdd(season.end) &&
    season.cells &&
    season.cells.length);
  if (!seasons.length){
    root.innerHTML = `<div class="ss-empty">${tr('noSchedule')}</div>`;
    return;
  }
  root.innerHTML = `<div class="ss-season-list">` + seasons.map(season => {
    const crop = CROPS[cropIndexFromId(season.cropId)];
    const wraps = rangeWrapsYear(season.start, season.end) ? ' · wraps year' : '';
    return `<div class="ss-season">
      <span class="ss-dot" style="background:${crop.hex}"></span>
      <span>${crop.name[state.lang]||crop.name.en} · ${season.start}-${season.end}${wraps}</span>
      <span class="ss-count">${season.cells.length}</span>
    </div>`;
  }).join('') + `</div>`;
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
  p.seasons = emptySeasons();
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
//   paoay_cropmap_YYYY-MM-DD/
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
  const folder = zip.folder('paoay_cropmap_' + dateStamp);

  let seasonsCsv =
    'plot_idx,season_id,cell_idx,cell_row,cell_col,crop_id,start_mmdd,end_mmdd,wraps_year,center_lat,center_lng,lat_s,lat_n,lng_w,lng_e,farmer_id\n';
  let labelsCsv =
    'plot_idx,plot_area,plot_source,plot_row,plot_col,farmer_id,season_id,cell_idx,cell_row,cell_col,crop_id,crop_en,start_mmdd,end_mmdd,wraps_year,center_lat,center_lng,lat_s,lat_n,lng_w,lng_e\n';
  let plotsCsv =
    'plot_idx,plot_area,plot_source,plot_row,plot_col,centerLat,centerLng,farmer_id,farmer_name,note,photo_count,season_count,total_season_cells,' +
    CROPS.map(c=>`${c.id}_cells`).join(',') + '\n';
  const farmerMap = new Map(); // farmer_id -> { name, plots:[], patches }
  const metaPlots = [];

  // canvas for PNG label render
  const oc = document.createElement('canvas');
  oc.width = 500; oc.height = 500;
  const oct = oc.getContext('2d');

  for (const idx of indices) {
    const p = ensurePlot(idx);
    const plot = PLOTS[idx];
    if (!plot) continue;
    const plotArea = plot.area || 'paoay';
    const plotSource = plot.source || 'field_grid';
    const farmerId = (p.farmerId || '').trim();
    const farmerName = (p.farmer || '').trim();
    const note = (p.note || '').replaceAll('"', '""').replaceAll('\n', ' ');

    const seasonRows = seasonExportRows({ plotIdx: idx, plot, plotData: p, grid: GRID, farmerId });
    const cellCounts = new Array(CROPS.length).fill(0);
    for (const row of seasonRows) {
      const cropIdx = cropIndexFromId(row.crop_id);
      if (cropIdx >= 0) cellCounts[cropIdx]++;
      seasonsCsv += [
        row.plot_idx, row.season_id, row.cell_idx, row.cell_row, row.cell_col,
        row.crop_id, row.start_mmdd, row.end_mmdd, row.wraps_year,
        row.center_lat, row.center_lng, row.lat_s, row.lat_n, row.lng_w, row.lng_e,
        csvEscape(row.farmer_id),
      ].join(',') + '\n';
      const crop = CROPS[cropIdx] || { name: { en: row.crop_id } };
      labelsCsv += [
        row.plot_idx, plotArea, plotSource, plot.r, plot.c, csvEscape(farmerId),
        row.season_id, row.cell_idx, row.cell_row, row.cell_col,
        row.crop_id, csvEscape(crop.name.en), row.start_mmdd, row.end_mmdd, row.wraps_year,
        row.center_lat, row.center_lng, row.lat_s, row.lat_n, row.lng_w, row.lng_e,
      ].join(',') + '\n';
    }

    // PNG label image (snapshot in "all months" view for visual QA only)
    if (seasonRows.length) {
      oct.fillStyle = '#0A1A0A';
      oct.fillRect(0, 0, 500, 500);
      for (let r=0; r<GRID; r++) for (let c=0; c<GRID; c++) {
        const cellIdx = r*GRID + c;
        const present = cellVisibleCropIds(p, cellIdx, ALL_MONTHS).map(cropIndexFromId).filter(i => i >= 0);
        if (!present.length) continue;
        drawMixedCell(oct, c*10, r*10, 10, 10, present, state.mixedStyle);
      }
      folder.file(`labels/plot${String(idx).padStart(3,'0')}.png`,
        oc.toDataURL('image/png').split(',')[1], { base64: true });
    }

    // plots.csv — one row per plot
    const photos = (p.photos || []).filter(ph => ph && (ph.url || ph.dataUrl));
    plotsCsv += [
      idx, plotArea, plotSource, plot.r, plot.c, plot.centerLat, plot.centerLng,
      csvEscape(farmerId), csvEscape(farmerName), csvEscape(note), photos.length,
      (p.seasons || []).length, seasonRows.length, ...cellCounts,
    ].join(',') + '\n';

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
      f.patches += seasonRows.length;
      cellCounts.forEach((n,ci)=>{ if (n>0) f.crops.add(CROPS[ci].id); });
    }

    // metadata
    metaPlots.push({
      plot_idx: idx,
      area: plotArea,
      source: plot.source || 'field_grid',
      row: plot.r, col: plot.c,
      centerLat: plot.centerLat, centerLng: plot.centerLng,
      farmer_id: farmerId,
      farmer_name: farmerName,
      note: p.note || '',
      photo_count: photos.length,
      season_count: (p.seasons || []).length,
      season_cell_rows: seasonRows.length,
      crops: CROPS.map((crop,ci) => ({
        id: crop.id,
        en: crop.name.en,
        season_cell_rows: cellCounts[ci],
      })).filter(x => x.season_cell_rows > 0),
      seasons: cloneSeasons(p.seasons),
    });
  }

  // farmers.csv
  let farmersCsv = 'farmer_id,farmer_name,plot_count,plot_indices,total_patches,crops\n';
  for (const [id, f] of farmerMap.entries()) {
    farmersCsv += `${csvEscape(id)},${csvEscape(f.name)},${f.plots.length},${csvEscape(f.plots.join(';'))},${f.patches},${csvEscape([...f.crops].join(';'))}\n`;
  }

  folder.file('seasons.csv', seasonsCsv);
  folder.file('labels.csv', labelsCsv);
  folder.file('plots.csv', plotsCsv);
  folder.file('farmers.csv', farmersCsv);
  folder.file('metadata.json', JSON.stringify({
    survey_area: 'Paoay, Atok, Benguet',
    surveyed_at: new Date().toISOString(),
    schema_version: 4,
    grid_resolution: `${GRID}x${GRID}`,
    authoritative_ground_truth_file: 'seasons.csv',
    date_encoding: {
      type: 'recurring annual MM-DD inclusive range',
      fields: ['start_mmdd', 'end_mmdd', 'wraps_year'],
      note: 'start_mmdd and end_mmdd are inclusive recurring annual planting-to-harvest windows with no year component',
    },
    coordinate_reference_system: 'EPSG:4326',
    sentinel2_alignment_note: 'Use WGS84 cell centers or bounds from seasons.csv to sample Sentinel-2 bands and vegetation indices for a chosen target year.',
    crops: CROPS.map(c => ({ id:c.id, hex:c.hex, name:c.name })),
    farmers: [...farmerMap.entries()].map(([id, f]) => ({
      id, name: f.name, plot_count: f.plots.length,
      plot_indices: f.plots, total_patches: f.patches,
      crops: [...f.crops],
    })),
    plots: metaPlots,
  }, null, 2));

  if (window.__TAURI__) {
    const uint8 = await zip.generateAsync({type:'uint8array'});
    const filename = `paoay_cropmap_${dateStamp}.zip`;
    // Encode as base64 string — avoids IPC size limits that hit large byte arrays.
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < uint8.length; i += chunk)
      binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
    const dataB64 = btoa(binary);
    try {
      const savedPath = await window.__TAURI__.core.invoke('save_zip', { filename, dataB64 });
      if (savedPath) toast(`Saved to ${savedPath}`);
    } catch (e) {
      console.error('save_zip failed', e);
      toast('Export failed: ' + e);
    }
  } else {
    const blob = await zip.generateAsync({type:'blob'});
    saveAs(blob, `paoay_cropmap_${dateStamp}.zip`);
    toast(tr('saved'));
  }
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
    if (p.seasons) {
      for (const season of p.seasons) {
        const cropIdx = cropIndexFromId(season.cropId);
        if (cropIdx < 0) continue;
        const n = (season.cells || []).length;
        r.cropTotals[cropIdx] += n;
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
    const plotList = r.plots.slice(0,12).map(i=>plotDisplayLabel(PLOTS[i])).join(', ') + (r.plots.length>12?' …':'');
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

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
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
document.getElementById('prev-btn').onclick = ()=>openPlot(adjacentVisiblePlotIdx(state.plotIdx, -1));
document.getElementById('next-btn').onclick = ()=>openPlot(adjacentVisiblePlotIdx(state.plotIdx, 1));

document.addEventListener('keydown', (e)=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); undo(); return; }
  if (e.key === 'ArrowLeft') openPlot(adjacentVisiblePlotIdx(state.plotIdx, -1));
  if (e.key === 'ArrowRight') openPlot(adjacentVisiblePlotIdx(state.plotIdx, 1));
  if (/^[1-9]$/.test(e.key) && +e.key <= CROPS.length){
    state.crop = +e.key - 1; buildPalette(); updateScheduleReadout();
  }
  if (e.key === 'e' || e.key === 'E'){ state.brush = 'erase'; updateBrush(); }
  if (e.key === 'Escape'){
    if (document.getElementById('roster-modal').classList.contains('on')) closeRoster();
    else if (drawer.classList.contains('on')) closeDrawer();
  }
});

window.addEventListener('resize', ()=>{ fitCanvas(); renderCanvas(); });

document.getElementById('lgd-head').addEventListener('click', ()=>{
  const legend = document.getElementById('map-legend');
  setLegendCollapsed(!legend.classList.contains('collapsed'));
});

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
updateNavButtons();

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

if (window.__TAURI__) {
  const btnOpenDir = document.getElementById('btn-open-dir');
  btnOpenDir.style.display = '';
  btnOpenDir.onclick = async () => {
    try {
      await window.__TAURI__.core.invoke('open_data_dir');
    } catch (e) {
      console.warn('open_data_dir failed', e);
    }
  };
}

restoreCloudDirtyQueue();
if (hasSyncInit()) {
  window.syncInit(state, afterRemoteMerge, mayMergeRemote).catch(e => console.warn('initial sync failed:', e));
}

// ── EXPOSE UTILITIES for calendar.js to consume ───────────────────
window.TANIMAN = {
  state, GRID, PLOTS, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils,
  monthsBetween, maskList, maskToLabel, maskIntersects, maskContains,
  normalizeViewMonths, viewMonthFromMask, maskToDisplayLabel,
  shouldAutoSwitchViewMonths, isBrushHiddenOnMap,
  renderCanvas, drawPlotsOnMap, updateMapPlot, updateLegend, updatePlotHeader,
  saveState, tr, schedSave, visiblePlots,
  invalidActivePaintRangeAtStartup,
};
