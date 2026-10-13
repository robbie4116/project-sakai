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
  function validYear(year) {
    return year !== '' && year != null && Number.isInteger(Number(year)) && Number(year) >= 1980 && Number(year) <= 2100;
  }
  function paintSeasonData(selection, crop) {
    if (!classIdForCrop(crop) || !validYear(selection.referenceYear) || !dates.isValidMmdd(selection.paintStartDate) || !dates.isValidMmdd(selection.paintEndDate)) return null;
    const year = Number(selection.referenceYear);
    // MM-DD permits Feb 29 for recurring calendars; a dated observation must be real.
    const result = {cropId:crop.id,start:selection.paintStartDate,end:selection.paintEndDate,referenceYear:year,fieldId:String(selection.fieldId || '').trim()};
    if (!absoluteRange(result)) return null;
    return result;
  }
  function absoluteRange(season) {
    if (!validYear(season.referenceYear) || !dates.isValidMmdd(season.start) || !dates.isValidMmdd(season.end)) return null;
    const year = Number(season.referenceYear);
    const endYear = year + Number(dates.rangeWrapsYear(season.start,season.end));
    const make = (y, mmdd) => {
      const [m,d] = mmdd.split('-').map(Number);
      const value = new Date(Date.UTC(y,m-1,d));
      return value.getUTCMonth() === m-1 && value.getUTCDate() === d ? value.getTime() : null;
    };
    const start = make(year,season.start), end = make(endYear,season.end);
    return start == null || end == null ? null : [start,end];
  }
  function hasConflict(seasons, selection, cells) {
    const range = absoluteRange(selection);
    if (!range) return true;
    const selected = new Set(cells);
    return seasons.some(season => {
      const sameClass = season.classId === undefined && selection.classId === undefined
        ? season.cropId === selection.cropId
        : season.classId === selection.classId && (season.classId !== 4 || season.cropId === selection.cropId);
      if (sameClass || !(season.cells || []).some(cell=>selected.has(cell))) return false;
      // Legacy annotations have no observed year and are excluded from training.
      // Keep them without treating them as observations of every dated cycle.
      if (!validYear(season.referenceYear)) return false;
      const other = absoluteRange(season);
      return !other || (range[0] <= other[1] && other[0] <= range[1]);
    });
  }
  const api = {CLASS_MAPPING,cloudPlotIdx,localPlotIdx,classIdForCrop,validYear,paintSeasonData,absoluteRange,hasConflict};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_RF_LABELS = api;
})(typeof window !== 'undefined' ? window : globalThis);
