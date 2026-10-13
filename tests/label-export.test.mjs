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
  assert.equal(rows[0], 'plot_idx,season_id,field_id,class_id,class_name,crop_name,remark,start_mmdd,end_mmdd,wraps_year,s2_row,s2_col,utm_x,utm_y,center_lat,center_lng');
  assert.equal(rows.length, 1 + 4);
  assert.match(rows[1], /^0,p0\|2\|\|03-01\|06-30\|,F0001,2,Cabbage,,,03-01,06-30,false,0,0,258695,1841205,16\.64/);
  const lettuce = rows.find(r => r.includes('Lettuce'));
  assert.match(lettuce, /,4,Other cultivated,Lettuce,,11-15,02-10,true,2,0,/);
  const other = rows.find(r => r.includes('Weeds'));
  assert.match(other, /,,Other,,Weeds,05-01,05-30,false,0,2,/);
});

test('fields.csv lists one row per field', () => {
  const out = LabelExport.buildExport({ plots: [plot0], plotData, catalog, grid: GRID });
  const rows = lines(out.fieldsCsv);
  assert.equal(rows[0], 'field_id,class_id,class_name,crop_name,remark,start_mmdd,end_mmdd,wraps_year,cell_count,plot_idxs');
  assert.equal(rows[1], 'F0001,2,Cabbage,,,03-01,06-30,false,2,0');
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
