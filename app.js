// ── Taniman v6 ───────────────────────────────────────────────────
// Sentinel-2 aligned grid (one cell = one 10 m pixel), land-cover classes,
// per-season sync through the apply_season_cells RPC.

// ── CONFIG ────────────────────────────────────────────────────────
const GRID = 50;
const STORAGE_KEY = 'taniman_v6_s2grid';
const ATOK_POLY = window.ATOK_POLY;
const PAOAY_POLY = window.PAOAY_POLY;
const PLOTS = window.PLOTS;
const GridMath = window.TANIMAN_GRID;
const RFLabels = window.TANIMAN_RF_LABELS;
const CanvasZoom = window.TANIMAN_CANVAS_ZOOM;
const Classes = window.TANIMAN_CLASSES;
const Outbox = window.TANIMAN_OUTBOX;
const LabelExport = window.TANIMAN_LABEL_EXPORT;
const CROPS = window.CROPS;                 // set by crop-catalog.js: class-4 crop names only
const CropCatalog = window.TANIMAN_CROP_CATALOG;
const T     = window.STRINGS;
const GRID_BOUNDS = GridMath.gridBoundsLatLng(PLOTS);
const GEOMETRY_EPSILON = 1e-12;

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
  plotIdx: 0,
  plots: {},
  viewMonth: -1,              // -1 = all months; 0..11 = scrub to month
  viewMonths: ALL_MONTHS,     // mask of months displayed on map/canvas
  mixedStyle: 'diagonal',
  showTweaks: false,
  version: 6,
};
// Every session starts with nothing selected (spec section 4): the brush
// selection and dates are never restored from storage.
state.selection = { classKey: null, cropId: null, remark: '' };
state.paintStartDate = null;
state.paintEndDate = null;
state.datesAuto = false;
// Labels are recurring calendars with no year (Sir Kent's farm calendars hold
// every year), so older saved states drop their crop-cycle year.
delete state.referenceYear;
state.fieldId = state.fieldId || '';
delete state.selectedCropId;
delete state.crop;

if (!state.plots || typeof state.plots !== 'object' || Array.isArray(state.plots)) state.plots = {};
CropCatalog.registerReferences(state.plots);
if (state.viewMonth === undefined) state.viewMonth = -1;
state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth);
state.viewMonth = viewMonthFromMask(state.viewMonths);
if (!state.mixedStyle) state.mixedStyle = 'diagonal';
if (!PLOTS[state.plotIdx]) state.plotIdx = 0;

// Per-plot data structure:
//   p.seasons = [{ id, classId, cropId, remark, start, end, cells }]
//     id is deterministic: Classes.seasonId(plotIdx, meta)
//   p.note, p.photos
function emptySeasons() { return []; }
function ensurePlot(idx) {
  let p = state.plots[idx];
  if (!p) p = state.plots[idx] = { seasons: emptySeasons(), note: '', photos: [] };
  if (!Array.isArray(p.seasons)) p.seasons = [];
  if (p.note === undefined) p.note = '';
  if (p.photos === undefined) p.photos = [];
  delete p.farmerId;
  delete p.farmer;
  return p;
}

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
let canvasView = CanvasZoom.create();  // plot canvas zoom/pan, reset per plot
let panDrag = null, pinch = null, strokeHasUndo = false, spaceHeld = false, moveMode = false;
let imgCache = {};
let lastSaveAt = Date.now();
let detailDraft = null;

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
    const out = { ...state, plots:{}, outbox: outbox.toJSON(), metaDirty: [...metaDirty] };
    delete out.selection;
    delete out.paintStartDate;
    delete out.paintEndDate;
    delete out.datesAuto;
    delete out.paintMonths;
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
// Season cells sync as per-season deltas through apply_season_cells (spec
// section 8). Plot note/photos sync as a slim plots row. The outbox is saved
// with state so unsent edits survive reloads.
const outbox = Outbox.create(state.outbox);
const metaDirty = new Set(Array.isArray(state.metaDirty) ? state.metaDirty : []);
delete state.outbox;
delete state.metaDirty;
let cloudTimer = null;
let flushPromise = null;
const CLOUD_SYNC_DELAY = 1500;
const CLOUD_RETRY_DELAY = 30000;

function hasCloud() { return typeof window.applySeasonCells === 'function'; }
// Queued or in flight: the local copy of this season is newer than the server's.
function isSeasonPending(id) { return outbox.has(id); }
function hasPendingPhotoUpload(idx) {
  const p = state.plots[idx];
  return !!(p && p.photos && p.photos.some(ph => ph && ph.dataUrl && !ph.url));
}

function scheduleCloudFlush(delay = CLOUD_SYNC_DELAY) {
  if (!hasCloud()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    flushCloudSync().catch(e => console.warn('cloud sync failed:', e));
  }, delay);
}

function queueSeasonChange(plotIdx, season, add, remove) {
  outbox.record(Outbox.metaFromSeason(plotIdx, season), add, remove);
  scheduleCloudFlush();
}

function queueMetaChange(plotIdx) {
  metaDirty.add(plotIdx);
  scheduleCloudFlush();
}

function afterRemoteChange(idx) {
  CropCatalog.registerReferences(state.plots);
  updateMapPlot(idx);
  if (idx === state.plotIdx) {
    renderCanvas();
    updatePlotHeader();
    refreshMetaToggle();
    if (drawer && drawer.classList.contains('on')) renderScheduleSummary();
  }
  updateProgress();
  schedSave();
}

function applyServerSeason(plotIdx, seasonId, row) {
  const p = ensurePlot(plotIdx);
  const i = p.seasons.findIndex(s => s.id === seasonId);
  if (!row) {
    if (i >= 0) p.seasons.splice(i, 1);
  } else if (i >= 0) {
    p.seasons[i] = Outbox.seasonFromRow(row);
  } else {
    p.seasons.push(Outbox.seasonFromRow(row));
  }
  afterRemoteChange(plotIdx);
}

async function refreshPlotFromServer(idx) {
  if (typeof window.fetchPlotSeasons !== 'function') return;
  try {
    const rows = await window.fetchPlotSeasons(idx);
    const p = ensurePlot(idx);
    p.seasons = Outbox.mergeRemoteSeasons(p.seasons, rows.map(Outbox.seasonFromRow), isSeasonPending);
    clearUndoForPlot(idx);
    afterRemoteChange(idx);
  } catch (e) {
    console.warn('plot refresh failed:', e);
  }
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

// Only one flush runs at a time; callers that need it finished await this.
function flushCloudSync() {
  if (!hasCloud()) return Promise.resolve();
  if (!flushPromise) flushPromise = runCloudFlush().finally(() => { flushPromise = null; });
  return flushPromise;
}

async function runCloudFlush() {
  let retry = false;
  try {
    ({ retry } = await Outbox.flush(outbox, {
      send: delta => window.applySeasonCells(delta),
      onRow: (delta, row) => applyServerSeason(delta.plotIdx, delta.id, row),
      onPermanent: async (delta, error) => {
        console.warn('dropping a change the server rejected:', error);
        // A crop name deleted here makes its in-flight deltas fail; that is expected.
        const cropDeleted = delta.cropId && !CropCatalog.isResolved(delta.cropId);
        if (!cropDeleted) toast(tr('syncDropped'));
        await refreshPlotFromServer(delta.plotIdx);
      },
    }));
    for (const idx of [...metaDirty]) {
      await uploadPendingPhotos(idx);
      const ok = await window.upsertPlotMeta(idx, ensurePlot(idx));
      if (ok && !hasPendingPhotoUpload(idx)) metaDirty.delete(idx);
      else retry = true;
    }
  } finally {
    saveState();
    if (retry) scheduleCloudFlush(CLOUD_RETRY_DELAY);
    else if (outbox.size() || metaDirty.size) scheduleCloudFlush();
  }
}

async function initialCloudLoad() {
  if (typeof window.fetchAllSeasons !== 'function') return;
  try {
    const [seasonRows, metaRows] = await Promise.all([window.fetchAllSeasons(), window.fetchPlotMeta()]);
    const byPlot = new Map();
    for (const row of seasonRows) {
      if (!byPlot.has(row.plot_idx)) byPlot.set(row.plot_idx, []);
      byPlot.get(row.plot_idx).push(Outbox.seasonFromRow(row));
    }
    for (const plot of PLOTS) {
      const remote = byPlot.get(plot.idx) || [];
      if (!state.plots[plot.idx] && !remote.length) continue;
      const p = ensurePlot(plot.idx);
      p.seasons = Outbox.mergeRemoteSeasons(p.seasons, remote, isSeasonPending);
    }
    for (const row of metaRows) {
      if (metaDirty.has(row.plot_idx)) continue;
      const p = ensurePlot(row.plot_idx);
      p.note = row.note || '';
      p.photos = window.decodePhotos(row.photo_url);
    }
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoBtn();
    CropCatalog.registerReferences(state.plots);
    drawPlotsOnMap();
    renderCanvas();
    updatePlotHeader();
    refreshMetaToggle();
    updateProgress();
    saveState();
  } catch (e) {
    console.warn('initial sync failed:', e);
  }
  scheduleCloudFlush(0);
}

function savePlotChange() {
  schedSave();
}

// ── CELL DATA QUERIES ─────────────────────────────────────────────
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
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
function activePaintMonthsMask() {
  const data = activePaintSeasonData();
  return data ? seasonMonthsMask(data.start, data.end) : ALL_MONTHS;
}
function seasonHex(season) {
  return Classes.seasonColor(season, CropCatalog);
}
function currentSelectionStatus() {
  const selection = Classes.selectionStatus(
    { ...state.selection, start: state.paintStartDate, end: state.paintEndDate },
    id => CropCatalog.isResolved(id));
  if (!selection.ready) return selection;
  const meta = {...Classes.paintMeta({...state.selection,start:state.paintStartDate,end:state.paintEndDate},id=>CropCatalog.isResolved(id)),fieldId:state.fieldId};
  try { Classes.seasonId(state.plotIdx,meta); } catch (_) { return {ready:false,message:'Shorten the field ID or remark before painting.'}; }
  return selection;
}
function activePaintSeasonData() {
  if (!currentSelectionStatus().ready) return null;
  const meta = Classes.paintMeta(
    { ...state.selection, start: state.paintStartDate, end: state.paintEndDate },
    id => CropCatalog.isResolved(id));
  return meta && {...meta,fieldId:state.fieldId || ''};
}
function cellVisibleColors(p, cellIdx, viewMonths = state.viewMonths) {
  const out = [];
  const seen = new Set();
  for (const season of p.seasons || []) {
    if (!Array.isArray(season.cells) || !season.cells.includes(cellIdx)) continue;
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    const hex = seasonHex(season);
    if (!seen.has(hex)) { seen.add(hex); out.push(hex); }
  }
  return out;
}
function plotCompositionForView(idx, viewMonths = state.viewMonths) {
  const plot = PLOTS[idx];
  const p = state.plots[idx];
  const gridCells = GridMath.validCellCount(plot);
  const counts = new Array(Classes.ALL.length).fill(0);
  const percentages = new Array(Classes.ALL.length).fill(0);
  const visibleCells = new Set();
  const seen = new Set();
  for (const season of (p && p.seasons) || []) {
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    const legendIdx = Classes.legendIndex(season.classId);
    for (const cellIdx of season.cells || []) {
      if (!GridMath.isCellInBounds(plot, cellIdx)) continue;
      const key = `${legendIdx}:${cellIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[legendIdx]++;
      visibleCells.add(cellIdx);
    }
  }
  const totalVisibleCells = counts.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < counts.length; i++) percentages[i] = totalVisibleCells ? counts[i] / totalVisibleCells : 0;
  const max = Math.max(...counts);
  const topIdx = max > 0 ? counts.indexOf(max) : -1;
  const nonZero = counts.filter(n => n > 0).length;
  return {
    top: topIdx >= 0 ? Classes.ALL[topIdx] : null,
    counts,
    percentages,
    totalVisibleCells,
    visiblePaintedCells: visibleCells.size,
    emptyCells: Math.max(0, gridCells - visibleCells.size),
    nonZeroCropCount: nonZero,
    isMixed: nonZero > 1,
  };
}
function plotHasPaint(idx) {
  const p = state.plots[idx];
  return !!(p && Array.isArray(p.seasons) && p.seasons.some(season => Array.isArray(season.cells) && season.cells.length));
}
function plotHasData(idx) {
  const p = state.plots[idx];
  if (!p) return false;
  return plotHasPaint(idx) || p.note || (p.photos && p.photos.length);
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
function restoreSeasonsSnapshot(idx, seasons) {
  const p = ensurePlot(idx);
  for (const delta of Outbox.diffSeasons(idx, p.seasons, seasons)) {
    outbox.record(delta.meta, delta.add, delta.remove);
  }
  p.seasons = cloneSeasons(seasons);
  scheduleCloudFlush();
}
function clearUndoForPlot(idx) {
  for (const stack of [undoStack, redoStack]) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].plotIdx === idx) stack.splice(i, 1);
  }
  updateUndoBtn();
}
function applyUndoEntry(e, pushTo) {
  const p = ensurePlot(e.plotIdx);
  pushTo.push({ plotIdx: e.plotIdx, seasons: cloneSeasons(p.seasons) });
  if (pushTo.length > UNDO_LIMIT) pushTo.shift();
  restoreSeasonsSnapshot(e.plotIdx, e.seasons);
  CropCatalog.registerReferences(state.plots);
  if (state.plotIdx !== e.plotIdx) { state.plotIdx = e.plotIdx; updatePlotHeader(); drawPlotsOnMap(); }
  else updateMapPlot(e.plotIdx);
  renderCanvas(); updateProgress(); refreshMetaToggle(); updateUndoBtn();
  schedSave();
}
function undo() {
  const e = undoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  applyUndoEntry(e, redoStack);
  toast(tr('undone'));
}
function redo() {
  const e = redoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  applyUndoEntry(e, undoStack);
}
function updateUndoBtn() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

// ── MIXED-CELL DRAWING ───────────────────────────────────────────
function drawMixedCell(ctx, x0, y0, w, h, colors, style){
  if (colors.length === 0) return;
  if (colors.length > 4) style = 'stripes';
  if (colors.length === 1){
    ctx.fillStyle = colors[0];
    ctx.fillRect(x0, y0, w+0.5, h+0.5);
    return;
  }
  if (style === 'stripes'){
    const bw = w / colors.length;
    for (let i=0; i<colors.length; i++){
      ctx.fillStyle = colors[i];
      ctx.fillRect(x0 + i*bw, y0, bw + 0.6, h + 0.5);
    }
    return;
  }
  if (style === 'diagonal' && colors.length === 2){
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0+w+0.5, y0+h+0.5); ctx.lineTo(x0, y0+h+0.5); ctx.closePath();
    ctx.fill();
    return;
  }
  // quadrants
  const hw = w/2, hh = h/2;
  const slots = [[0,0],[hw,0],[0,hh],[hw,hh]];
  let order;
  if (colors.length === 2) order = [0, 1, 1, 0];
  else if (colors.length === 3) order = [0, 1, 2, 0];
  else order = [0, 1, 2, 3];
  for (let i=0; i<4; i++){
    ctx.fillStyle = colors[order[i]];
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
  [GRID_BOUNDS.latS, GRID_BOUNDS.lngW],
  [GRID_BOUNDS.latN, GRID_BOUNDS.lngE]
);
// About 1 km of margin around the composite extent.
const GRID_MAX_BOUNDS = MAP_DETAIL_BOUNDS.pad(0.2);

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
    maxBounds: GRID_MAX_BOUNDS,
    maxBoundsViscosity: 0.85,
    zoomControl:false,
    attributionControl:false,
    zoomAnimation:false,
  });
  addBaseImageryLayers();
  L.polygon(PAOAY_POLY, {
    color:'#F2C84B', weight:2.5, dashArray:'7,5',
    fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
  }).addTo(map);
  drawPlotsOnMap();
  map.fitBounds(MAP_DETAIL_BOUNDS);
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
  const { top } = composition;
  const isCurrent = idx === state.plotIdx;
  if (top){
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
  let usedPct = 0;
  const segments = composition.counts.map((count, i) => {
    if (count <= 0) return '';
    const requestedPct = Number(composition.percentages[i]) * 100 || 0;
    const pct = Math.min(Math.max(0, requestedPct), Math.max(0, 100 - usedPct));
    usedPct += pct;
    return `<span class="mix-seg" style="width:${pct}%;background:${Classes.ALL[i].hex}"></span>`;
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
    const rect = L.polygon(plot.corners, style).addTo(map);
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
const referenceFieldInput = document.getElementById('reference-field');
referenceFieldInput.value = state.fieldId || '';
referenceFieldInput.addEventListener('input', () => {
  state.fieldId = referenceFieldInput.value.trim();
  renderCanvas(); schedSave();
});
const canvas = document.getElementById('plot-canvas');
const ctx = canvas.getContext('2d');

function fitCanvas(){
  const frame = document.getElementById('canvas-frame');
  const zone = document.querySelector('.canvas-zone');
  const status = document.querySelector('.canvas-status');
  const pad = 36;
  const statusH = status ? status.offsetHeight + 10 : 0;
  const availableHeight = window.innerWidth <= 700 ? zone.clientWidth - pad : zone.clientHeight - pad - statusH;
  const size = Math.max(120, Math.min(zone.clientWidth - pad, availableHeight));
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
  // Everything below is drawn in unzoomed plot coordinates.
  const zoom = canvasView.z;
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -canvasView.x * w * dpr * zoom, -canvasView.y * h * dpr * zoom);

  const plot = PLOTS[state.plotIdx];
  const tile = getPlotTile(state.plotIdx);
  if (tile && tile.complete && tile.naturalWidth > 0) ctx.drawImage(tile, 0, 0, w, h);

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
      if (!GridMath.isCellInBounds(plot, idx)) continue;
      const cropList = cellVisibleColors(p, idx);
      if (!cropList.length) continue;
      painted++;
      const x0 = c*cellW, y0 = r*cellH;
      ctx.globalAlpha = cropList.length > 1 ? Math.min(.96, baseAlpha + 0.06) : baseAlpha;
      drawMixedCell(ctx, x0, y0, cellW, cellH, cropList, state.mixedStyle);
    }
  }
  ctx.globalAlpha = 1;

  if (plot && (plot.validCols < GRID || plot.validRows < GRID)) {
    ctx.fillStyle = 'rgba(64,64,64,0.88)';
    if (plot.validCols < GRID) ctx.fillRect(plot.validCols * cellW, 0, w - plot.validCols * cellW, h);
    if (plot.validRows < GRID) ctx.fillRect(0, plot.validRows * cellH, plot.validCols * cellW, h - plot.validRows * cellH);
  }

  // grid
  ctx.strokeStyle = getCss('--grid-line');
  // Zoomed cells are large enough for a full-pixel line between them.
  ctx.lineWidth = (zoom > 1 ? 1 : 0.5) / zoom;
  ctx.globalAlpha = zoom > 1 ? 0.6 : 0.45;
  for (let i=1;i<GRID;i++){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.4 / zoom;
  for (let i=10;i<GRID;i+=10){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  ctx.strokeStyle = getCss('--grid-major');
  ctx.lineWidth = 1.2 / zoom;
  ctx.strokeRect(0.5,0.5,w-1,h-1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateCanvasZoomControls();

  // corner counter
  document.getElementById('canvas-corner').textContent = `10 × 10 m per cell · ${painted} / ${GridMath.validCellCount(plot)}`;
  // top-right "showing" tag
  const tag = document.getElementById('canvas-view-tag');
  const paintMonths = activePaintMonthsMask();
  state.paintMonths = paintMonths;
  const brushHidden = isBrushHiddenOnMap(state.viewMonths, paintMonths);
  tag.classList.toggle('hidden-brush', brushHidden);
  tag.textContent = brushHidden
    ? `Hidden · ${maskToDisplayLabel(paintMonths)} brush`
    : 'Showing · ' + maskToDisplayLabel(state.viewMonths, { singleLong: true }).toLowerCase();
  const prompt = document.getElementById('canvas-prompt');
  if (prompt) {
    const status = currentSelectionStatus();
    const show = state.brush !== 'erase' && !status.ready;
    prompt.hidden = !show;
    if (show) prompt.textContent = status.message || tr(Classes.PROMPT_KEYS[status.missing]);
  }
}

// ── PAINTING ──────────────────────────────────────────────────────
function cellAt(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) / rect.width, sy = (clientY - rect.top) / rect.height;
  if (!(sx >= 0 && sx < 1 && sy >= 0 && sy < 1)) return null;
  const base = CanvasZoom.toBase(canvasView, sx, sy);
  const c = Math.floor(base.x * GRID);
  const r = Math.floor(base.y * GRID);
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
function addCellsToPaintSeason(idx, p, cellIds) {
  const meta = activePaintSeasonData();
  if (!meta || !cellIds.length) return false;
  if (RFLabels.hasConflict(p.seasons,meta,cellIds)) { toast('This pixel has another class for these dates. Erase it first.'); return false; }
  const id = Classes.seasonId(idx, meta);
  let season = p.seasons.find(s => s.id === id);
  if (!season) {
    season = { id, ...meta, cells: [] };
    p.seasons.push(season);
  }
  const cells = new Set(season.cells);
  const added = cellIds.filter(c => !cells.has(c));
  if (!added.length) return false;
  for (const c of added) cells.add(c);
  season.cells = [...cells].sort((a, b) => a - b);
  queueSeasonChange(idx, season, added, []);
  return true;
}
function eraseCellsFromSeasons(idx, p, cellIds) {
  const remove = new Set(cellIds);
  let changed = false;
  for (const season of p.seasons) {
    const removed = (season.cells || []).filter(c => remove.has(c));
    if (!removed.length) continue;
    season.cells = season.cells.filter(c => !remove.has(c));
    queueSeasonChange(idx, season, [], removed);
    changed = true;
  }
  p.seasons = p.seasons.filter(season => season.cells && season.cells.length);
  return changed;
}
function flashPaintPrompt() {
  const el = document.getElementById('canvas-prompt');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;  // restart the animation
  el.classList.add('flash');
}
function paintAt(clientX, clientY){
  const image = getPlotTile(state.plotIdx);
  if (!image || !image.complete || !image.naturalWidth) return;
  const cell = cellAt(clientX, clientY);
  if (!cell) return;
  const linear = cell.r*GRID + cell.c;
  if (linear === lastIdx) return;
  lastIdx = linear;

  const idx = state.plotIdx;
  const plot = PLOTS[idx];
  if (state.brush !== 'erase' && !activePaintSeasonData()) { flashPaintPrompt(); return; }
  const p = ensurePlot(idx);
  const size = state.brush==='erase' ? 1 : state.brush;
  const cellIds = GridMath.brushCells(plot, cell.r, cell.c, size);
  const changed = state.brush === 'erase'
    ? eraseCellsFromSeasons(idx, p, cellIds)
    : addCellsToPaintSeason(idx, p, cellIds);
  if (!changed) return;
  if (state.brush !== 'erase') ensurePaintVisibleOnMap();
  renderCanvas();
  updateProgress();
  updateMapPlot(idx);
  savePlotChange(idx);
}

let saveTimer = null;
function schedSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

// ── CANVAS ZOOM ───────────────────────────────────────────────────
// Wheel or trackpad pinch zooms at the pointer; two fingers pinch and pan on
// touch. The Move toggle makes a plain drag pan instead of paint; space-drag,
// right-drag and middle-drag pan without it.
function setMoveMode(on) {
  moveMode = !!on && canvasView.z > 1;
  const btn = document.getElementById('canvas-move');
  if (btn) btn.setAttribute('aria-pressed', String(moveMode));
  canvas.classList.toggle('pan-ready', moveMode || spaceHeld);
  document.getElementById('brush-cursor').style.display = 'none';
}
function setCanvasView(view) {
  canvasView = CanvasZoom.clamp(view);
  document.getElementById('brush-cursor').style.display = 'none';
  renderCanvas();
}
function resetCanvasZoom() { canvasView = CanvasZoom.create(); }
function zoomCanvasBy(factor, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX === undefined ? 0.5 : (clientX - rect.left) / rect.width;
  const sy = clientY === undefined ? 0.5 : (clientY - rect.top) / rect.height;
  setCanvasView(CanvasZoom.zoomAt(canvasView, factor, sx, sy));
}
function updateCanvasZoomControls() {
  const level = document.getElementById('zoom-canvas-level');
  if (!level) return;
  const z = canvasView.z;
  level.textContent = (Math.round(z * 10) / 10) + '×';
  level.disabled = z === 1;
  document.getElementById('zoom-canvas-out').disabled = z === 1;
  document.getElementById('zoom-canvas-in').disabled = z >= CanvasZoom.MAX_ZOOM;
  document.getElementById('canvas-move').disabled = z === 1;
  if (z === 1 && moveMode) setMoveMode(false);  // nothing to move at 1×
}
function touchMidpoint(e) {
  const rect = canvas.getBoundingClientRect();
  const [a, b] = e.touches;
  return {
    x: ((a.clientX + b.clientX) / 2 - rect.left) / rect.width,
    y: ((a.clientY + b.clientY) / 2 - rect.top) / rect.height,
    d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
  };
}
// A second finger turns a one-finger stroke into a pinch: undo what it painted.
function cancelStroke() {
  if (!painting) return;
  painting = false;
  if (!strokeHasUndo) return;
  strokeHasUndo = false;
  const entry = undoStack.pop();
  restoreSeasonsSnapshot(entry.plotIdx, entry.seasons);
  renderCanvas(); updateProgress(); updateMapPlot(entry.plotIdx); refreshMetaToggle(); updateUndoBtn(); schedSave();
}

function onDown(e){
  if (e.target !== canvas) return;
  e.preventDefault();
  if (e.touches && e.touches.length > 1) {
    cancelStroke();
    pinch = { start: touchMidpoint(e), view: canvasView };
    return;
  }
  if (moveMode || (!e.touches && (spaceHeld || e.button === 1 || e.button === 2))) {
    const pt = e.touches ? e.touches[0] : e;
    panDrag = { x: pt.clientX, y: pt.clientY };
    canvas.classList.add('panning');
    return;
  }
  painting = true; lastIdx = -1;
  strokeHasUndo = state.brush === 'erase' || !!activePaintSeasonData();
  if (strokeHasUndo) snapshotForUndo(state.plotIdx);
  const pt = e.touches ? e.touches[0] : e;
  paintAt(pt.clientX, pt.clientY);
}
function onMove(e){
  const cursor = document.getElementById('brush-cursor');
  const rect = canvas.getBoundingClientRect();
  if (pinch && e.touches && e.touches.length > 1) {
    e.preventDefault();
    const now = touchMidpoint(e), start = pinch.start;
    const zoomed = CanvasZoom.zoomAt(pinch.view, now.d / start.d, start.x, start.y);
    setCanvasView(CanvasZoom.pan(zoomed, now.x - start.x, now.y - start.y));
    return;
  }
  if (pinch) return;  // one finger left after a pinch: no painting until lifted
  if (panDrag) {
    const pt = e.touches ? e.touches[0] : e;
    if (e.touches) e.preventDefault();
    setCanvasView(CanvasZoom.pan(canvasView, (pt.clientX - panDrag.x) / rect.width, (pt.clientY - panDrag.y) / rect.height));
    panDrag = { x: pt.clientX, y: pt.clientY };
    return;
  }
  if (moveMode) return;  // no brush outline while moving
  const pt = e.touches ? e.touches[0] : e;
  if (pt && pt.clientX>=rect.left && pt.clientX<=rect.right && pt.clientY>=rect.top && pt.clientY<=rect.bottom){
    const size = state.brush==='erase' ? 1 : state.brush;
    const cellPx = rect.width / GRID * canvasView.z;
    cursor.style.display = 'block';
    cursor.style.width = (cellPx*size) + 'px';
    cursor.style.height = (cellPx*size) + 'px';
    const cell = cellAt(pt.clientX, pt.clientY);
    if (cell){
      const half = Math.floor(size/2);
      cursor.style.left = ((cell.c-half) * cellPx - canvasView.x * rect.width * canvasView.z) + 'px';
      cursor.style.top  = ((cell.r-half) * cellPx - canvasView.y * rect.height * canvasView.z) + 'px';
      cursor.style.borderColor = state.brush==='erase'
        ? 'var(--danger)'
        : Classes.selectionColor(state.selection, CropCatalog);
    }
  } else {
    cursor.style.display = 'none';
  }
  if (painting && pt){
    e.preventDefault();
    paintAt(pt.clientX, pt.clientY);
  }
}
function onUp(e){
  painting = false;
  if (panDrag) { panDrag = null; canvas.classList.remove('panning'); }
  if (pinch && !(e && e.touches && e.touches.length)) pinch = null;
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  zoomCanvasBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
}, {passive:false});
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('zoom-canvas-in').addEventListener('click', () => zoomCanvasBy(1.5));
document.getElementById('zoom-canvas-out').addEventListener('click', () => zoomCanvasBy(1 / 1.5));
document.getElementById('zoom-canvas-level').addEventListener('click', () => setCanvasView(CanvasZoom.create()));
document.getElementById('canvas-move').addEventListener('click', () => setMoveMode(!moveMode));
canvas.addEventListener('mousedown', onDown);
document.addEventListener('mousemove', onMove);
document.addEventListener('mouseup', onUp);
canvas.addEventListener('touchstart', onDown, {passive:false});
canvas.addEventListener('touchmove', onMove, {passive:false});
canvas.addEventListener('touchend', onUp);
canvas.addEventListener('mouseleave', ()=>{ document.getElementById('brush-cursor').style.display='none'; });

// ── CLASS + CROP NAME SELECTION ───────────────────────────────────
let cropPickerInstance = null;
let classPickerInstance = null;

function applyClassDates(key) {
  const defaults = Classes.defaultDates(key);
  if (defaults && (state.paintStartDate == null || state.datesAuto)) {
    state.paintStartDate = defaults.start;
    state.paintEndDate = defaults.end;
    state.datesAuto = true;
  } else if (!defaults && state.datesAuto) {
    state.paintStartDate = null;
    state.paintEndDate = null;
    state.datesAuto = false;
  }
}
function refreshSelectionUi() {
  buildPalette();
  updateBrush();
  if (typeof window.syncSeasonSelectors === 'function') window.syncSeasonSelectors();
  if (typeof window.updateScheduleReadout === 'function') window.updateScheduleReadout();
  renderCanvas();
}
function selectClass(key) {
  if (!Classes.byKey(key)) return;
  state.selection.classKey = key;
  if (key !== 'other_cultivated') state.selection.cropId = null;
  if (key !== 'other') state.selection.remark = '';
  applyClassDates(key);
  if (state.brush === 'erase') state.brush = 1;
  setMoveMode(false);
  refreshSelectionUi();
}
function selectCrop(cropId) {
  const crop = CropCatalog.byId(cropId);
  if (!crop || !CropCatalog.isResolved(crop.id)) return;
  state.selection.classKey = 'other_cultivated';
  state.selection.cropId = crop.id;
  state.selection.remark = '';
  applyClassDates('other_cultivated');
  if (state.brush === 'erase') state.brush = 1;
  setMoveMode(false);
  refreshSelectionUi();
}
function setRemark(text) {
  state.selection.remark = text;
  if (typeof window.updateScheduleReadout === 'function') window.updateScheduleReadout();
  renderCanvas();
}

async function removeCustomCrop(cropId) {
  const removedSeasons = await CropCatalog.remove(cropId);
  outbox.dropCrop(cropId);
  for (const plot of Object.values(state.plots)) {
    if (plot && Array.isArray(plot.seasons)) plot.seasons = plot.seasons.filter(s => s && s.cropId !== cropId);
  }
  if (state.selection.cropId === cropId) state.selection.cropId = null;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoBtn();
  CropCatalog.registerReferences(state.plots);
  saveState();
  renderCanvas();
  drawPlotsOnMap();
  updateLegend();
  updateProgress();
  updatePlotHeader();
  refreshMetaToggle();
  if (drawer && drawer.classList.contains('on')) loadMetadataIntoDrawer();
  refreshSelectionUi();
  return removedSeasons;
}

function buildPalette(){
  if (!classPickerInstance) {
    classPickerInstance = window.TANIMAN_CLASS_PICKER.create({
      root: document.getElementById('class-picker'),
      remarkField: document.getElementById('other-remark-field'),
      remarkInput: document.getElementById('other-remark'),
      remarkLabel: document.getElementById('other-remark-label'),
      classes: Classes.ALL,
      onSelect: selectClass,
      onRemark: setRemark,
    });
  }
  classPickerInstance.render({
    classKey: state.selection.classKey, remark: state.selection.remark, lang: state.lang, tr,
  });
  document.getElementById('crop-name-section').hidden = state.selection.classKey !== 'other_cultivated';
  if (!cropPickerInstance) {
    cropPickerInstance = window.TANIMAN_CROP_PICKER.create({
      root: document.getElementById('crop-picker'),
      catalog: CropCatalog,
      selectedCropId: state.selection.cropId || '',
      lang: state.lang,
      onSelect: selectCrop,
      onCreate: async (name, hex) => {
        const result = await CropCatalog.create(name, hex);
        if (result.status === 'created') selectCrop(result.crop.id);
        return result;
      },
      onRemove: removeCustomCrop,
    });
  }
  cropPickerInstance.render({ selectedCropId: state.selection.cropId || '', lang: state.lang });
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
  if (prev !== idx) resetCanvasZoom();
  updatePlotHeader();
  renderCanvas();
  updateMapPlot(prev);
  updateMapPlot(idx);
  const plot = PLOTS[idx];
  const bounds = L.latLngBounds(plot.corners);
  if (!map.getBounds().contains(bounds)) map.panTo([plot.centerLat,plot.centerLng], {animate:true});
  updateNavButtons();
  if (drawer.classList.contains('on')) loadMetadataIntoDrawer();
  else detailDraft = null;
  refreshMetaToggle();
  schedSave();
  refreshPlotFromServer(idx);
}
function updatePlotHeader(){
  const plot = PLOTS[state.plotIdx];
  if (!plot) return;
  const p = state.plots[state.plotIdx];
  document.getElementById('plot-name').textContent = tr('plotN').replace('{n}', plotDisplayLabel(plot));
  document.getElementById('plot-loc').textContent = `R${plot.pr} · C${plot.pc} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
  document.getElementById('dr-title').textContent =
    document.getElementById('plot-name').textContent + ' — ' + tr('plotSection').toLowerCase();
  updateNavButtons();
}
function refreshMetaToggle() {
  const p = state.plots[state.plotIdx];
  const has = p && (p.note || (p.photos && p.photos.length));
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
  const visibleCells = new Array(Classes.ALL.length).fill(0);
  const plotsWith = new Array(Classes.ALL.length).fill(0);
  let emptyVisibleCells = 0;
  let totalCells = 0;
  PLOTS.forEach(plot => {
    const composition = plotCompositionForView(plot.idx);
    totalCells += GridMath.validCellCount(plot);
    emptyVisibleCells += composition.emptyCells;
    composition.counts.forEach((count, i) => {
      visibleCells[i] += count;
      if (count > 0) plotsWith[i]++;
    });
  });
  const pct = count => totalCells ? Math.round((count / totalCells) * 100) : 0;
  const rows = [`<div class="lgd-row"><span class="lgd-sw empty"></span>
      <span class="lgd-nm">${tr('unpainted')}</span>
      <span class="lgd-val"><span class="lgd-ct">${pct(emptyVisibleCells)}%</span><span class="lgd-sub">${emptyVisibleCells} cells</span></span></div>`];
  Classes.ALL.forEach((cls, i) => {
    rows.push(`<div class="lgd-row"><span class="lgd-sw" style="background:${cls.hex};border-color:${cls.hex}"></span>
      <span class="lgd-nm">${escapeHtml(cls.name[state.lang] || cls.name.en)}</span>
      <span class="lgd-val"><span class="lgd-ct">${pct(visibleCells[i])}%</span><span class="lgd-sub">${visibleCells[i]} cells · ${plotsWith[i]} plots</span></span></div>`);
  });
  root.innerHTML = rows.join('');
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
  document.getElementById('lab-class').textContent = tr('classLabel');
  document.getElementById('lab-crop').textContent = tr('cropNameLabel2');
  if (typeof updateSeasonStaticLabels === 'function') updateSeasonStaticLabels();
  else document.getElementById('sched-label').textContent = tr('schedulePlantingHarvest');
  document.getElementById('scrub-label').textContent = tr('showing');
  setLegendCollapsed(document.getElementById('map-legend').classList.contains('collapsed'));
  document.getElementById('btn-undo-txt').textContent = tr('undo');
  document.getElementById('btn-redo-txt').textContent = tr('redo');
  document.getElementById('btn-clear').textContent = tr('clear');
  document.getElementById('btn-save-txt').textContent = tr('saveAll');
  document.getElementById('meta-toggle-txt').textContent = tr('plotDetails');
  document.getElementById('lab-note').textContent = tr('note');
  document.getElementById('lab-photo').textContent = tr('photo');
  document.getElementById('ph-note').textContent = tr('notePh');
  document.getElementById('lab-summary').textContent = tr('schedSummary');
  document.getElementById('prog-marked-label').textContent = tr('plotsMarked');
  document.getElementById('prog-painted-label').textContent = tr('patchesPainted');
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
function loadMetadataIntoDrawer() {
  const p = ensurePlot(state.plotIdx);
  detailDraft = {
    note: p.note || '',
    photos: (p.photos || []).map(ph => ({ ...ph })),
  };
  document.getElementById('in-note').value = detailDraft.note;
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
    isValidMmdd(season.start) && isValidMmdd(season.end) && season.cells && season.cells.length);
  if (!seasons.length){
    root.innerHTML = `<div class="ss-empty">${tr('noSchedule')}</div>`;
    return;
  }
  root.innerHTML = `<div class="ss-season-list">` + seasons.map(season => {
    const wraps = rangeWrapsYear(season.start, season.end) ? ' · wraps year' : '';
    const label = season.classId === 4
      ? (Classes.cropName(CropCatalog, season.cropId, state.lang) || Classes.className(4, state.lang))
      : season.classId == null
        ? `${Classes.className(null, state.lang)}: ${season.remark}`
        : Classes.className(season.classId, state.lang);
    return `<div class="ss-season">
      <span class="ss-dot" style="background:${seasonHex(season)}"></span>
      <span>${escapeHtml(label)} · ${season.start}-${season.end}${wraps}</span>
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
  p.note = detailDraft.note;
  p.photos = detailDraft.photos.map(ph => ({ ...ph }));
  queueMetaChange(idx);
  saveState();
  refreshMetaToggle();
  updatePlotHeader();
  updateProgress();
  toast(tr('saved'));
  closeDrawer();
};

document.getElementById('in-note').oninput     = (e) => { if (detailDraft) detailDraft.note = e.target.value; };
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
document.getElementById('btn-clear').onclick = async ()=>{
  const idx = state.plotIdx;
  if (!plotHasData(idx)) return;
  if (!confirm(tr('confirmClear'))) return;
  const p = ensurePlot(idx);
  outbox.dropPlot(idx);   // also drops in-flight deltas, so their results are ignored
  metaDirty.delete(idx);
  p.seasons = emptySeasons();
  p.note = '';
  p.photos = [];
  clearUndoForPlot(idx);
  renderCanvas(); updateProgress(); updateMapPlot(idx);
  if (drawer.classList.contains('on')) loadMetadataIntoDrawer();
  refreshMetaToggle(); updatePlotHeader();
  saveState();
  toast(tr('cleared'));
  if (typeof window.clearPlotRemote === 'function') {
    // Let any request already on the wire land first, so clear_plot runs last.
    if (flushPromise) await flushPromise.catch(() => {});
    try { await window.clearPlotRemote(idx); }
    catch (e) { console.warn('clear plot failed:', e); toast(tr('syncDropped')); }
  }
};
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;

// ── ZIP EXPORT ────────────────────────────────────────────────────
// paoay_cropmap_YYYY-MM-DD/
//   seasons.csv  fields.csv  classes.csv  plots.csv  metadata.json
//   labels/plotNNN.png   photos/plotNNN_N.jpg
document.getElementById('btn-save').onclick = async () => {
  CropCatalog.registerReferences(state.plots);
  const indices = PLOTS.map(plot => plot.idx).filter(plotHasData);
  if (!indices.length){ toast(tr('empty')); return; }
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span>';
  try {
  await flushCloudSync();
  if (outbox.size()) await flushCloudSync();   // edits made while the first flush ran

  const zip = new JSZip();
  const dateStamp = new Date().toISOString().slice(0,10);
  const folder = zip.folder('paoay_cropmap_' + dateStamp);

  const plotData = {};
  for (const idx of indices) plotData[idx] = ensurePlot(idx);
  const exported = LabelExport.buildExport({ plots: PLOTS, plotData, catalog: CropCatalog, grid: window.GRID, paoayPoly:PAOAY_POLY });
  folder.file('seasons.csv', exported.seasonsCsv);
  folder.file('fields.csv', exported.fieldsCsv);
  folder.file('classes.csv', exported.classesCsv);
  folder.file('plots.csv', exported.plotsCsv);
  folder.file('metadata.json', exported.metadataJson);

  const oc = document.createElement('canvas');
  oc.width = 500; oc.height = 500;
  const oct = oc.getContext('2d');
  for (const idx of indices) {
    const p = plotData[idx];
    const plot = PLOTS[idx];
    if (plotHasPaint(idx)) {
      oct.clearRect(0, 0, 500, 500);
      for (let r=0; r<GRID; r++) for (let c=0; c<GRID; c++) {
        const cellIdx = r*GRID + c;
        if (!GridMath.isCellInBounds(plot, cellIdx)) {
          oct.fillStyle = '#404040';
          oct.fillRect(c*10, r*10, 10, 10);
          continue;
        }
        const colors = cellVisibleColors(p, cellIdx, ALL_MONTHS);
        if (colors.length) drawMixedCell(oct, c*10, r*10, 10, 10, colors, state.mixedStyle);
      }
      folder.file(`labels/plot${String(idx).padStart(3,'0')}.png`,
        oc.toDataURL('image/png').split(',')[1], { base64: true });
    }
    (p.photos || []).filter(ph => ph && ph.dataUrl).forEach((ph, pi) => {
      folder.file(`photos/plot${String(idx).padStart(3,'0')}_${pi}.jpg`, ph.dataUrl.split(',')[1], { base64: true });
    });
  }

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
    setMoveMode(false);
    updateBrush();
    renderCanvas();
    saveState();
  };
});
document.getElementById('prev-btn').onclick = ()=>openPlot(adjacentVisiblePlotIdx(state.plotIdx, -1));
document.getElementById('next-btn').onclick = ()=>openPlot(adjacentVisiblePlotIdx(state.plotIdx, 1));

document.addEventListener('keydown', (e)=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); undo(); return; }
  if (e.key === 'ArrowLeft') openPlot(adjacentVisiblePlotIdx(state.plotIdx, -1));
  if (e.key === 'ArrowRight') openPlot(adjacentVisiblePlotIdx(state.plotIdx, 1));
  if (/^[1-3]$/.test(e.key)) selectClass(Classes.byId(+e.key).key);
  if (e.key === 'e' || e.key === 'E'){ state.brush = 'erase'; setMoveMode(false); updateBrush(); renderCanvas(); }
  if (e.key === 'm' || e.key === 'M') setMoveMode(!moveMode);
  if (e.key === '+' || e.key === '=') zoomCanvasBy(1.5);
  if (e.key === '-' || e.key === '_') zoomCanvasBy(1 / 1.5);
  if (e.key === '0') setCanvasView(CanvasZoom.create());
  if (e.key === ' ' && !e.repeat && e.target.tagName !== 'BUTTON') { e.preventDefault(); spaceHeld = true; canvas.classList.add('pan-ready'); }
  if (e.key === 'Escape' && drawer.classList.contains('on')) closeDrawer();
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') { spaceHeld = false; canvas.classList.toggle('pan-ready', moveMode); }
});
window.addEventListener('blur', () => { spaceHeld = false; canvas.classList.toggle('pan-ready', moveMode); });

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

initialCloudLoad();

CropCatalog.subscribe(() => {
  buildPalette();
  renderCanvas();
  drawPlotsOnMap();
  updateLegend();
  if (typeof window.updateScheduleReadout === 'function') window.updateScheduleReadout();
});

function wireCropCatalogRefresh(catalog, eventTarget = window) {
  if (!catalog || eventTarget.__TAURI__) return () => {};
  const refresh = () => {
    try {
      const request = catalog.refresh();
      if (request && typeof request.catch === 'function') {
        request.catch(error => console.warn('crop catalog refresh failed:', error));
      }
    } catch (error) {
      console.warn('crop catalog refresh failed:', error);
    }
  };
  eventTarget.addEventListener('focus', refresh);
  refresh();
  return () => eventTarget.removeEventListener('focus', refresh);
}

wireCropCatalogRefresh(CropCatalog);

// ── EXPOSE UTILITIES for calendar.js to consume ───────────────────
window.TANIMAN = {
  state, GRID, PLOTS, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils, CropCatalog, Classes,
  monthsBetween, maskList, maskToLabel, maskIntersects, maskContains,
  normalizeViewMonths, viewMonthFromMask, maskToDisplayLabel,
  shouldAutoSwitchViewMonths, isBrushHiddenOnMap,
  renderCanvas, drawPlotsOnMap, updateMapPlot, updateLegend, updatePlotHeader,
  saveState, tr, schedSave, visiblePlots,
  selectionStatus: currentSelectionStatus,
};
