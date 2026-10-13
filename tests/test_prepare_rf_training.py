"""Synthetic raster tests; no invented labels are treated as field truth."""
import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest

import numpy as np
import rasterio
from rasterio.transform import from_origin


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare_rf_training.py'


class TrainingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.grid = dict(id='test-grid', crs='EPSG:32651', originX=258690,
                         originY=1841210, pixelM=10, s2Width=3, s2Height=2)
        self.metadata = self.base / 'metadata.json'
        self.metadata.write_text(json.dumps({'reference_grid': self.grid,
                                             'class_mapping': {'carrot': 1, 'cabbage': 2}}))
        self.labels = self.base / 'seasons.csv'
        self.manifest = self.base / 'manifest.json'
        self.output = self.base / 'training.csv'

    def module(self):
        self.assertTrue(SCRIPT.exists(), 'training handoff script must exist')
        spec = importlib.util.spec_from_file_location('rf_training', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def row(self, **changes):
        row = dict(s2_row=0, s2_col=1, pixel_id='test-grid:r0:c1',
                   grid_id='test-grid', crop_id='carrot', class_id=1,
                   reference_year=2024, year_of_season_start=2024,
                   inside_paoay='true', start_mmdd='01-01', end_mmdd='06-30', field_id='')
        row.update(changes)
        return row

    def write_labels(self, rows):
        with self.labels.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def raster(self, name='features.tif', values=None, transform=None, names=None):
        names = names or ['B3', 'B4', 'B5', 'B8', 'B11']
        values = values if values is not None else np.stack([np.full((2, 3), v, dtype='float32')
                                                          for v in [2, 3, 4, 8, 5]])
        path = self.base / name
        with rasterio.open(path, 'w', driver='GTiff', width=3, height=2,
                           count=len(names), dtype='float32', crs='EPSG:32651',
                           transform=transform or from_origin(258690, 1841210, 10, 10), nodata=-9999) as ds:
            ds.write(values)
            for index, band in enumerate(names, 1):
                ds.set_band_description(index, band)
        return path

    def run_training(self, rasters=None):
        rasters = rasters or [dict(path=str(self.raster()), start_date='2024-01-01', end_date='2024-01-15')]
        self.manifest.write_text(json.dumps(dict(reference_year=2024, rasters=rasters)))
        return self.module().prepare_training(self.labels, self.metadata, self.manifest, self.output)

    def test_current_browser_export_joins_without_contract_translation(self):
        # A synthetic map observation exercises the actual JS exporter and Python reader.
        repository = SCRIPT.parent.parent
        js = """
const Export = require('./label-export.js');
const Grid = require('./grid.js');
const plot = { idx: 0, pr: 0, pc: 0, validCols: 50, validRows: 50 };
const season = { id: 'synthetic', classId: 1, start: '01-01', end: '06-30', cells: [1], referenceYear: 2024, fieldId: 'observed-fixture' };
const out = Export.buildExport({ plots: [plot], plotData: { 0: { seasons: [season, {...season, id: 'legacy', cells: [2], referenceYear: null}, {...season, id: 'other', classId: null, cells: [3], remark: 'review'}] } }, paoayPoly: [[16,120],[17,120],[17,121],[16,121]] });
process.stdout.write(JSON.stringify(out));
"""
        result = subprocess.run(['node', '-e', js], cwd=repository, text=True, capture_output=True, check=True)
        export = json.loads(result.stdout)
        self.labels.write_text(export['seasonsCsv'])
        self.metadata.write_text(export['metadataJson'])
        grid = json.loads(export['metadataJson'])['reference_grid']
        path = self.base / 'export-features.tif'
        with rasterio.open(path, 'w', driver='GTiff', width=grid['s2Width'], height=grid['s2Height'], count=1,
                           dtype='float32', crs=grid['crs'], transform=from_origin(grid['originX'], grid['originY'], grid['pixelM'], grid['pixelM'])) as ds:
            ds.write(np.full((1, grid['s2Height'], grid['s2Width']), .75, dtype='float32'))
            ds.set_band_description(1, 'NDVI')
        report = self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])
        with self.output.open() as handle:
            row = next(csv.DictReader(handle))
        self.assertEqual(row['crop_id'], 'carrot')
        self.assertEqual(row['class_id'], '1')
        self.assertEqual(row['pixel_id'], 'r0_c1')
        self.assertEqual(row['field_id'], 'observed-fixture')
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['reference_year_mismatch'], 1)
        self.assertEqual(report['exclusions']['invalid_class'], 1)

    def test_extracts_correct_pixel_indices_and_reports_missing_fields(self):
        self.write_labels([self.row(), self.row()])
        report = self.run_training()
        with self.output.open() as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['class_id'], '1')
        self.assertEqual(float(rows[0]['2024-01-01_2024-01-15_B8']), 8)
        self.assertAlmostEqual(float(rows[0]['2024-01-01_2024-01-15_NDVI']), 5 / 11)
        self.assertAlmostEqual(float(rows[0]['2024-01-01_2024-01-15_NDRE']), 1 / 3)
        self.assertAlmostEqual(float(rows[0]['2024-01-01_2024-01-15_NDMI']), 3 / 13)
        self.assertFalse(report['independent_field_splits_available'])
        self.assertEqual(report['duplicates_merged'], 1)

    def test_rejects_misalignment_before_writing_outputs(self):
        self.write_labels([self.row()])
        path = self.raster(transform=from_origin(258691, 1841210, 10, 10))
        with self.assertRaisesRegex(ValueError, 'align'):
            self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])
        self.assertFalse(self.output.exists())
        self.assertFalse(self.output.with_suffix('.report.json').exists())

    def test_excludes_nodata_nonfinite_outside_and_wrong_year(self):
        rows = [self.row(s2_col=0), self.row(s2_col=2), self.row(inside_paoay='false'),
                self.row(reference_year=2023), self.row(field_id='field-A')]
        self.write_labels(rows)
        values = np.stack([np.full((2, 3), v, dtype='float32') for v in [2, 3, 4, 8, 5]])
        values[0, 0, 0] = -9999
        values[1, 0, 2] = np.nan
        path = self.raster(values=values)
        report = self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['missing_predictor'], 2)
        self.assertEqual(report['exclusions']['reference_year_mismatch'], 1)
        self.assertFalse(report['independent_field_splits_available'], 'one field cannot support independent split')

    def test_conflicting_classes_fail_without_output(self):
        self.write_labels([self.row(), self.row(crop_id='cabbage', class_id=2)])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.run_training()
        self.assertFalse(self.output.exists())

    def test_partial_window_conflicting_label_rejects_full_window_candidate(self):
        self.write_labels([self.row(), self.row(crop_id='cabbage', class_id=2, end_mmdd='01-10')])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.run_training()
        self.assertFalse(self.output.exists())

    def test_nonoverlapping_seasons_do_not_conflict(self):
        self.write_labels([self.row(end_mmdd='01-15'),
                           self.row(crop_id='cabbage', class_id=2, start_mmdd='01-16')])
        report = self.run_training()
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['feature_window_outside_season'], 1)

    def test_crossyear_verified_conflict_is_checked_before_cycle_exclusion(self):
        self.write_labels([
            self.row(start_mmdd='11-01', end_mmdd='02-28'),
            self.row(crop_id='cabbage', class_id=2, reference_year=2025,
                     year_of_season_start=2025, start_mmdd='01-01', end_mmdd='03-31')])
        path = self.raster()
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.run_training([dict(path=str(path), start_date='2025-01-01', end_date='2025-01-15')])
        self.assertFalse(self.output.exists())

    def test_historical_nonoverlapping_labels_are_only_excluded(self):
        self.write_labels([
            self.row(), self.row(crop_id='cabbage', class_id=2,
                                 reference_year=2023, year_of_season_start=2023)])
        report = self.run_training()
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['reference_year_mismatch'], 1)

    def test_unresolved_mapping_does_not_block_known_crop_labels(self):
        self.metadata.write_text(json.dumps({'reference_grid': self.grid,
                                             'class_mapping': {'carrot': 1, 'unknown': None}}))
        self.write_labels([self.row(), self.row(s2_col=2, crop_id='unknown', class_id='')])
        report = self.run_training()
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['invalid_class'], 1)

    def test_all_intervals_must_fit_one_explicit_season(self):
        self.write_labels([self.row(end_mmdd='01-10'), self.row(s2_col=2)])
        report = self.run_training()
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['feature_window_outside_season'], 1)

    def test_wrap_season_uses_start_year_and_next_year_intervals(self):
        self.write_labels([self.row(start_mmdd='11-01', end_mmdd='02-28'),
                           self.row(s2_col=2, start_mmdd='11-01', end_mmdd='02-28', year_of_season_start=2023)])
        path = self.raster()
        report = self.run_training([dict(path=str(path), start_date='2025-01-01', end_date='2025-01-15')])
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['season_cycle_mismatch'], 1)

    def test_rejects_feature_year_outside_cycle(self):
        self.write_labels([self.row()])
        path = self.raster()
        with self.assertRaisesRegex(ValueError, 'year'):
            self.run_training([dict(path=str(path), start_date='2023-01-01', end_date='2023-01-15')])

    def test_invalid_classes_grid_bounds_and_zero_denominator_excluded(self):
        self.write_labels([self.row(class_id='no'), self.row(crop_id='unknown'),
                           self.row(s2_col=3), self.row(s2_col=0), self.row(s2_col=2)])
        values = np.stack([np.full((2, 3), v, dtype='float32') for v in [2, 3, 4, 8, 5]])
        values[3, 0, 0] = -3
        path = self.raster(values=values)
        report = self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])
        self.assertEqual(report['samples_written'], 1)
        self.assertEqual(report['exclusions']['invalid_class'], 2)
        self.assertEqual(report['exclusions']['out_of_bounds'], 1)
        self.assertEqual(report['exclusions']['missing_predictor'], 1)

    def test_rejects_duplicate_band_names(self):
        self.write_labels([self.row()])
        path = self.raster(names=['B3', 'B4', 'B5', 'B8', 'B8'])
        with self.assertRaisesRegex(ValueError, 'band'):
            self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])

    def test_grid_id_and_declared_centers_must_match(self):
        self.write_labels([self.row(grid_id='old-grid')])
        with self.assertRaisesRegex(ValueError, 'grid_id'):
            self.run_training()
        self.write_labels([self.row(utm_x=258700, utm_y=1841205)])
        with self.assertRaisesRegex(ValueError, 'center'):
            self.run_training()
        self.write_labels([self.row(utm_x=258705, utm_y=1841205)])
        self.assertEqual(self.run_training()['samples_written'], 1)

    def test_preserves_observed_fields_and_fixed_multi_interval_columns(self):
        self.write_labels([self.row(field_id='field-A'), self.row(s2_col=2, field_id='field-B')])
        path = self.raster()
        report = self.run_training([
            dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15'),
            dict(path=str(path), start_date='2024-01-16', end_date='2024-01-31')])
        self.assertTrue(report['independent_field_splits_available'])
        self.assertEqual(len(report['predictor_columns']), 16)
        with self.output.open() as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual([row['field_id'] for row in rows], ['field-A', 'field-B'])

    def test_second_raster_size_and_crs_must_match(self):
        self.write_labels([self.row()])
        good = self.raster()
        bad = self.base / 'wrong-crs.tif'
        with rasterio.open(bad, 'w', driver='GTiff', width=3, height=2, count=1,
                           dtype='float32', crs='EPSG:32650',
                           transform=from_origin(258690, 1841210, 10, 10)) as ds:
            ds.write(np.ones((1, 2, 3), dtype='float32'))
            ds.set_band_description(1, 'NDVI')
        with self.assertRaisesRegex(ValueError, 'alignment'):
            self.run_training([
                dict(path=str(good), start_date='2024-01-01', end_date='2024-01-15'),
                dict(path=str(bad), start_date='2024-01-16', end_date='2024-01-31')])

    def test_zero_samples_fails_and_existing_indices_are_preserved(self):
        self.write_labels([self.row(inside_paoay='false')])
        with self.assertRaisesRegex(ValueError, 'eligible'):
            self.run_training()
        self.assertFalse(self.output.exists())
        self.write_labels([self.row()])
        path = self.raster(names=['NDVI'], values=np.full((1, 2, 3), .75, dtype='float32'))
        self.run_training([dict(path=str(path), start_date='2024-01-01', end_date='2024-01-15')])
        with self.output.open() as handle:
            row = next(csv.DictReader(handle))
        self.assertEqual(float(row['2024-01-01_2024-01-15_NDVI']), .75)


if __name__ == '__main__':
    unittest.main()
