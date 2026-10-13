(function (root) {
  'use strict';
  const dates = typeof module !== 'undefined' && module.exports ? require('./season-utils.js') : root.TANIMAN_SEASONS;
  const CLASS_MAPPING = Object.freeze({carrot:1,cabbage:2,potato:3,other_cultivated:4,forest:5,built_up:6,bare_fallow:7});
  // Existing remote rows use 0..111. Keep those records separate from this grid.
  const CLOUD_OFFSET = 1000000;
  function cloudPlotIdx(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= 120) throw new RangeError('Invalid Sentinel-2 plot index');
    return CLOUD_OFFSET + idx;
  }
  function localPlotIdx(idx) {
    return Number.isInteger(idx) && idx >= CLOUD_OFFSET && idx < CLOUD_OFFSET + 120 ? idx - CLOUD_OFFSET : null;
  }
  function classIdForCrop(crop) {
    if (!crop || crop.isResolved === false) return null;
    return CLASS_MAPPING[crop.id] || (crop.id.startsWith('crop_') ? 4 : null);
  }
  // Labels are recurring calendars: "potato 05-01..07-31" holds every year,
  // so a label is only a class plus an MM-DD range (wrapping past Dec 31 is fine).
  function paintSeasonData(selection, crop) {
    if (!classIdForCrop(crop) || !dates.isValidMmdd(selection.paintStartDate) || !dates.isValidMmdd(selection.paintEndDate)) return null;
    return {cropId:crop.id,start:selection.paintStartDate,end:selection.paintEndDate,fieldId:String(selection.fieldId || '').trim()};
  }
  function hasConflict(seasons, selection, cells) {
    if (!dates.isValidMmdd(selection.start) || !dates.isValidMmdd(selection.end)) return true;
    const selected = new Set(cells);
    return seasons.some(season => {
      const sameClass = season.classId === undefined && selection.classId === undefined
        ? season.cropId === selection.cropId
        : season.classId === selection.classId && (season.classId !== 4 || season.cropId === selection.cropId);
      if (sameClass || !(season.cells || []).some(cell=>selected.has(cell))) return false;
      if (!dates.isValidMmdd(season.start) || !dates.isValidMmdd(season.end)) return true;
      return dates.seasonsOverlap(season.start, season.end, selection.start, selection.end);
    });
  }
  const api = {CLASS_MAPPING,cloudPlotIdx,localPlotIdx,classIdForCrop,paintSeasonData,hasConflict};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_RF_LABELS = api;
})(typeof window !== 'undefined' ? window : globalThis);
