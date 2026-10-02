(function (root) {
  'use strict';

  const UNKNOWN_HEX = '#9CA3AF';

  function cropName(crop) {
    const name = crop && crop.name;
    if (typeof name === 'string') return name;
    return name && (name.en || Object.values(name).find(value => typeof value === 'string')) || '';
  }

  function catalogRows(snapshot) {
    if (Array.isArray(snapshot)) return snapshot;
    if (snapshot && Array.isArray(snapshot.crops)) return snapshot.crops;
    return [];
  }

  function buildCropLookupRows(seasonExportRows, catalogSnapshot) {
    const lookup = new Map();
    for (const crop of catalogRows(catalogSnapshot)) {
      if (!crop || crop.id == null || String(crop.id) === '') continue;
      const id = String(crop.id);
      if (lookup.has(id)) continue;
      lookup.set(id, {
        crop_id: id,
        crop_name: cropName(crop) || `Unknown crop (${id})`,
        hex: typeof crop.hex === 'string' ? crop.hex : UNKNOWN_HEX,
        is_target: Boolean(crop.isTarget ?? crop.is_target),
        is_resolved: crop.isResolved !== false && crop.is_resolved !== false,
      });
    }

    for (const row of Array.isArray(seasonExportRows) ? seasonExportRows : []) {
      if (!row || row.crop_id == null) continue;
      const id = String(row.crop_id);
      if (!id || lookup.has(id)) continue;
      lookup.set(id, {
        crop_id: id,
        crop_name: `Unknown crop (${id})`,
        hex: UNKNOWN_HEX,
        is_target: false,
        is_resolved: false,
      });
    }
    return Array.from(lookup.values());
  }

  function buildPlotCropCounts(seasonExportRows) {
    const counts = new Map();
    for (const row of Array.isArray(seasonExportRows) ? seasonExportRows : []) {
      if (!row || row.plot_idx == null || row.crop_id == null || String(row.crop_id) === '') continue;
      const plotIdx = row.plot_idx;
      const cropId = String(row.crop_id);
      let byCrop = counts.get(plotIdx);
      if (!byCrop) {
        byCrop = new Map();
        counts.set(plotIdx, byCrop);
      }
      byCrop.set(cropId, (byCrop.get(cropId) || 0) + 1);
    }

    const rows = [];
    for (const [plotIdx, byCrop] of counts) {
      for (const [cropId, seasonCellRows] of byCrop) {
        rows.push({ plot_idx: plotIdx, crop_id: cropId, season_cell_rows: seasonCellRows });
      }
    }
    return rows.sort((a, b) => {
      const plotOrder = Number(a.plot_idx) - Number(b.plot_idx);
      return plotOrder || a.crop_id.localeCompare(b.crop_id);
    });
  }

  function csvEscape(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function buildCropsCsv(cropRows) {
    let csv = 'crop_id,crop_name,hex,is_target,is_resolved\n';
    for (const crop of Array.isArray(cropRows) ? cropRows : []) {
      csv += [
        csvEscape(crop.crop_id), csvEscape(crop.crop_name), csvEscape(crop.hex),
        Boolean(crop.is_target), Boolean(crop.is_resolved),
      ].join(',') + '\n';
    }
    return csv;
  }

  function buildPlotCropCountsCsv(countRows) {
    let csv = 'plot_idx,crop_id,season_cell_rows\n';
    for (const count of Array.isArray(countRows) ? countRows : []) {
      csv += [count.plot_idx, csvEscape(count.crop_id), count.season_cell_rows].join(',') + '\n';
    }
    return csv;
  }

  const api = {
    buildCropLookupRows,
    buildPlotCropCounts,
    buildCropsCsv,
    buildPlotCropCountsCsv,
    csvEscape,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_CROP_EXPORT = api;
})(typeof window !== 'undefined' ? window : globalThis);
