# Prepare pixel classification samples

The map export supplies labels, pixel addresses, season dates, and a declared reference grid. It does not contain Sentinel-2 measurements or a fitted Random Forest. `scripts/prepare_rf_training.py` joins verified labels to one fixed stack of raster predictors and writes a table suitable for subsequent classifier fitting.

Install Python with `numpy` and `rasterio`, then unzip a current map export. Old exports without the reference-grid columns must be regenerated. Run from the repository:

```powershell
python scripts/prepare_rf_training.py --labels export/seasons.csv --metadata export/metadata.json --features features/manifest.json --output training/training.csv
```

The result is `training.csv` and `training.report.json`. Validation failures return exit code 1 before writing either artifact. If no samples remain, the error includes exclusion counts. Existing outputs are preserved on validation failure; do not mistake a previous output for a successful new run.

## Feature manifest

List only intervals retained for this training experiment. Paths resolve relative to the manifest directory, unless absolute. Dates are inclusive:

```json
{
  "reference_year": 2024,
  "rasters": [
    {
      "path": "Sentinel2_CSPlus_2024_01_H1.tif",
      "start_date": "2024-01-01",
      "end_date": "2024-01-15"
    },
    {
      "path": "Sentinel2_CSPlus_2024_01_H2.tif",
      "start_date": "2024-01-16",
      "end_date": "2024-01-31"
    }
  ]
}
```

Each multiband GeoTIFF must have unique, nonempty band descriptions such as `B3`, `B4`, `B5`, `B8`, `B11`, `NDVI`, `NDRE`, and `NDMI`. Every listed band becomes a predictor. Each column is prefixed with its interval, for example `2024-01-01_2024-01-15_B8`. All training rows share exactly these predictor columns. A longer manifest excludes seasons that cannot cover its entire stack; create a separate manifest and training experiment for another crop window.

When all five reflectance bands are present, absent indices are calculated in floating point:

| Index | Formula |
| --- | --- |
| NDVI | `(B8 - B4) / (B8 + B4)` |
| NDRE | `(B8 - B5) / (B8 + B5)` |
| NDMI | `(B8 - B11) / (B8 + B11)` |

Existing index bands are preserved. Use physically comparable reflectance inputs; ratios cancel a common multiplicative scale but do not correct additive offsets or inconsistent scaling. A nodata mask, NaN/infinite band, or zero denominator excludes that pixel from the complete predictor matrix. The script does not impute missing data.

## Spatial and temporal contracts

All rasters must exactly match `metadata.json` → `reference_grid`: CRS, affine transform, width, and height. The current reference is EPSG:32651, upper-left edge `(258690, 1841210)`, 10 m square pixels, 571 columns, and 494 rows. Pixel `(s2_row, s2_col)` is read directly, with zero-based indices. Its center is `originX + (col + 0.5) * pixelM`, `originY - (row + 0.5) * pixelM`.

Every label must use the same `grid_id`. Supplied `utm_x`/`utm_y` must agree with that center. CRS/transform/size mismatches, grid-ID mismatches, and inconsistent centers are hard failures. No automatic label resampling or nearest-pixel reassignment occurs. Prepare feature rasters on the reference grid upstream and inspect the result before running this script.

`reference_year` is the explicitly recorded year when the labeled season cycle starts. The manifest declares that same start year. `start_mmdd` and `end_mmdd` become actual dates in that year; an end earlier than the start wraps into the following year. For example, `11-01` → `02-28` with reference year 2024 means 2024-11-01 through 2025-02-28. If a source includes `year_of_season_start`, it is honored and mismatched cycles are excluded. Otherwise the explicit label `reference_year` supplies that start year. Do not infer observation years from the export timestamp.

Feature interval dates must lie in the manifest reference year or the next year. Each eligible label's single season must cover the entirety of every feature interval. A January 2024 season cannot label January 2025 imagery; a November 2024 through February 2025 season can label January 2025 imagery. Mismatched label years and season cycles are reported as exclusions.

## Labels and evaluation

`class_id` is the integer target `y`; `report.predictor_columns` defines `X`. Keep IDs and dates out of the predictor matrix. Labels must agree with `metadata.class_mapping` (`crop_id` → numeric ID). Unknown crops, nonnumeric/noninteger IDs, and mismatched IDs are excluded. The export mapping distinguishes target crops and background classes; inspect that mapping before fitting.

Only `inside_paoay=true` (or `1`) and in-bounds pixels are eligible. Same-pixel, same-class labels covering the fixed feature stack merge into one row. Verified labels with different classes that overlap each other within any retained feature interval fail the run, including a partial-season label that does not cover the full stack or a different-cycle label overlapping a wrapped season. Dates are resolved using each label's explicit year before conflict checks; different-cycle labels remain excluded from training candidates. Nonoverlapping historical seasons do not conflict. Conflicting observed field IDs also fail. Unresolved crop entries with a null class mapping are excluded as invalid classes without blocking known crop labels.

An observed `field_id` is preserved. An empty ID stays empty; a pixel/plot/season identifier is never manufactured as a field. The JSON report lists samples without field IDs, distinct fields, excluded rows, merged duplicates, predictor columns, and split availability. Fewer than two fields, or any missing field IDs, means this table cannot support valid independent field splits. Even when all IDs are present, verify field independence and class coverage before selecting train/test groups. Random pixel splits can leak neighboring field information and cannot establish field-level generalization.

Review and correct labels with domain evidence before fitting a classifier. This preparation step does not prove class truth, train a model, tune parameters, or report accuracy.

## Verification

```powershell
python -m unittest discover -s tests -p test_prepare_rf_training.py
```

Tests use temporary synthetic rasters and synthetic labels to check extraction, indices, grid mismatch rejection, complete interval coverage, year wrapping, invalid labels, conflicts, nodata, deduplication, and field preservation. These labels are test fixtures, not field observations.

The locally supplied `Sentinel2_CSPlus_2024_01_H1.tif` was inspected: EPSG:32651, the declared transform and 571 × 494 size, with descriptions B3/B4/B5/B8/B11. It includes nonfinite pixels, which the preparation script excludes. A browser-export smoke check used one explicitly synthetic QA label to confirm direct extraction at pixel row 8, column 319, center (261885, 1841125). This fixture was kept out of the live database and is not crop-reference evidence. No model accuracy claim follows from these checks.
