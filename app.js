// ── Taniman v3 ───────────────────────────────────────────────────
// Redesign adds: per-cell crop calendar (12 months), proper per-crop colors,
// optional Farmer ID + roster view, month scrubber on the map.

// ── CONFIG ────────────────────────────────────────────────────────
const GRID = 50;
const STORAGE_KEY = 'taniman_v3';
const AMBASSADOR_PLOTS = window.AMBASSADOR_PLOTS;
const POLY  = window.AMBASSADOR_POLY;
const CROPS = window.CROPS;
const T     = window.STRINGS;
const CORE_PLOT_COUNT = AMBASSADOR_PLOTS.length;
const TUBLAY_DETAIL_BOUNDS = {
  n: 16.5514979,
  s: 16.4547903,
  e: 120.7004932,
  w: 120.5665814,
};
const AMBASSADOR_GRID_BOUNDS = AMBASSADOR_PLOTS.reduce((bounds, plot) => ({
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
const AMBASSADOR_GRID_ROWS = Math.max(...AMBASSADOR_PLOTS.map(plot => plot.r)) + 1;
const AMBASSADOR_GRID_COLS = Math.max(...AMBASSADOR_PLOTS.map(plot => plot.c)) + 1;
const AMBASSADOR_PLOT_LAT = (AMBASSADOR_GRID_BOUNDS.latN - AMBASSADOR_GRID_BOUNDS.latS) / AMBASSADOR_GRID_ROWS;
const AMBASSADOR_PLOT_LNG = (AMBASSADOR_GRID_BOUNDS.lngE - AMBASSADOR_GRID_BOUNDS.lngW) / AMBASSADOR_GRID_COLS;
const GEOMETRY_EPSILON = 1e-12;
const TUBLAY_POLY = window.TUBLAY_POLY;
const TUBLAY_BBOX = {
  latS: TUBLAY_DETAIL_BOUNDS.s,
  latN: TUBLAY_DETAIL_BOUNDS.n,
  lngW: TUBLAY_DETAIL_BOUNDS.w,
  lngE: TUBLAY_DETAIL_BOUNDS.e,
};
// ESRI uses {z}/{y}/{x} order (y before x) — different from local tiles {z}/{x}/{y}
const ESRI_TILE_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

async function checkConnectivity(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/57/119',
      { signal: controller.signal, mode: 'no-cors' }
    );
    clearTimeout(id);
    return true;
  } catch {
    return false;
  }
}

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
  if (pointInRect(lat, lng, AMBASSADOR_GRID_BOUNDS)) return 'ambassador';
  if (!pointInRect(lat, lng, TUBLAY_BBOX)) return 'outside';
  if (pointInPolygon(lat, lng, TUBLAY_POLY)) return 'tublay';
  return 'outside';
}

function plotOverlapsRect(plot, rect) {
  return plot.latS < rect.latN - GEOMETRY_EPSILON &&
    plot.latN > rect.latS + GEOMETRY_EPSILON &&
    plot.lngW < rect.lngE - GEOMETRY_EPSILON &&
    plot.lngE > rect.lngW + GEOMETRY_EPSILON;
}

function orientation(a, b, c) {
  const value = (b.lng - a.lng) * (c.lat - b.lat) - (b.lat - a.lat) * (c.lng - b.lng);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b.lng <= Math.max(a.lng, c.lng) + 1e-12 &&
    b.lng >= Math.min(a.lng, c.lng) - 1e-12 &&
    b.lat <= Math.max(a.lat, c.lat) + 1e-12 &&
    b.lat >= Math.min(a.lat, c.lat) - 1e-12;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function plotCorners(plot) {
  return [
    { lat: plot.latN, lng: plot.lngW },
    { lat: plot.latN, lng: plot.lngE },
    { lat: plot.latS, lng: plot.lngE },
    { lat: plot.latS, lng: plot.lngW },
  ];
}

function plotOverlapsPolygon(plot, poly) {
  const corners = plotCorners(plot);
  if (corners.some(pt => pointInPolygon(pt.lat, pt.lng, poly))) return true;
  if (poly.some(([lat, lng]) => pointInRect(lat, lng, plot))) return true;

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let j = 0; j < poly.length; j++) {
      const c = { lat: poly[j][0], lng: poly[j][1] };
      const d = { lat: poly[(j + 1) % poly.length][0], lng: poly[(j + 1) % poly.length][1] };
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function buildOutsidePlots() {
  const plotLat = AMBASSADOR_PLOT_LAT;
  const plotLng = AMBASSADOR_PLOT_LNG;
  const rowStart = Math.ceil((AMBASSADOR_GRID_BOUNDS.latN - TUBLAY_DETAIL_BOUNDS.n) / plotLat);
  const rowEnd = Math.floor((AMBASSADOR_GRID_BOUNDS.latN - TUBLAY_DETAIL_BOUNDS.s) / plotLat);
  const colStart = Math.ceil((TUBLAY_DETAIL_BOUNDS.w - AMBASSADOR_GRID_BOUNDS.lngW) / plotLng);
  const colEnd = Math.floor((TUBLAY_DETAIL_BOUNDS.e - AMBASSADOR_GRID_BOUNDS.lngW) / plotLng);
  const plots = [];
  for (let r = rowStart; r < rowEnd; r++) {
    const latN = AMBASSADOR_GRID_BOUNDS.latN - r * plotLat;
    const latS = latN - plotLat;
    for (let c = colStart; c < colEnd; c++) {
      const lngW = AMBASSADOR_GRID_BOUNDS.lngW + c * plotLng;
      const lngE = lngW + plotLng;
      const centerLat = (latN + latS) / 2;
      const centerLng = (lngW + lngE) / 2;
      const candidate = { latS, latN, lngW, lngE, centerLat, centerLng };
      if (plotOverlapsRect(candidate, AMBASSADOR_GRID_BOUNDS)) continue;
      if (plotOverlapsPolygon(candidate, POLY)) continue;
      const outsideSeq = plots.length;
      const idx = CORE_PLOT_COUNT + outsideSeq;
      plots.push({
        ...candidate,
        idx, r, c, outsideSeq,
        area: 'tublay',
        source: 'outside_field_report',
        tilePath: `tiles/plots/outside_${String(outsideSeq).padStart(3, '0')}.jpg`,
      });
    }
  }
  return plots;
}

const TUBLAY_PLOTS = buildOutsidePlots();
const PLOTS = AMBASSADOR_PLOTS
  .map(plot => ({
    ...plot,
    area: 'ambassador',
    source: 'field_grid',
    tilePath: `tiles/plots/plot_${String(plot.idx).padStart(3, '0')}.jpg`,
  }))
  .concat(TUBLAY_PLOTS);

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
  // new in v3:
  paintMonths: ALL_MONTHS,    // mask of months that new paint applies to
  paintStart: 0,              // start month of current range (for UI handle dragging)
  paintEnd: 11,               // end month of current range
  viewMonth: -1,              // -1 = all months; 0..11 = scrub to month
  viewMonths: ALL_MONTHS,     // mask of months displayed on map/canvas
  mixedStyle: 'diagonal',
  showTweaks: false,
  enabledOutsidePlots: [],
  customOutsidePlots: [],
  version: 3,
};

// fill in any missing keys (state was loaded from a previous version)
if (state.paintMonths === undefined) state.paintMonths = ALL_MONTHS;
if (state.paintStart === undefined) state.paintStart = 0;
if (state.paintEnd === undefined) state.paintEnd = 11;
if (state.viewMonth === undefined) state.viewMonth = -1;
state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth);
state.viewMonth = viewMonthFromMask(state.viewMonths);
if (!state.mixedStyle) state.mixedStyle = 'diagonal';
if (!Array.isArray(state.enabledOutsidePlots)) state.enabledOutsidePlots = [];
if (!Array.isArray(state.customOutsidePlots)) state.customOutsidePlots = [];
restoreCustomOutsidePlots();
state.enabledOutsidePlots = [...new Set(state.enabledOutsidePlots
  .map(Number)
  .filter(idx => Number.isInteger(idx) && idx >= CORE_PLOT_COUNT && PLOTS[idx]))];
if (!PLOTS[state.plotIdx] || (state.plotIdx >= CORE_PLOT_COUNT && !state.enabledOutsidePlots.includes(state.plotIdx))) {
  state.plotIdx = 0;
}

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
if (!Object.prototype.hasOwnProperty.call(T, state.lang)) state.lang = 'en';

// ── HELPERS ───────────────────────────────────────────────────────
function tr(k){ return (T[state.lang]||T.en)[k] || k; }
function getCss(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

let map, plotRects = {}, plotMarkers = {}, plotCompositionBars = {};
let painting = false, lastIdx = -1;
let imgCache = {};
let lastSaveAt = Date.now();
let detailDraft = null;
let outsideAddMode = false;
let mapTileCache = {};

function isTublayPlot(plotOrIdx) {
  const idx = typeof plotOrIdx === 'number' ? plotOrIdx : plotOrIdx && plotOrIdx.idx;
  return Number.isInteger(idx) && idx >= CORE_PLOT_COUNT;
}

function isPlotEnabled(plot) {
  return !isTublayPlot(plot) || state.enabledOutsidePlots.includes(plot.idx);
}

function visiblePlots() {
  return PLOTS.slice(0, CORE_PLOT_COUNT).concat(
    state.enabledOutsidePlots.map(idx => PLOTS[idx]).filter(Boolean)
  );
}

function visiblePlotIndices() {
  return visiblePlots().map(plot => plot.idx);
}

function adjacentVisiblePlotIdx(idx, direction) {
  const indices = visiblePlotIndices();
  const pos = indices.indexOf(idx);
  if (pos < 0) return indices[0] ?? 0;
  return indices[pos + direction] ?? idx;
}

function plotDisplayLabel(plot) {
  if (!plot) return '';
  return isTublayPlot(plot) ? `O${String(outsideDisplayNumber(plot.idx)).padStart(2, '0')}` : String(plot.idx + 1).padStart(2, '0');
}

function outsideDisplayNumber(idx) {
  const pos = state.enabledOutsidePlots.indexOf(idx);
  return pos >= 0 ? pos + 1 : (PLOTS[idx]?.outsideSeq ?? 0) + 1;
}

function updateNavButtons() {
  const indices = visiblePlotIndices();
  const pos = indices.indexOf(state.plotIdx);
  document.getElementById('prev-btn').disabled = pos <= 0;
  document.getElementById('next-btn').disabled = pos < 0 || pos >= indices.length - 1;
}

function nextCustomOutsidePlotIdx() {
  const customMax = state.customOutsidePlots.reduce((max, plot) => Math.max(max, Number(plot.idx) || -1), -1);
  const enabledMax = state.enabledOutsidePlots.reduce((max, idx) => Math.max(max, idx), -1);
  return Math.max(PLOTS.length - 1, customMax, enabledMax, CORE_PLOT_COUNT - 1) + 1;
}

function plotFitsDetailBounds(plot) {
  return plot.latS >= TUBLAY_DETAIL_BOUNDS.s &&
    plot.latN <= TUBLAY_DETAIL_BOUNDS.n &&
    plot.lngW >= TUBLAY_DETAIL_BOUNDS.w &&
    plot.lngE <= TUBLAY_DETAIL_BOUNDS.e;
}

function plotOverlapsVisiblePlots(plot) {
  return visiblePlots().some(existing => plotOverlapsRect(plot, existing));
}

function outsidePlotFromCenter(lat, lng, idx = nextCustomOutsidePlotIdx()) {
  const plot = {
    idx,
    latS: lat - AMBASSADOR_PLOT_LAT / 2,
    latN: lat + AMBASSADOR_PLOT_LAT / 2,
    lngW: lng - AMBASSADOR_PLOT_LNG / 2,
    lngE: lng + AMBASSADOR_PLOT_LNG / 2,
    centerLat: lat,
    centerLng: lng,
    r: null,
    c: null,
    outsideSeq: null,
    area: 'tublay',
    source: 'outside_custom',
    tilePath: null,
  };
  const generated = generatedOutsidePlotFor(plot);
  if (!generated) return plot;
  return {
    ...plot,
    r: generated.r,
    c: generated.c,
    outsideSeq: generated.outsideSeq,
    tilePath: generated.tilePath,
  };
}

function distanceToPlotRect(latlng, plot) {
  const dLat = latlng.lat < plot.latS
    ? plot.latS - latlng.lat
    : (latlng.lat > plot.latN ? latlng.lat - plot.latN : 0);
  const dLng = latlng.lng < plot.lngW
    ? plot.lngW - latlng.lng
    : (latlng.lng > plot.lngE ? latlng.lng - plot.lngE : 0);
  return dLat * dLat + dLng * dLng;
}

function plotPlacementKey(plot) {
  return [
    plot.latS.toFixed(12),
    plot.latN.toFixed(12),
    plot.lngW.toFixed(12),
    plot.lngE.toFixed(12),
  ].join('|');
}

function generatedOutsidePlotFor(plot) {
  return TUBLAY_PLOTS.find(candidate =>
    Math.abs(candidate.latS - plot.latS) <= 1e-9 &&
    Math.abs(candidate.latN - plot.latN) <= 1e-9 &&
    Math.abs(candidate.lngW - plot.lngW) <= 1e-9 &&
    Math.abs(candidate.lngE - plot.lngE) <= 1e-9);
}

function candidateOutsidePlotCenters(latlng) {
  const halfLat = AMBASSADOR_PLOT_LAT / 2;
  const halfLng = AMBASSADOR_PLOT_LNG / 2;
  const centers = [{ lat: latlng.lat, lng: latlng.lng }];
  visiblePlots().forEach(existing => {
    const northLat = existing.latN + halfLat;
    const southLat = existing.latS - halfLat;
    const eastLng = existing.lngE + halfLng;
    const westLng = existing.lngW - halfLng;
    centers.push(
      { lat: northLat, lng: latlng.lng },
      { lat: southLat, lng: latlng.lng },
      { lat: latlng.lat, lng: eastLng },
      { lat: latlng.lat, lng: westLng },
      { lat: northLat, lng: eastLng },
      { lat: northLat, lng: westLng },
      { lat: southLat, lng: eastLng },
      { lat: southLat, lng: westLng },
    );
  });
  return centers;
}

function normalizeCustomOutsidePlot(plot) {
  const idx = Number(plot && plot.idx);
  const latS = Number(plot && plot.latS);
  const latN = Number(plot && plot.latN);
  const lngW = Number(plot && plot.lngW);
  const lngE = Number(plot && plot.lngE);
  if (!Number.isInteger(idx) || idx < CORE_PLOT_COUNT) return null;
  if (![latS, latN, lngW, lngE].every(Number.isFinite)) return null;
  const centerLat = Number.isFinite(Number(plot.centerLat)) ? Number(plot.centerLat) : (latS + latN) / 2;
  const centerLng = Number.isFinite(Number(plot.centerLng)) ? Number(plot.centerLng) : (lngW + lngE) / 2;
  return {
    idx,
    latS,
    latN,
    lngW,
    lngE,
    centerLat,
    centerLng,
    r: plot.r ?? null,
    c: plot.c ?? null,
    outsideSeq: plot.outsideSeq ?? null,
    area: 'tublay',
    source: 'outside_custom',
    tilePath: plot.tilePath || null,
  };
}

function restoreCustomOutsidePlots() {
  state.customOutsidePlots = state.customOutsidePlots
    .map(normalizeCustomOutsidePlot)
    .filter(Boolean);
  state.customOutsidePlots.forEach(plot => {
    PLOTS[plot.idx] = plot;
  });
}

function registerCustomOutsidePlot(plot) {
  const normalized = normalizeCustomOutsidePlot(plot);
  if (!normalized) return null;
  PLOTS[normalized.idx] = normalized;
  if (!state.customOutsidePlots.some(existing => existing.idx === normalized.idx)) {
    state.customOutsidePlots.push(normalized);
  }
  return normalized;
}

function createOutsidePlotAt(latlng, forceCreate = false) {
  if (!latlng) return null;
  const idx = nextCustomOutsidePlotIdx();
  const seen = new Set();
  const candidates = candidateOutsidePlotCenters(latlng)
    .map(center => outsidePlotFromCenter(center.lat, center.lng, idx))
    .filter(candidate => {
      const key = plotPlacementKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return (forceCreate || plotFitsDetailBounds(candidate)) && !plotOverlapsVisiblePlots(candidate);
    })
    .sort((a, b) => distanceToPlotRect(latlng, a) - distanceToPlotRect(latlng, b));
  return candidates[0] || null;
}

function setOutsideAddMode(on) {
  outsideAddMode = !!on;
  const btn = document.getElementById('add-outside-btn');
  if (btn) {
    btn.classList.toggle('on', outsideAddMode);
    btn.setAttribute('aria-pressed', outsideAddMode ? 'true' : 'false');
  }
  if (map) map.getContainer().classList.toggle('adding-outside', outsideAddMode);
}

function showOutsideZoneMessage() {
  toast('This area is outside Tublay. An internet connection is required to view satellite imagery here.');
}

function enableOutsidePlot(idx) {
  if (!PLOTS[idx] || !isTublayPlot(idx)) return;
  if (!state.enabledOutsidePlots.includes(idx)) {
    state.enabledOutsidePlots.push(idx);
  }
  ensurePlot(idx);
  saveState();
  drawPlotsOnMap();
  openPlot(idx);
  updateProgress();
  toast(tr('outsideAdded'));
}

function removeOutsidePlot(idx = state.plotIdx) {
  const plot = PLOTS[idx];
  if (!plot || !isTublayPlot(plot) || !state.enabledOutsidePlots.includes(idx)) return;
  const indices = visiblePlotIndices();
  const pos = indices.indexOf(idx);
  const fallbackIdx = indices[pos - 1] ?? indices[pos + 1] ?? 0;

  state.enabledOutsidePlots = state.enabledOutsidePlots.filter(enabledIdx => enabledIdx !== idx);
  if (plot.source === 'outside_custom') {
    state.customOutsidePlots = state.customOutsidePlots.filter(customPlot => customPlot.idx !== idx);
    delete PLOTS[idx];
    delete imgCache[idx];
  }
  delete state.plots[idx];
  cloudDirty.delete(idx);
  setOutsideAddMode(false);
  saveState();
  drawPlotsOnMap();
  openPlot(fallbackIdx);
  updateProgress();
  toast(tr('outsideRemoved'));
  if (typeof window.deletePlot === 'function') {
    window.deletePlot(idx).catch(e => console.warn('delete plot failed:', e));
  }
}

async function handleOutsideMapClick(e) {
  if (!outsideAddMode) return;
  const { lat, lng } = e.latlng;
  const zone = classifyZone(lat, lng);

  if (zone === 'outside') {
    const online = await checkConnectivity();
    if (!online) {
      showOutsideZoneMessage();
      return;
    }
    // Online + outside Tublay: bypass bounds gate
    const plot = createOutsidePlotAt(e.latlng, true);
    if (!plot) return;
    registerCustomOutsidePlot(plot);
    enableOutsidePlot(plot.idx);
    setOutsideAddMode(false);
    return;
  }
  // zone === 'ambassador' or 'tublay': existing creation logic
  const plot = createOutsidePlotAt(e.latlng);
  if (!plot) return;
  registerCustomOutsidePlot(plot);
  enableOutsidePlot(plot.idx);
  setOutsideAddMode(false);
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
  if (isTublayPlot(idx) && !state.enabledOutsidePlots.includes(idx)) {
    state.enabledOutsidePlots.push(idx);
    drawPlotsOnMap();
  } else {
    updateMapPlot(idx);
  }
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
  const viewMonths = state.viewMonths;
  for (let c=0; c<CROPS.length; c++) {
    const v = p.cells[c][cellIdx];
    if (v && maskIntersects(v, viewMonths)) out.push(c);
  }
  return out;
}
function plotCompositionForView(idx, viewMonths = state.viewMonths) {
  const p = state.plots[idx];
  const gridCells = GRID * GRID;
  const counts = new Array(CROPS.length).fill(0);
  const percentages = new Array(CROPS.length).fill(0);
  if (!p || !p.cells) {
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
  for (let c=0; c<CROPS.length; c++) {
    const cells = p.cells[c] || [];
    for (let i=0; i<cells.length; i++) {
      const v = cells[i];
      if (v && maskIntersects(v, viewMonths)) {
        counts[c]++;
        visibleCells[i] = 1;
      }
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
  return plotCompositionForView(idx);
}
function plotIsMixed(idx) {
  return plotCompositionForView(idx).isMixed;
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
const MAP_TILE_VERSION = '20260602-tublay';
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
  [TUBLAY_DETAIL_BOUNDS.s, TUBLAY_DETAIL_BOUNDS.w],
  [TUBLAY_DETAIL_BOUNDS.n, TUBLAY_DETAIL_BOUNDS.e]
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
  // Tublay outer bounding rectangle — thin white border, no fill
  L.rectangle(
    [[TUBLAY_DETAIL_BOUNDS.s, TUBLAY_DETAIL_BOUNDS.w],
     [TUBLAY_DETAIL_BOUNDS.n, TUBLAY_DETAIL_BOUNDS.e]],
    { color: '#FFFFFF', weight: 1.5, fill: false, interactive: false }
  ).addTo(map);

  // Tublay municipality polygon — dashed light-blue, no fill
  L.polygon(TUBLAY_POLY, {
    color: '#64B5F6', weight: 2, dashArray: '6,4',
    fill: false, interactive: false
  }).addTo(map);

  // Ambassador polygon — unchanged, renders on top of Tublay layers
  L.polygon(POLY, {
    color:'#F2C84B', weight:2.5, dashArray:'7,5',
    fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
  }).addTo(map);
  drawPlotsOnMap();
  map.fitBounds([
    [TUBLAY_DETAIL_BOUNDS.s, TUBLAY_DETAIL_BOUNDS.w],
    [TUBLAY_DETAIL_BOUNDS.n, TUBLAY_DETAIL_BOUNDS.e]
  ]);
  document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
  document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
  document.getElementById('add-outside-btn').onclick = ()=>setOutsideAddMode(!outsideAddMode);
  map.on('click', handleOutsideMapClick);
}

function plotStyle(idx){
  const plot = PLOTS[idx];
  const composition = plotCompositionForView(idx);
  const { crop } = composition;
  const isCurrent = idx === state.plotIdx;
  const isOutside = plot && isTublayPlot(plot);
  if (crop){
    return {
      color: isCurrent ? '#F2C84B' : getCss('--mixed-stroke'),
      weight: isCurrent ? 3 : 2,
      fillColor: getCss('--mixed-fill'),
      fillOpacity: 0.46,
      dashArray: isCurrent ? null : (isOutside ? '8,4' : '4,3'),
    };
  }
  // EMPTY plot — grey (per requirement) — translucent so satellite shows through
  const greyFill = getCss('--empty-fill');
  const greyStroke = getCss('--empty-stroke');
  if (isOutside) {
    return isCurrent
      ? { color:'#F2C84B', weight:3, fillColor:greyFill, fillOpacity:0.28, dashArray:null }
      : { color:'#4DB6FF', weight:1.7, fillColor:greyFill, fillOpacity:0.12, dashArray:'8,4' };
  }
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

  visiblePlots().forEach(plot=>{
    const style = plotStyle(plot.idx);
    const rect = L.rectangle([[plot.latS, plot.lngW],[plot.latN, plot.lngE]], style).addTo(map);
    const marker = L.marker([plot.centerLat, plot.centerLng], {
      icon: L.divIcon({
        className:'',
        html:`<div class="plot-num${isTublayPlot(plot) ? ' outside' : ''}">${plotDisplayLabel(plot)}</div>`,
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
  frame.style.width = size + 'px';
  frame.style.height = size + 'px';
  canvas.width = size;
  canvas.height = size;
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
    };
    const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const isExternal = urlTemplate.startsWith('http');
    img.src = isExternal ? url : `${url}?v=${MAP_TILE_VERSION}`;
    mapTileCache[key] = img;
  }
  return mapTileCache[key];
}

function drawMapTileBackground(plot, w, h, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg') {
  if (!plot) return false;
  const zoom = MAP_DETAIL_MAX_ZOOM;
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
      if (!img.complete || img.naturalWidth <= 0 || img.failed) {
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
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = getCss('--canvas-bg');
  ctx.fillRect(0, 0, w, h);

  const plot = PLOTS[state.plotIdx];
  const zone = plot ? classifyZone(plot.centerLat, plot.centerLng) : null;
  if (zone === 'outside') {
    if (plot) drawMapTileBackground(plot, w, h, ESRI_TILE_TEMPLATE);
  } else {
    const tile = getPlotTile(state.plotIdx);
    if (tile && tile.complete && tile.naturalWidth > 0) {
      ctx.drawImage(tile, 0, 0, w, h);
    } else if (plot && drawMapTileBackground(plot, w, h)) {
      // Background is drawn asynchronously as map tiles load.
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
  const brushHidden = isBrushHiddenOnMap(state.viewMonths, state.paintMonths);
  tag.classList.toggle('hidden-brush', brushHidden);
  tag.textContent = brushHidden
    ? `Hidden · ${maskToDisplayLabel(state.paintMonths)} brush`
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
  if (!shouldAutoSwitchViewMonths(state.viewMonths, state.paintMonths)) return;
  if (typeof window.setViewMonths === 'function') {
    window.setViewMonths(state.paintMonths, { source: 'paintAuto' });
  } else {
    state.viewMonths = normalizeViewMonths(state.paintMonths, state.viewMonth);
    state.viewMonth = viewMonthFromMask(state.viewMonths);
  }
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
  if (!PLOTS[idx] || !isPlotEnabled(PLOTS[idx])) return;
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
  document.getElementById('plot-name').textContent = isTublayPlot(plot)
    ? tr('outsidePlotN').replace('{n}', plotDisplayLabel(plot))
    : tr('plotN').replace('{n}', plotDisplayLabel(plot));
  document.getElementById('plot-loc').textContent = isTublayPlot(plot)
    ? `${tr('outsideArea')} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`
    : `R${plot.r} · C${plot.c} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
  const removeOutsideBtn = document.getElementById('btn-remove-outside');
  if (removeOutsideBtn) removeOutsideBtn.hidden = !isTublayPlot(plot);
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
  const visibleCellsByCrop = new Array(CROPS.length).fill(0);
  const plotsContainingCrop = new Array(CROPS.length).fill(0);
  let emptyVisibleCells = 0;
  let totalVisibleCells = 0;
  visiblePlots().forEach(plot=>{
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
  document.getElementById('add-outside-txt').textContent = tr('addOutsideFarm');
  document.getElementById('add-outside-btn').title = tr('addOutsideFarm');
  document.getElementById('lab-brush').textContent = tr('brush');
  document.getElementById('lab-crop').textContent = tr('crop');
  document.getElementById('sched-label').textContent = tr('schedule');
  document.getElementById('scrub-label').textContent = tr('showing');
  setLegendCollapsed(document.getElementById('map-legend').classList.contains('collapsed'));
  document.getElementById('btn-undo-txt').textContent = tr('undo');
  document.getElementById('btn-redo-txt').textContent = tr('redo');
  document.getElementById('btn-clear').textContent = tr('clear');
  document.getElementById('btn-remove-outside').textContent = tr('removeOutsidePlot');
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
document.getElementById('btn-remove-outside').onclick = () => removeOutsidePlot();
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
    'plot_idx,plot_area,plot_source,plot_row,plot_col,centerLat,centerLng,farmer_id,crop_id,crop_en,patch_row,patch_col,' +
    'jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,month_count\n';
  let plotsCsv =
    'plot_idx,plot_area,plot_source,plot_row,plot_col,centerLat,centerLng,farmer_id,farmer_name,note,photo_count,' +
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
    if (!plot) continue;
    const plotArea = plot.area || 'ambassador';
    const plotSource = plot.source || 'field_grid';
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
        labelsCsv += `${idx},${plotArea},${plotSource},${plot.r},${plot.c},${plot.centerLat},${plot.centerLng},` +
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
    plotsCsv += `${idx},${plotArea},${plotSource},${plot.r},${plot.c},${plot.centerLat},${plot.centerLng},` +
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
      area: plot.area || 'ambassador',
      source: plot.source || 'field_grid',
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

  if (window.__TAURI__) {
    const uint8 = await zip.generateAsync({type:'uint8array'});
    const filename = `ambassador_cropmap_${dateStamp}.zip`;
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
    saveAs(blob, `ambassador_cropmap_${dateStamp}.zip`);
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
  visiblePlots().forEach(plot=>{
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
  monthsBetween, maskList, maskToLabel, maskIntersects, maskContains,
  normalizeViewMonths, viewMonthFromMask, maskToDisplayLabel,
  shouldAutoSwitchViewMonths, isBrushHiddenOnMap,
  renderCanvas, drawPlotsOnMap, updateMapPlot, updateLegend, updatePlotHeader,
  saveState, tr, schedSave, visiblePlots, enableOutsidePlot,
};
