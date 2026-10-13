// Export builders (spec section 7). Pure: returns CSV/JSON strings; app.js
// adds label PNGs and photos and writes the ZIP.
(function (root) {
  'use strict';

  const Grid = root.TANIMAN_GRID || require('./grid.js');
  const Classes = root.TANIMAN_CLASSES || require('./classes.js');
  const Fields = root.TANIMAN_FIELDS || require('./field-ids.js');
  const Seasons = root.TANIMAN_SEASONS || require('./season-utils.js');

  function csvEscape(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function csv(header, rows) {
    return header.join(',') + '\n' + rows.map(row => row.map(csvEscape).join(',')).join('\n') + (rows.length ? '\n' : '');
  }

  function seasonColumns(season, catalog) {
    const cls = Classes.byId(season.classId) || Classes.OTHER;
    return {
      class_id: season.classId == null ? '' : season.classId,
      class_name: cls.name.en,
      crop_name: season.classId === 4 ? Classes.cropName(catalog, season.cropId) : '',
      remark: season.classId == null ? (season.remark || '') : '',
      start_mmdd: season.start,
      end_mmdd: season.end,
      wraps_year: Seasons.rangeWrapsYear(season.start, season.end),
    };
  }

  function validSeason(season) {
    return season && Seasons.isValidMmdd(season.start) && Seasons.isValidMmdd(season.end);
  }

  function buildExport({ plots, plotData, catalog, grid, exportedAt = new Date().toISOString() }) {
    const { fields, fieldIdFor } = Fields.computeFields(plotData, plots);
    const seasonRows = [];
    const plotRows = [];

    for (const plot of plots) {
      const data = plotData[plot.idx];
      if (!data) continue;
      const classCounts = new Array(Classes.ALL.length).fill(0);
      const seasons = (data.seasons || []).filter(validSeason);
      for (const season of seasons) {
        const cols = seasonColumns(season, catalog);
        for (const cellIdx of season.cells || []) {
          if (!Grid.isCellInBounds(plot, cellIdx)) continue;
          const s2 = Grid.cellToS2(plot.idx, cellIdx);
          const utm = Grid.cellUtmCenter(plot.idx, cellIdx);
          const ll = Grid.cellLatLng(plot, cellIdx);
          classCounts[Classes.legendIndex(season.classId)]++;
          seasonRows.push([
            plot.idx, season.id, fieldIdFor(season.id, cellIdx),
            cols.class_id, cols.class_name, cols.crop_name, cols.remark,
            cols.start_mmdd, cols.end_mmdd, cols.wraps_year,
            s2.s2_row, s2.s2_col, utm.utm_x, utm.utm_y, ll.center_lat, ll.center_lng,
          ]);
        }
      }
      const photos = (data.photos || []).filter(ph => ph && (ph.url || ph.dataUrl));
      plotRows.push([
        plot.idx, plot.pr, plot.pc, plot.validCols, plot.validRows,
        data.note || '', photos.length, seasons.length, ...classCounts,
      ]);
    }

    const fieldRows = fields.map(field => {
      const cols = seasonColumns(field.season, catalog);
      return [
        field.field_id, cols.class_id, cols.class_name, cols.crop_name, cols.remark,
        cols.start_mmdd, cols.end_mmdd, cols.wraps_year, field.cell_count, field.plot_idxs.join(';'),
      ];
    });

    const classRows = Classes.ALL.map(cls => [cls.id == null ? '' : cls.id, cls.key, cls.name.en, cls.hex]);
    for (const crop of (catalog && catalog.all ? catalog.all() : [])) {
      if (crop && crop.isResolved !== false) classRows.push([4, `crop:${crop.id}`, crop.name.en, crop.hex]);
    }

    const metadata = {
      schema_version: 6,
      survey_area: 'Paoay, Atok, Benguet (Sentinel-2 composite extent)',
      exported_at: exportedAt,
      authoritative_ground_truth_file: 'seasons.csv',
      grid,
      date_encoding: {
        type: 'recurring annual MM-DD inclusive range',
        fields: ['start_mmdd', 'end_mmdd', 'wraps_year'],
        note: 'No year component; the pipeline chooses the year.',
      },
      classes: Classes.ALL.map(cls => ({ class_id: cls.id, key: cls.key, name: cls.name.en, hex: cls.hex })),
      notes: [
        's2_row/s2_col index the Sentinel-2 composite pixel; utm_x/utm_y are the pixel center in EPSG:32651.',
        'Rows with an empty class_id are "Other" with a free-text remark: for review, not training.',
      ],
    };

    return {
      seasonsCsv: csv(['plot_idx', 'season_id', 'field_id', 'class_id', 'class_name', 'crop_name', 'remark',
        'start_mmdd', 'end_mmdd', 'wraps_year', 's2_row', 's2_col', 'utm_x', 'utm_y', 'center_lat', 'center_lng'], seasonRows),
      fieldsCsv: csv(['field_id', 'class_id', 'class_name', 'crop_name', 'remark', 'start_mmdd', 'end_mmdd',
        'wraps_year', 'cell_count', 'plot_idxs'], fieldRows),
      classesCsv: csv(['class_id', 'key', 'class_name', 'hex'], classRows),
      plotsCsv: csv(['plot_idx', 'plot_row', 'plot_col', 'valid_cols', 'valid_rows', 'note', 'photo_count',
        'season_count', 'class_1_cells', 'class_2_cells', 'class_3_cells', 'class_4_cells', 'class_5_cells',
        'class_6_cells', 'class_7_cells', 'class_8_cells', 'other_cells'], plotRows),
      metadataJson: JSON.stringify(metadata, null, 2),
    };
  }

  const api = { buildExport, csvEscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_LABEL_EXPORT = api;
})(typeof window !== 'undefined' ? window : globalThis);
