#!/usr/bin/env python3
"""Join pixel labels to an exactly aligned, fixed raster stack.

Labels are recurring crop calendars (MM-DD ranges with no year): an expert's
"potato 05-01..07-31" holds every year, so each label is applied to the
feature manifest's reference_year.
"""
import argparse
import calendar
from collections import Counter
import csv
from datetime import date
from contextlib import ExitStack
import json
import math
from pathlib import Path
import sys
import tempfile

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window


def integer(value):
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError('expected finite integer')
    return int(number)


def calendar_date(year, month, day):
    # A recurring Feb 29 falls on Feb 28 in common years.
    if (month, day) == (2, 29) and not calendar.isleap(year):
        day = 28
    return date(year, month, day)


def season_dates(row, start_year):
    start_parts = [int(part) for part in row['start_mmdd'].split('-')]
    end_parts = [int(part) for part in row['end_mmdd'].split('-')]
    if len(start_parts) != 2 or len(end_parts) != 2:
        raise ValueError('expected MM-DD')
    start = calendar_date(start_year, *start_parts)
    end = calendar_date(start_year + (tuple(end_parts) < tuple(start_parts)), *end_parts)
    return start, end


def season_occurrences(row, year):
    """Every dated occurrence of a recurring label that can touch the year's cycle."""
    return [season_dates(row, start_year) for start_year in (year - 1, year, year + 1)]


def prepare_training(labels, metadata, features, output):
    labels, metadata, features, output = map(Path, (labels, metadata, features, output))
    meta = json.loads(metadata.read_text(encoding='utf-8-sig'))
    manifest = json.loads(features.read_text(encoding='utf-8-sig'))
    grid = meta['reference_grid']
    classes = meta['class_mapping']
    if isinstance(classes, list):
        classes = {item['crop_id']: item['class_id'] for item in classes}
    # Unresolved crop placeholders are intentionally not trainable classes.
    classes = {crop: integer(value) for crop, value in classes.items() if value is not None}
    year = integer(manifest['reference_year'])
    expected_transform = from_origin(grid['originX'], grid['originY'], grid['pixelM'], grid['pixelM'])
    expected_crs = rasterio.crs.CRS.from_user_input(grid['crs'])
    if not manifest.get('rasters'):
        raise ValueError('Feature manifest must contain retained rasters')
    report = dict(reference_year=year, grid_id=grid['id'], input_rows=0,
                  samples_written=0, duplicates_merged=0, exclusions={},
                  predictor_columns=[], independent_field_splits_available=False)
    exclusions = Counter()
    intervals = []
    predictors = []
    with ExitStack() as stack:
        for entry in manifest['rasters']:
            start, end = date.fromisoformat(entry['start_date']), date.fromisoformat(entry['end_date'])
            if start > end or start.year not in (year, year + 1) or end.year not in (year, year + 1):
                raise ValueError('Feature interval year must belong to the declared reference year cycle')
            path = Path(entry['path'])
            if not path.is_absolute():
                path = features.parent / path
            ds = stack.enter_context(rasterio.open(path))
            if (ds.crs != expected_crs or ds.transform != expected_transform
                    or ds.width != grid['s2Width'] or ds.height != grid['s2Height']):
                raise ValueError(f'Raster alignment mismatch: {path}; resampling labels is forbidden')
            bands = [str(name).strip() if name else '' for name in ds.descriptions]
            if not all(bands) or len(set(bands)) != len(bands):
                raise ValueError(f'Raster requires unique, nonempty band descriptions: {path}')
            derived = []
            if set(['B3', 'B4', 'B5', 'B8', 'B11']).issubset(bands):
                derived = [name for name in ('NDVI', 'NDRE', 'NDMI') if name not in bands]
            prefix = f'{start.isoformat()}_{end.isoformat()}_'
            columns = [prefix + name for name in bands + derived]
            if set(columns).intersection(predictors):
                raise ValueError('Duplicate interval predictor columns in feature stack')
            predictors.extend(columns)
            intervals.append((start, end, ds, bands, derived))

        with labels.open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.DictReader(handle)
            required = {'s2_row', 's2_col', 'grid_id', 'crop_id', 'class_id',
                        'inside_paoay', 'start_mmdd', 'end_mmdd'}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError('Labels missing required columns: ' + ', '.join(sorted(required - set(reader.fieldnames or []))))
            candidates = {}
            observations = {}
            for row in reader:
                report['input_rows'] += 1
                if row['inside_paoay'].strip().lower() not in ('true', '1'):
                    exclusions['outside_paoay'] += 1
                    continue
                if row['grid_id'] != grid['id']:
                    raise ValueError('Label grid_id does not match reference grid')
                try:
                    class_id = integer(row['class_id'])
                    if row['crop_id'] not in classes or classes[row['crop_id']] != class_id:
                        raise ValueError('unknown class')
                except (ValueError, TypeError):
                    exclusions['invalid_class'] += 1
                    continue
                try:
                    r, c = integer(row['s2_row']), integer(row['s2_col'])
                    if not (0 <= r < grid['s2Height'] and 0 <= c < grid['s2Width']):
                        raise ValueError('outside grid')
                except (ValueError, TypeError):
                    exclusions['out_of_bounds'] += 1
                    continue
                for key, expected in [('utm_x', grid['originX'] + (c + .5) * grid['pixelM']),
                                      ('utm_y', grid['originY'] - (r + .5) * grid['pixelM'])]:
                    if key in row:
                        try:
                            actual = float(row[key])
                        except (ValueError, TypeError):
                            raise ValueError(f'Invalid label {key} center') from None
                        if not math.isfinite(actual) or abs(actual - expected) > 1e-6:
                            raise ValueError(f'Label {key} center does not align with pixel row/column')
                try:
                    occurrences = season_occurrences(row, year)
                except (ValueError, TypeError):
                    exclusions['invalid_season_dates'] += 1
                    continue
                key = (r, c)
                # Even a partial label can contradict the class of a complete
                # candidate. Check calendar overlaps before eligibility.
                previous_observations = observations.setdefault(key, [])
                for previous_class, previous_occurrences in previous_observations:
                    if previous_class != class_id and any(
                            max(season_start, previous_start, start) <= min(season_end, previous_end, end)
                            for season_start, season_end in occurrences
                            for previous_start, previous_end in previous_occurrences
                            for start, end, *_ in intervals):
                        raise ValueError(f'Class conflict at pixel row {r}, column {c} within retained feature intervals')
                previous_observations.append((class_id, occurrences))
                covering = [(season_start, season_end) for season_start, season_end in occurrences
                            if all(season_start <= start <= end <= season_end for start, end, *_ in intervals)]
                if not covering:
                    exclusions['feature_window_outside_season'] += 1
                    continue
                season_start = covering[0][0]
                if key in candidates:
                    previous = candidates[key]
                    if previous['class_id'] != class_id:
                        raise ValueError(f'Class conflict at pixel row {r}, column {c} for retained feature stack')
                    old_field, new_field = previous['field_id'], row.get('field_id', '').strip()
                    if old_field and new_field and old_field != new_field:
                        raise ValueError(f'Conflicting field_id at pixel row {r}, column {c}')
                    previous['field_id'] = old_field or new_field
                    report['duplicates_merged'] += 1
                    continue
                sample = dict(pixel_id=row.get('pixel_id', ''), grid_id=grid['id'], s2_row=r,
                              s2_col=c, crop_id=row['crop_id'], class_id=class_id,
                              reference_year=year, year_of_season_start=season_start.year,
                              field_id=row.get('field_id', '').strip())
                candidates[key] = sample

        samples = []
        for (r, c), sample in candidates.items():
            values = []
            valid = True
            for start, end, ds, bands, derived in intervals:
                pixel = ds.read(window=Window(c, r, 1, 1), masked=True)[:, 0, 0]
                if np.any(np.ma.getmaskarray(pixel)) or not np.all(np.isfinite(pixel.data)):
                    valid = False
                    break
                raw = dict(zip(bands, map(float, pixel.data)))
                values.extend(raw.values())
                for name in derived:
                    low = {'NDVI': 'B4', 'NDRE': 'B5', 'NDMI': 'B11'}[name]
                    denominator = raw['B8'] + raw[low]
                    if denominator == 0:
                        valid = False
                        break
                    value = (raw['B8'] - raw[low]) / denominator
                    if not math.isfinite(value):
                        valid = False
                        break
                    values.append(value)
                if not valid:
                    break
            if not valid:
                exclusions['missing_predictor'] += 1
                continue
            sample.update(zip(predictors, values))
            samples.append(sample)

    if not samples:
        raise ValueError('No eligible samples remain; exclusions: ' + json.dumps(dict(exclusions), sort_keys=True))
    report['samples_written'] = len(samples)
    report['exclusions'] = dict(sorted(exclusions.items()))
    report['predictor_columns'] = predictors
    report['samples_without_field_id'] = sum(not row['field_id'] for row in samples)
    fields = sorted({row['field_id'] for row in samples if row['field_id']})
    report['distinct_field_ids'] = len(fields)
    report['independent_field_splits_available'] = report['samples_without_field_id'] == 0 and len(fields) >= 2
    report['evaluation_note'] = ('Field IDs permit group splits; verify class coverage and field independence before evaluation.'
                                 if report['independent_field_splits_available'] else
                                 'No valid independent field split for this table. Collect observed field IDs; do not invent IDs or use random pixel splits to claim accuracy.')
    columns = list(samples[0])
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path = output.with_suffix('.report.json')
    if output == report_path:
        raise ValueError('Output CSV must have a filename distinct from its report')
    # Stage both complete artifacts only after all validation succeeds.
    staged = []
    try:
        with tempfile.NamedTemporaryFile(mode='w', newline='', encoding='utf-8', dir=output.parent, delete=False) as handle:
            staged.append(Path(handle.name))
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(samples)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent, delete=False) as handle:
            staged.append(Path(handle.name))
            json.dump(report, handle, indent=2)
            handle.write('\n')
        staged[0].replace(output)
        staged[1].replace(report_path)
    finally:
        for path in staged:
            path.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('labels', 'metadata', 'features', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        report = prepare_training(args.labels, args.metadata, args.features, args.output)
    except (ValueError, KeyError, OSError, rasterio.errors.RasterioError) as error:
        print(f'Training preparation failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
