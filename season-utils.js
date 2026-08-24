(function(root) {
  const MONTH_DAYS = [31,29,31,30,31,30,31,31,30,31,30,31];
  const MONTH_OFFSETS = [0,31,60,91,121,152,182,213,244,274,305,335];

  function parseMmdd(value) {
    if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return null;
    const month = Number(value.slice(0, 2));
    const day = Number(value.slice(3, 5));
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > MONTH_DAYS[month - 1]) return null;
    return { month, day, ordinal: MONTH_OFFSETS[month - 1] + day - 1 };
  }

  function isValidMmdd(value) {
    return !!parseMmdd(value);
  }

  function compareMmdd(a, b) {
    return parseMmdd(a).ordinal - parseMmdd(b).ordinal;
  }

  function rangeWrapsYear(start, end) {
    return compareMmdd(start, end) > 0;
  }

  function seasonIncludesMmdd(start, end, value) {
    const s = parseMmdd(start);
    const e = parseMmdd(end);
    const v = parseMmdd(value);
    if (!s || !e || !v) return false;
    return s.ordinal <= e.ordinal
      ? v.ordinal >= s.ordinal && v.ordinal <= e.ordinal
      : v.ordinal >= s.ordinal || v.ordinal <= e.ordinal;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function mmdd(month, day) {
    return `${pad2(month)}-${pad2(day)}`;
  }

  function shortcutRange(month, kind) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const last = MONTH_DAYS[month - 1];
    if (kind === 'whole') return { start: mmdd(month, 1), end: mmdd(month, last) };
    if (kind === 'early') return { start: mmdd(month, 1), end: mmdd(month, 10) };
    if (kind === 'mid') return { start: mmdd(month, 11), end: mmdd(month, 20) };
    if (kind === 'late') return { start: mmdd(month, 21), end: mmdd(month, last) };
    return null;
  }

  function rangeSegments(start, end) {
    const s = parseMmdd(start);
    const e = parseMmdd(end);
    if (!s || !e) return [];
    return s.ordinal <= e.ordinal ? [[s.ordinal, e.ordinal]] : [[s.ordinal, 365], [0, e.ordinal]];
  }

  function seasonsOverlap(aStart, aEnd, bStart, bEnd) {
    return rangeSegments(aStart, aEnd).some(([as, ae]) =>
      rangeSegments(bStart, bEnd).some(([bs, be]) => as <= be && bs <= ae));
  }

  function roundCoord(n) {
    return Number(n.toFixed(7));
  }

  function cellGeometry(plot, cellIdx, grid) {
    const cell_row = Math.floor(cellIdx / grid);
    const cell_col = cellIdx % grid;
    const latStep = (plot.latN - plot.latS) / grid;
    const lngStep = (plot.lngE - plot.lngW) / grid;
    const lat_n = plot.latN - cell_row * latStep;
    const lat_s = lat_n - latStep;
    const lng_w = plot.lngW + cell_col * lngStep;
    const lng_e = lng_w + lngStep;
    return {
      cell_row,
      cell_col,
      lat_s: roundCoord(lat_s),
      lat_n: roundCoord(lat_n),
      lng_w: roundCoord(lng_w),
      lng_e: roundCoord(lng_e),
      center_lat: roundCoord((lat_s + lat_n) / 2),
      center_lng: roundCoord((lng_w + lng_e) / 2),
    };
  }

  function seasonExportRows({ plotIdx, plot, plotData, grid, farmerId = '' }) {
    const rows = [];
    for (const season of plotData.seasons || []) {
      if (!isValidMmdd(season.start) || !isValidMmdd(season.end)) continue;
      for (const cellIdx of season.cells || []) {
        rows.push({
          plot_idx: plotIdx,
          season_id: season.id,
          cell_idx: cellIdx,
          ...cellGeometry(plot, cellIdx, grid),
          crop_id: season.cropId,
          start_mmdd: season.start,
          end_mmdd: season.end,
          wraps_year: rangeWrapsYear(season.start, season.end),
          farmer_id: farmerId,
        });
      }
    }
    return rows;
  }

  const api = {
    MONTH_DAYS,
    parseMmdd,
    isValidMmdd,
    compareMmdd,
    rangeWrapsYear,
    seasonIncludesMmdd,
    shortcutRange,
    seasonsOverlap,
    cellGeometry,
    seasonExportRows,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_SEASONS = api;
})(typeof window !== 'undefined' ? window : globalThis);
