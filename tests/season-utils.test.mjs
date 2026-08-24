import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseMmdd,
  isValidMmdd,
  compareMmdd,
  rangeWrapsYear,
  seasonIncludesMmdd,
  shortcutRange,
  seasonsOverlap,
  cellGeometry,
  seasonExportRows,
} = require('../season-utils.js');

test('validates recurring month-day values', () => {
  assert.deepEqual(parseMmdd('06-20'), { month: 6, day: 20, ordinal: 171 });
  assert.equal(isValidMmdd('02-29'), true);
  assert.equal(isValidMmdd('02-30'), false);
  assert.equal(isValidMmdd('00-10'), false);
  assert.equal(isValidMmdd('13-01'), false);
});

test('normal and same-day ranges are inclusive', () => {
  assert.equal(compareMmdd('06-20', '07-10') < 0, true);
  assert.equal(rangeWrapsYear('06-20', '07-10'), false);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '07-10'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-21'), false);
});

test('month shortcuts produce exact month-day ranges', () => {
  assert.deepEqual(shortcutRange(2, 'whole'), { start: '02-01', end: '02-29' });
  assert.deepEqual(shortcutRange(6, 'early'), { start: '06-01', end: '06-10' });
  assert.deepEqual(shortcutRange(6, 'mid'), { start: '06-11', end: '06-20' });
  assert.deepEqual(shortcutRange(6, 'late'), { start: '06-21', end: '06-30' });
});

test('normal and wrapped date ranges can overlap without being rejected', () => {
  assert.equal(seasonsOverlap('06-20', '07-10', '07-01', '07-20'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '04-01', '04-30'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '06-01', '06-30'), false);
});

test('cell geometry derives WGS84 center and bounds from plot grid', () => {
  const plot = { latS: 10, latN: 20, lngW: 100, lngE: 110 };
  assert.deepEqual(cellGeometry(plot, 0, 50), {
    cell_row: 0,
    cell_col: 0,
    lat_s: 19.8,
    lat_n: 20,
    lng_w: 100,
    lng_e: 100.2,
    center_lat: 19.9,
    center_lng: 100.1,
  });
});

test('season export rows preserve overlapping same-crop windows per season and cell', () => {
  const plot = { latS: 10, latN: 20, lngW: 100, lngE: 110 };
  const rows = seasonExportRows({
    plotIdx: 7,
    plot,
    grid: 50,
    farmerId: 'F-001',
    plotData: {
      seasons: [
        { id: 's1', cropId: 'lettuce', start: '06-20', end: '07-10', cells: [0] },
        { id: 's2', cropId: 'lettuce', start: '11-15', end: '05-05', cells: [0] },
      ],
    },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.season_id), ['s1', 's2']);
  assert.equal(rows[1].wraps_year, true);
  assert.equal(rows[0].cell_idx, rows[1].cell_idx);
});
