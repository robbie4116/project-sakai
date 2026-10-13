# Sentinel-2 grid alignment fix

User authorized implementation after the measured grid review. This executes the
grid and export portion of the existing labeling foundation design, without its
unrelated destructive database reset or concurrent editing redesign.

- [x] Add tested UTM grid math matching the actual reference TIFF: EPSG:32651,
  10 m pixels, origin (258690, 1841210), 571 columns, 494 rows.
- [x] Generate 120 plots with exact projected corners and partial edge sizes;
  reproject labeling imagery into the same UTM squares.
- [x] Wire the overview polygons, canvas, bounds, hit testing, and export to this
  grid. Disable out-of-raster cells and carry Paoay membership in export.
- [x] Version local, native and remote storage so legacy plot indices cannot hydrate or
  overwrite the new grid. Preserve old browser storage and remote records.
- [x] Export stable pixel IDs, UTM geometry, numeric training classes and grid
  metadata. Provide a tested Python preparation command that checks feature
  raster alignment, temporal year, nodata, boundary, and conflicting labels,
  then emits a feature/label CSV for Random Forest.
- [x] Run regression tests, compare coordinates against rasterio/pyproj and the
  actual reference raster, inspect the browser, review changes, clean tooling.

Date selectors remain MM-DD; each painted season now also records an explicitly
chosen crop-cycle start year. The preparation command requires a dated feature stack.
Grid tiles must not be presented as observed agricultural fields or independent
validation plots. Labels still require verified crop identity and temporal matching.

Verification: 208 Node tests and 23 Python tests passed. Actual reference TIFF
matched all grid constants; all 282074 pixels covered once. Browser painting,
partial edge rejection, conflict checks, mobile/tablet hit testing, ZIP export
and direct predictor extraction from the supplied TIFF passed using synthetic
QA labels. Review blockers (partial/cross-year conflicts, unresolved mapping,
legacy native backup preservation) were reproduced and fixed with regressions.
Temporary browser/server were closed; existing shared Playwright MCP service
processes were retained. No live ground-truth rows were written during QA.

Premerge review found the connected database already runs the per-season
foundation schema (read-only GET confirmed `plots.seasons` is absent). The
adapter now uses a separate `s2_label_plots` table; owner must apply the additive
`docs/supabase-s2-labels.sql` BEFORE merge. Embedded PostgreSQL tests verified
repeatable migration, RPC behavior, RLS, and preservation of other datasets.
Year-aware views and erase now preserve observations from other crop cycles.

Migration applied on 2026-10-13 through the owner's authenticated Supabase SQL
Editor for project `nlsdcubmrjxpkdyaguqb` (sakai). The transaction returned
success. Read-only catalog checks confirmed the label table, RLS, validation
trigger, anonymous app table privileges, crop RPC execute privilege and existing
legacy tables. A read-only REST request using the app's configured connection
returned HTTP 200 for all expected columns. No synthetic labels were written
to the live project. The database migration prerequisite is satisfied; Git merge
and deployment had not yet been performed at that checkpoint.

Merge reconciliation: origin/main added the class picker and atomic per-season
foundation while this work was being reviewed. The combined app preserves that
foundation and its existing RPC. Observed years and field IDs roundtrip through
versioned season IDs; no additional foundation schema migration is needed.
The applied s2_label_plots migration remains additive compatibility storage;
the active app uses public.seasons rather than the older JSON save adapter.
Undated legacy annotations remain exportable for review, are excluded from
training, and do not prevent new dated observations. Schedule summaries display
each observation's year, including an explicit Undated label.
