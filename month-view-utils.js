(function(root) {
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const ALL_MONTHS = 0xFFF;

  function monthsBetween(s, e) {
    let mask = 0;
    if (s <= e) {
      for (let i = s; i <= e; i += 1) mask |= (1 << i);
    } else {
      for (let i = s; i < 12; i += 1) mask |= (1 << i);
      for (let i = 0; i <= e; i += 1) mask |= (1 << i);
    }
    return mask;
  }

  function maskList(mask) {
    const out = [];
    for (let i = 0; i < 12; i += 1) if (mask & (1 << i)) out.push(i);
    return out;
  }

  function maskIntersects(a, b) {
    return ((a & b) & ALL_MONTHS) !== 0;
  }

  function maskContains(container, contained) {
    const a = container & ALL_MONTHS;
    const b = contained & ALL_MONTHS;
    return b !== 0 && (a & b) === b;
  }

  function viewMonthsFromLegacy(viewMonth) {
    return Number.isInteger(viewMonth) && viewMonth >= 0 && viewMonth <= 11
      ? (1 << viewMonth)
      : ALL_MONTHS;
  }

  function normalizeViewMonths(value, legacyViewMonth) {
    if (value === undefined) return viewMonthsFromLegacy(legacyViewMonth);
    if (Number.isInteger(value)) {
      if (value > 0 && value <= ALL_MONTHS) return value & ALL_MONTHS;
      return ALL_MONTHS;
    }
    return ALL_MONTHS;
  }

  function viewMonthFromMask(mask) {
    const normalized = normalizeViewMonths(mask, -1);
    if (normalized === ALL_MONTHS) return -1;
    const months = maskList(normalized);
    return months.length === 1 ? months[0] : -2;
  }

  function contiguousSegments(months) {
    if (!months.length) return [];
    const segments = [[months[0], months[0]]];
    for (let i = 1; i < months.length; i += 1) {
      const last = segments[segments.length - 1];
      if (months[i] === last[1] + 1) last[1] = months[i];
      else segments.push([months[i], months[i]]);
    }
    if (segments.length > 1 && segments[0][0] === 0 && segments[segments.length - 1][1] === 11) {
      const first = segments.shift();
      segments[segments.length - 1][1] = first[1];
    }
    return segments;
  }

  function maskToDisplayLabel(mask, options = {}) {
    const normalized = normalizeViewMonths(mask, -1);
    if (normalized === ALL_MONTHS) return 'All year';
    const months = maskList(normalized);
    if (months.length === 1) return options.singleLong ? MONTH_LONG[months[0]] : MONTH_SHORT[months[0]];
    const segments = contiguousSegments(months);
    if (segments.length === 1) {
      const [start, end] = segments[0];
      return start === end ? MONTH_SHORT[start] : `${MONTH_SHORT[start]}-${MONTH_SHORT[end]}`;
    }
    return months.map((month) => MONTH_SHORT[month]).join(', ');
  }

  function shouldAutoSwitchViewMonths(viewMonths, paintMonths) {
    const normalizedView = normalizeViewMonths(viewMonths, -1);
    return normalizedView !== ALL_MONTHS && !maskContains(normalizedView, paintMonths);
  }

  function isBrushHiddenOnMap(viewMonths, paintMonths) {
    return shouldAutoSwitchViewMonths(viewMonths, paintMonths);
  }

  const api = {
    ALL_MONTHS,
    MONTH_SHORT,
    MONTH_LONG,
    monthsBetween,
    maskList,
    maskIntersects,
    maskContains,
    viewMonthsFromLegacy,
    normalizeViewMonths,
    viewMonthFromMask,
    maskToDisplayLabel,
    shouldAutoSwitchViewMonths,
    isBrushHiddenOnMap,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_MONTH_VIEW = api;
})(typeof window !== 'undefined' ? window : globalThis);
