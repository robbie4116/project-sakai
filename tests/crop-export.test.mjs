import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildCropLookupRows, buildPlotCropCounts, buildCropsCsv, buildPlotCropCountsCsv, csvEscape } = require('../crop-export.js');
const JSZip = require('../vendor/jszip.min.js');

test('crop lookup covers target, custom, and unresolved IDs exactly once', () => {
  const rows = [
    { plot_idx: 1, crop_id: 'lettuce' },
    { plot_idx: 1, crop_id: 'crop-uuid-1' },
    { plot_idx: 1, crop_id: 'legacy,"crop"\n1' },
  ];
  const catalog = [
    { id: 'lettuce', hex: '#4CAF50', name: { en: 'Lettuce' }, isTarget: true, isResolved: true },
    { id: 'crop-uuid-1', hex: '#D19A66', name: { en: 'Spinach' }, isTarget: false, isResolved: true },
  ];

  const lookup = buildCropLookupRows(rows, catalog);

  assert.deepEqual(lookup, [
    { crop_id: 'lettuce', crop_name: 'Lettuce', hex: '#4CAF50', is_target: true, is_resolved: true },
    { crop_id: 'crop-uuid-1', crop_name: 'Spinach', hex: '#D19A66', is_target: false, is_resolved: true },
    {
      crop_id: 'legacy,"crop"\n1',
      crop_name: 'Unknown crop (legacy,"crop"\n1)',
      hex: '#9CA3AF',
      is_target: false,
      is_resolved: false,
    },
  ]);
  assert.equal(new Set(lookup.map(crop => crop.crop_id)).size, lookup.length);
});

test('plot crop counts count overlapping season-cell rows separately and stay sparse', () => {
  const rows = [
    { plot_idx: 1, season_id: 'spring', cell_idx: 12, crop_id: 'carrot' },
    { plot_idx: 1, season_id: 'fall', cell_idx: 12, crop_id: 'carrot' },
    { plot_idx: 1, season_id: 'spring', cell_idx: 12, crop_id: 'crop-uuid-1' },
  ];

  assert.deepEqual(buildPlotCropCounts(rows), [
    { plot_idx: 1, crop_id: 'carrot', season_cell_rows: 2 },
    { plot_idx: 1, crop_id: 'crop-uuid-1', season_cell_rows: 1 },
  ]);
  assert.equal(buildPlotCropCounts([]).length, 0, 'plots with no observations add no sparse count rows');
});

test('CSV escaping preserves arbitrary crop IDs and names including CR, LF, commas, and quotes', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('id,"line\r\nnext"'), '"id,""line\r\nnext"""');
  assert.equal(csvEscape(null), '');
});

test('crop CSV tables escape text fields while leaving metadata flags numeric and boolean', () => {
  assert.equal(typeof buildCropsCsv, 'function');
  assert.equal(typeof buildPlotCropCountsCsv, 'function');
  if (typeof buildCropsCsv !== 'function' || typeof buildPlotCropCountsCsv !== 'function') return;

  const cropId = 'raw,"id"\r\nnext';
  const name = 'Other, "crop"\r\nname';
  assert.equal(buildCropsCsv([{
    crop_id: cropId,
    crop_name: name,
    hex: '#9CA3AF',
    is_target: false,
    is_resolved: false,
  }]), 'crop_id,crop_name,hex,is_target,is_resolved\n"raw,""id""\r\nnext","Other, ""crop""\r\nname",#9CA3AF,false,false\n');
  assert.equal(buildPlotCropCountsCsv([{ plot_idx: 2, crop_id: cropId, season_cell_rows: 3 }]),
    'plot_idx,crop_id,season_cell_rows\n2,"raw,""id""\r\nnext",3\n');
});

test('sample ZIP crop counts equal season-cell rows grouped by plot and crop ID', async () => {
  assert.equal(typeof buildCropsCsv, 'function');
  assert.equal(typeof buildPlotCropCountsCsv, 'function');
  if (typeof buildCropsCsv !== 'function' || typeof buildPlotCropCountsCsv !== 'function') return;

  const seasonRows = [
    { plot_idx: 4, season_id: 'spring', cell_idx: 12, crop_id: 'crop-uuid-1' },
    { plot_idx: 4, season_id: 'fall', cell_idx: 12, crop_id: 'crop-uuid-1' },
    { plot_idx: 4, season_id: 'spring', cell_idx: 13, crop_id: 'legacy-crop' },
  ];
  const crops = buildCropLookupRows(seasonRows, [
    { id: 'crop-uuid-1', hex: '#D19A66', name: { en: 'Spinach' }, isTarget: false, isResolved: true },
  ]);
  const counts = buildPlotCropCounts(seasonRows);
  const zip = new JSZip();
  zip.file('seasons.csv', 'plot_idx,season_id,cell_idx,crop_id\n' + seasonRows.map(row =>
    [row.plot_idx, row.season_id, row.cell_idx, csvEscape(row.crop_id)].join(',')).join('\n') + '\n');
  zip.file('crops.csv', buildCropsCsv(crops));
  zip.file('plot_crop_counts.csv', buildPlotCropCountsCsv(counts));

  const archiveBytes = await zip.generateAsync({ type: 'nodebuffer' });
  const archive = await JSZip.loadAsync(archiveBytes);
  const exportedSeasons = (await archive.file('seasons.csv').async('string')).trim().split('\n').slice(1);
  const exportedCounts = (await archive.file('plot_crop_counts.csv').async('string')).trim().split('\n').slice(1);
  const grouped = new Map();
  for (const row of exportedSeasons) {
    const [plotIdx, , , cropId] = row.split(',');
    const key = `${plotIdx}\u0000${cropId}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  const summarized = exportedCounts.map(row => {
    const [plotIdx, cropId, count] = row.split(',');
    return [`${plotIdx}\u0000${cropId}`, Number(count)];
  });

  assert.deepEqual(summarized, Array.from(grouped.entries()));
  assert.equal(exportedCounts.length, 2, 'a plot with zero season-cell rows contributes no count row');
  assert.equal((await archive.file('crops.csv').async('string')).includes('legacy-crop,Unknown crop (legacy-crop)'), true);
});
