import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const LabelExport = require('../label-export.js');

const LETTUCE = '11111111-1111-4111-8111-111111111111';
const catalog = {
  byId: id => (id === LETTUCE ? { id, hex: '#22C55E', name: { en: 'Lettuce' } } : null),
  all: () => [{ id: LETTUCE, hex: '#22C55E', name: { en: 'Lettuce' } }],
};
const plot0 = {
  idx: 0, pr: 0, pc: 0, validCols: 50, validRows: 50,
  corners: [[16.64103485, 120.73772837], [16.6410859, 120.74241321], [16.63656949, 120.74246609], [16.63651846, 120.73778136]],
};
const plotData = {
  0: {
    note: 'near road, "north"',
    photos: [{ url: 'https://x/y.jpg' }],
    seasons: [
      { id: 'p0|2||03-01|06-30|', classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells: [0, 1] },
      { id: `p0|4|${LETTUCE}|11-15|02-10|`, classId: 4, cropId: LETTUCE, remark: '', start: '11-15', end: '02-10', cells: [100] },
      { id: 'p0|other||05-01|05-30|weeds', classId: null, cropId: null, remark: 'Weeds', start: '05-01', end: '05-30', cells: [2] },
    ],
  },
};
const GRID = { crs: 'EPSG:32651', originX: 258690, originY: 1841210, pixelM: 10, s2Width: 571, s2Height: 494, cells: 50, plotCols: 12, plotRows: 10 };

const lines = csv => csv.trim().split('\n');

test('seasons.csv has the spec columns and one row per season x cell', () => {
  const out = LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID, exportedAt: '2026-10-13T00:00:00Z' });
  const rows = lines(out.seasonsCsv);
  assert.match(rows[0], /component_id/);
  assert.equal(rows.length, 1 + 4);
  assert.match(rows[1], /^0,p0\|2\|\|03-01\|06-30\|,,2,Cabbage,,,03-01,06-30,false,0,0,258695,1841205,16\.64/);
  const lettuce = rows.find(r => r.includes('Lettuce'));
  assert.match(lettuce, /,4,Other cultivated,Lettuce,,11-15,02-10,true,2,0,/);
  const other = rows.find(r => r.includes('Weeds'));
  assert.match(other, /,,Other,,Weeds,05-01,05-30,false,0,2,/);
});

test('fields.csv lists one row per field', () => {
  const out = LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID });
  const rows = lines(out.fieldsCsv);
  assert.match(rows[0], /component_id/);
  assert.match(rows[1], /^,2,Cabbage,,,03-01,06-30,false,2,0,F0001,/);
  assert.equal(rows.length, 1 + 3);
});

test('classes.csv lists the nine classes then class-4 crop names', () => {
  const rows = lines(LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID }).classesCsv);
  assert.equal(rows[0], 'class_id,key,class_name,hex');
  assert.equal(rows[1], '1,carrot,Carrot,#FF6A1F');
  assert.equal(rows[9], ',other,Other,#F472B6');
  assert.equal(rows[10], `4,crop:${LETTUCE},Lettuce,#22C55E`);
});

test('plots.csv has per-class cell counts and no farmer columns', () => {
  const rows = lines(LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID }).plotsCsv);
  assert.equal(rows[0], 'plot_idx,plot_row,plot_col,valid_cols,valid_rows,note,photo_count,season_count,class_1_cells,class_2_cells,class_3_cells,class_4_cells,class_5_cells,class_6_cells,class_7_cells,class_8_cells,other_cells');
  assert.equal(rows[1], '0,0,0,50,50,"near road, ""north""",1,3,0,2,0,1,0,0,0,0,1');
});

test('metadata records the grid and nothing mentions farmers', () => {
  const out = LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID, exportedAt: '2026-10-13T00:00:00Z' });
  const meta = JSON.parse(out.metadataJson);
  assert.equal(meta.schema_version, 6);
  assert.deepEqual(meta.grid, GRID);
  assert.equal(meta.authoritative_ground_truth_file, 'seasons.csv');
  const everything = out.seasonsCsv + out.fieldsCsv + out.classesCsv + out.plotsCsv + out.metadataJson;
  assert.doesNotMatch(everything, /farmer/i);
});

const records = text => {
  const [header, ...rows] = lines(text).map(line => line.split(','));
  return rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
};
const mask = [[16, 120], [17, 120], [17, 121], [16, 121]];
test('RF contract exports explicit years, observed fields, mapping and exact pixel geometry', () => {
  const data = structuredClone(plotData);
  data[0].seasons[0].referenceYear = 2024;
  data[0].seasons[0].fieldId = 'observed-A';
  const out = LabelExport.buildExport({ plots: [plot0], plotData: data, catalog, grid: GRID, paoayPoly: mask });
  const rows = records(out.seasonsCsv);
  const meta = JSON.parse(out.metadataJson);
  assert.equal(rows[0].reference_year, '2024');
  assert.equal(rows[0].field_id, 'observed-A');
  assert.equal(rows[0].component_id, 'F0001');
  assert.equal(rows[0].crop_id, 'cabbage');
  assert.equal(rows[0].inside_paoay, 'true');
  assert.equal(rows[0].grid_id, meta.reference_grid.id);
  assert.equal(rows[0].pixel_id, 'r0_c0');
  assert.equal(rows[0].utm_x, '258695');
  assert.equal(rows[0].utm_y, '1841205');
  assert.equal(rows[2].field_id, '');
  assert.equal(rows[2].reference_year, '');
  assert.equal(rows[2].crop_id, LETTUCE);
  assert.equal(rows[3].crop_id, '');
  assert.equal(meta.class_mapping.cabbage, 2);
  assert.equal(meta.class_mapping[LETTUCE], 4);
  assert.equal(meta.class_mapping.grass_shrub, 8);
  assert.equal(meta.class_mapping.other, null);
  for (const key of ['crs', 'originX', 'originY', 'pixelM', 's2Width', 's2Height']) assert.equal(meta.reference_grid[key], GRID[key]);
});
test('absent boundary fails closed; unresolved crop UUIDs never gain a training mapping', () => {
  const unresolved = { byId: catalog.byId, all: () => [{ id: LETTUCE, isResolved: false, name: { en: 'Unresolved' }, hex: '#22C55E' }] };
  const out = LabelExport.buildExport({ plots: [plot0], plotData, catalog: unresolved, grid: GRID });
  assert.ok(records(out.seasonsCsv).every(row => row.inside_paoay === 'false'));
  assert.equal(JSON.parse(out.metadataJson).class_mapping[LETTUCE], undefined);
});
