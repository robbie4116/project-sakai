# Labeling Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Taniman labeling app so that each label cell is exactly one Sentinel-2 pixel. Labels become land-cover classes (8 classes plus "Other"), painting can never silently produce an all-year crop label, the export carries class IDs, field IDs and pixel coordinates, and two people editing at once can't erase each other's work.

**Spec:** `docs/superpowers/specs/2026-10-13-labeling-foundation-design.md`. Read it first. Section numbers below (§1–§10) refer to it.

**Architecture:** The app stays a static vanilla-JS site on Vercel. All new logic goes into small, pure modules that use the same UMD pattern as `season-utils.js`: `window.X` in the browser, `module.exports` in Node. Each module is unit-tested with `node --test`.

`app.js` and `calendar.js` are then rewired to use these modules. Supabase changes from one `plots` row per plot to one row per season, written through an atomic `apply_season_cells` RPC. A one-time Python script builds the 120-plot UTM grid and renders sharp plot images from Esri.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4, Supabase (Postgres plus supabase-js v2), Node 18+ built-in test runner, and Python 3 (rasterio, pyproj, numpy, Pillow, requests, pytest).

---

## Before you start

- **Run tests:** `node --test tests/*.test.mjs` from the repo root. JS tests are `tests/*.test.mjs` and load browser modules with `createRequire`. Python tests: `python -m pytest tests/test_plot_grid.py -v`.
- **Run the app locally:** `python -m http.server 8080`, then open `http://localhost:8080/taniman.html`.
- **Commits:** commit after every task, with messages like `feat: ...`, `fix: ...`, `test: ...` or `docs: ...`.
- **Supabase:** you **cannot** run SQL against the project; only the repo owner has access. Chunk 1 writes `docs/supabase-foundation.sql`, and the owner runs it when the new version deploys (Task 22). Until then the deployed site keeps the old schema, so don't merge app changes to `main` before the owner is ready. Work on a branch.
- **No local `.tif` files are needed.** The Sentinel-2 grid constants are hardcoded (§1).
- **Out of scope:** the Tauri desktop build (`src-tauri/`, `offline-storage.js`, `tiles/map`, `tiles/context`) is not updated. It will be stale, and that has been accepted (§ Non-goals). Keep any `window.__TAURI__` guards so the code doesn't crash there, but don't spend time making Tauri work.

## File map

| File | Status | Responsibility |
|---|---|---|
| `plot_grid.py` | create | Pure Python grid math: plot origins, valid sizes, WGS84 corners |
| `generate_plots.py` | create | One-time script: renders `tiles/plots/plot_NNN.jpg` from Esri and writes the `data.js` generated block |
| `tests/test_plot_grid.py` | create | pytest for `plot_grid.py` |
| `grid.js` | create | `TANIMAN_GRID`: cell ↔ Sentinel-2 row/col, UTM, lat/lng interpolation, out-of-bounds checks |
| `classes.js` | create | `TANIMAN_CLASSES`: the 9 classes, selection rules, season key/ID, colors |
| `season-outbox.js` | create | `TANIMAN_OUTBOX`: coalescing per-season delta queue, undo diffs, merge of remote seasons, error classification |
| `field-ids.js` | create | `TANIMAN_FIELDS`: connected-component field IDs across plots |
| `label-export.js` | create | `TANIMAN_LABEL_EXPORT`: builds seasons.csv, fields.csv, classes.csv, plots.csv and metadata |
| `class-picker.js` | create | `TANIMAN_CLASS_PICKER`: class buttons plus the "Other" remark input |
| `docs/supabase-foundation.sql` | create | Destructive schema reset the owner runs once |
| `supabase-sync.js` | rewrite | Season/plot/crop network calls only |
| `crop-catalog.js` | modify | Class-4 crop names: bare UUID ids, new reserved names |
| `crop-picker.js` | modify | Hide the empty target group |
| `calendar.js` | modify | Dates can be empty; readout follows the selection status |
| `app.js` | modify | Wires everything together and removes farmers, zones and plot-row sync |
| `taniman.html`, `styles.css`, `data.js` | modify | Markup, strings and generated grid block |
| `crop-export.js` | delete | Replaced by `label-export.js` |
| `docs/supabase-setup.sql`, `docs/supabase-add-crops.sql` | delete | Replaced by `docs/supabase-foundation.sql` |
| `README.md`, `requirements-dev.txt`, `.gitignore`, `src-tauri/scripts/prepare-dist.mjs` | modify | Docs and housekeeping |

---

## Chunk 1: Grid, imagery and database schema

### Task 1: Housekeeping

**Files:**
- Modify: `.gitignore`
- Modify: `requirements-dev.txt`

- [ ] **Step 1: Ignore all rasters and the tile cache.** Append this to `.gitignore`:

```gitignore

# Any local raster (Sentinel-2 composites etc.) and the Esri tile cache
*.tif
*.tif.aux.xml
.tile-cache/
.pytest_cache/
```

- [ ] **Step 2: Replace `requirements-dev.txt`** with:

```text
rasterio
Pillow
numpy
pyproj
requests
pytest
```

- [ ] **Step 3: Install and check**

Run: `pip install -r requirements-dev.txt && python -c "import rasterio, pyproj, requests, pytest; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .gitignore requirements-dev.txt
git commit -m "chore: ignore rasters and add plot generator dependencies"
```

### Task 2: Python grid math (`plot_grid.py`)

**Files:**
- Create: `plot_grid.py`
- Test: `tests/test_plot_grid.py`

The reference values below were computed with rasterio/pyproj from the real grid (EPSG:32651 → EPSG:4326).

- [ ] **Step 1: Write the failing test** in `tests/test_plot_grid.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import plot_grid


def test_grid_has_120_plots_in_12_columns():
    plots = plot_grid.build_plots()
    assert plot_grid.PLOT_COLS == 12
    assert plot_grid.PLOT_ROWS == 10
    assert len(plots) == 120
    assert [p["idx"] for p in plots] == list(range(120))


def test_plot_origins_follow_the_sentinel2_grid():
    assert plot_grid.plot_origin(0) == (258690, 1841210)
    assert plot_grid.plot_origin(13) == (259190, 1840710)
    assert plot_grid.plot_origin(119) == (264190, 1836710)


def test_partial_plots_on_the_last_column_and_row():
    assert plot_grid.valid_size(0) == (50, 50)
    assert plot_grid.valid_size(11) == (21, 50)
    assert plot_grid.valid_size(108) == (50, 44)
    assert plot_grid.valid_size(119) == (21, 44)


def test_plot_record_shape_and_corners():
    plot = plot_grid.build_plots()[0]
    assert plot["pr"] == 0 and plot["pc"] == 0
    assert plot["utmX0"] == 258690 and plot["utmY0"] == 1841210
    assert plot["tilePath"] == "tiles/plots/plot_000.jpg?v=s2"
    nw, ne, se, sw = plot["corners"]
    assert nw == pytest.approx([16.64103485, 120.73772837], abs=1e-7)
    assert ne == pytest.approx([16.6410859, 120.74241321], abs=1e-7)
    assert se == pytest.approx([16.63656949, 120.74246609], abs=1e-7)
    assert sw == pytest.approx([16.63651846, 120.73778136], abs=1e-7)


def test_grid_constants_for_data_js():
    assert plot_grid.grid_constants() == {
        "crs": "EPSG:32651",
        "originX": 258690,
        "originY": 1841210,
        "pixelM": 10,
        "s2Width": 571,
        "s2Height": 494,
        "cells": 50,
        "plotCols": 12,
        "plotRows": 10,
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_plot_grid.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'plot_grid'`

- [ ] **Step 3: Write `plot_grid.py`**

```python
"""Sentinel-2 aligned plot grid math (pure; no network or file I/O).

The constants come from the training composite Sentinel2_CSPlus_2024_01_H1.tif
(read 2026-10-13): EPSG:32651, 10 m pixels, origin (258690, 1841210), 571 x 494.
One label cell equals one Sentinel-2 pixel.
"""
from pyproj import Transformer

CRS = "EPSG:32651"
ORIGIN_X = 258690
ORIGIN_Y = 1841210
PIXEL_M = 10
S2_WIDTH = 571
S2_HEIGHT = 494
CELLS = 50
PLOT_M = CELLS * PIXEL_M
PLOT_COLS = -(-S2_WIDTH // CELLS)
PLOT_ROWS = -(-S2_HEIGHT // CELLS)

_TO_WGS84 = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


def plot_origin(idx: int) -> tuple[int, int]:
    """Top-left UTM corner of a plot."""
    pr, pc = divmod(idx, PLOT_COLS)
    return ORIGIN_X + pc * PLOT_M, ORIGIN_Y - pr * PLOT_M


def valid_size(idx: int) -> tuple[int, int]:
    """(valid columns, valid rows) of a plot; the last column and row are partial."""
    pr, pc = divmod(idx, PLOT_COLS)
    return min(CELLS, S2_WIDTH - pc * CELLS), min(CELLS, S2_HEIGHT - pr * CELLS)


def utm_to_latlng(x: float, y: float) -> tuple[float, float]:
    lng, lat = _TO_WGS84.transform(x, y)
    return lat, lng


def _ll(x: float, y: float) -> list[float]:
    lat, lng = utm_to_latlng(x, y)
    return [round(lat, 8), round(lng, 8)]


def build_plots() -> list[dict]:
    plots = []
    for idx in range(PLOT_COLS * PLOT_ROWS):
        pr, pc = divmod(idx, PLOT_COLS)
        x0, y0 = plot_origin(idx)
        valid_cols, valid_rows = valid_size(idx)
        center = _ll(x0 + PLOT_M / 2, y0 - PLOT_M / 2)
        plots.append({
            "idx": idx,
            "pr": pr,
            "pc": pc,
            "corners": [
                _ll(x0, y0),
                _ll(x0 + PLOT_M, y0),
                _ll(x0 + PLOT_M, y0 - PLOT_M),
                _ll(x0, y0 - PLOT_M),
            ],
            "centerLat": center[0],
            "centerLng": center[1],
            "utmX0": x0,
            "utmY0": y0,
            "validCols": valid_cols,
            "validRows": valid_rows,
            "tilePath": f"tiles/plots/plot_{idx:03d}.jpg?v=s2",  # version busts the immutable /tiles cache
        })
    return plots


def grid_constants() -> dict:
    return {
        "crs": CRS,
        "originX": ORIGIN_X,
        "originY": ORIGIN_Y,
        "pixelM": PIXEL_M,
        "s2Width": S2_WIDTH,
        "s2Height": S2_HEIGHT,
        "cells": CELLS,
        "plotCols": PLOT_COLS,
        "plotRows": PLOT_ROWS,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_plot_grid.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add plot_grid.py tests/test_plot_grid.py
git commit -m "feat: add Sentinel-2 aligned plot grid math"
```

### Task 3: Plot image renderer and `data.js` writer (`generate_plots.py`)

**Files:**
- Create: `generate_plots.py`
- Modify (generated): `data.js` (only the block between `// BEGIN GENERATED STUDY AREA DATA` and `// END GENERATED STUDY AREA DATA`)
- Replace (generated): `tiles/plots/*.jpg`

`generate_tiles.py` stays as it is. It's the legacy Tauri tile builder. We import its boundary helpers.

- [ ] **Step 1: Write `generate_plots.py`**

```python
"""Render Sentinel-2 aligned plot images and write the grid block in data.js.

Usage:
    python generate_plots.py                # all 120 plots + data.js
    python generate_plots.py --only 0,13    # re-render a few plots (data.js still rewritten)
    python generate_plots.py --skip-images  # only rewrite data.js

Fetches Esri World Imagery tiles (zoom 18, ~0.57 m/px) once, caches them in
.tile-cache/, and warps them onto each 500 m UTM plot at 0.5 m/px (1000x1000).
Esri's terms restrict bulk downloads; this is a one-time, non-commercial render
for the thesis app only.
"""
import argparse
import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds

import plot_grid
from generate_tiles import (
    ATOK_BOUNDARY_PATH,
    DATA_JS_PATH,
    PAOAY_BOUNDARY_PATH,
    geometry_to_latlng_poly,
    js_assignment,
    load_feature,
)

ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ZOOM = 18
TILE_PX = 256
OUT_PX = 1000
OUT_RES_M = plot_grid.PLOT_M / OUT_PX
MARGIN_M = 20
JPEG_QUALITY = 80
CACHE_DIR = Path(".tile-cache")
PLOT_OUT_DIR = Path("tiles/plots")
HEADERS = {"User-Agent": "taniman-thesis-plot-renderer/1.0 (one-time non-commercial render)"}
MERC_HALF = 20037508.342789244


def lnglat_to_tile(lng: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def tile_top_left_merc(x: int, y: int, z: int) -> tuple[float, float, float]:
    size = 2 * MERC_HALF / 2 ** z
    return -MERC_HALF + x * size, MERC_HALF - y * size, size


def fetch_tile(session: requests.Session, z: int, x: int, y: int) -> np.ndarray:
    path = CACHE_DIR / str(z) / str(x) / f"{y}.jpg"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            response = session.get(ESRI_URL.format(z=z, x=x, y=y), headers=HEADERS, timeout=30)
            if response.status_code == 200:
                path.write_bytes(response.content)
                break
            time.sleep(2 ** attempt)
        else:
            raise SystemExit(f"Failed to fetch Esri tile {z}/{x}/{y}")
        time.sleep(0.25)  # stay polite: a few requests per second at most
    return np.asarray(Image.open(path).convert("RGB"))


def render_plot(session: requests.Session, plot: dict) -> None:
    x0, y0 = plot["utmX0"], plot["utmY0"]
    west, south, east, north = transform_bounds(
        plot_grid.CRS, "EPSG:4326",
        x0 - MARGIN_M, y0 - plot_grid.PLOT_M - MARGIN_M,
        x0 + plot_grid.PLOT_M + MARGIN_M, y0 + MARGIN_M,
    )
    tx0, ty0 = lnglat_to_tile(west, north, ZOOM)
    tx1, ty1 = lnglat_to_tile(east, south, ZOOM)
    xs = range(int(tx0), int(tx1) + 1)
    ys = range(int(ty0), int(ty1) + 1)

    mosaic = np.zeros((3, len(ys) * TILE_PX, len(xs) * TILE_PX), dtype=np.uint8)
    for j, ty in enumerate(ys):
        for i, tx in enumerate(xs):
            tile = fetch_tile(session, ZOOM, tx, ty)
            mosaic[:, j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX] = tile.transpose(2, 0, 1)

    left, top, size = tile_top_left_merc(xs[0], ys[0], ZOOM)
    src_transform = Affine(size / TILE_PX, 0, left, 0, -size / TILE_PX, top)
    dst_transform = Affine(OUT_RES_M, 0, x0, 0, -OUT_RES_M, y0)
    out = np.zeros((3, OUT_PX, OUT_PX), dtype=np.uint8)
    reproject(
        source=mosaic, destination=out,
        src_transform=src_transform, src_crs="EPSG:3857",
        dst_transform=dst_transform, dst_crs=plot_grid.CRS,
        resampling=Resampling.bilinear,
    )
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out.transpose(1, 2, 0)).save(
        PLOT_OUT_DIR / f"plot_{plot['idx']:03d}.jpg", quality=JPEG_QUALITY, optimize=True)


def write_grid_to_data_js(atok_poly: list, paoay_poly: list, plots: list) -> None:
    source = DATA_JS_PATH.read_text(encoding="utf-8")
    begin = source.find("// BEGIN GENERATED STUDY AREA DATA")
    end = source.find("// END GENERATED STUDY AREA DATA")
    if begin == -1 or end == -1:
        raise SystemExit("data.js is missing the generated study area markers")
    end_line = source.find("\n", end)
    end_line = len(source) if end_line == -1 else end_line + 1
    block = "\n".join([
        "// BEGIN GENERATED STUDY AREA DATA",
        js_assignment("ATOK_POLY", atok_poly),
        js_assignment("PAOAY_POLY", paoay_poly),
        js_assignment("GRID", plot_grid.grid_constants()),
        js_assignment("PLOTS", plots),
        "// END GENERATED STUDY AREA DATA",
        "",
    ])
    DATA_JS_PATH.write_text(source[:begin] + block + source[end_line:], encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated plot indexes to render")
    parser.add_argument("--skip-images", action="store_true")
    args = parser.parse_args()

    plots = plot_grid.build_plots()
    if not args.skip_images:
        targets = plots
        if args.only:
            wanted = {int(v) for v in args.only.split(",")}
            targets = [p for p in plots if p["idx"] in wanted]
        else:
            for old in PLOT_OUT_DIR.glob("plot_*.jpg"):
                old.unlink()
        with requests.Session() as session:
            for n, plot in enumerate(targets, 1):
                render_plot(session, plot)
                print(f"[{n}/{len(targets)}] plot_{plot['idx']:03d}.jpg")

    atok_poly = geometry_to_latlng_poly(load_feature(ATOK_BOUNDARY_PATH))
    paoay_poly = geometry_to_latlng_poly(load_feature(PAOAY_BOUNDARY_PATH))
    write_grid_to_data_js(atok_poly, paoay_poly, plots)
    print(f"Wrote {len(plots)} plots to {DATA_JS_PATH}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Render two plots first to check alignment**

Run: `python generate_plots.py --only 0,13`
Expected: `[1/2] plot_000.jpg`, `[2/2] plot_013.jpg`, then `Wrote 120 plots to data.js`.

Open `tiles/plots/plot_013.jpg`. It should be a crisp 1000×1000 satellite photo with no stretching; terraces and roads should look sharp.

- [ ] **Step 3: Render all plots**

Run: `python generate_plots.py`
Expected: 120 lines, then `Wrote 120 plots to data.js`. `tiles/plots/` has exactly 120 files, about 20 MB in total (`du -sh tiles/plots`).

- [ ] **Step 4: Check the generated block**

Run: `node -e "const vm=require('vm');const c={window:{}};vm.runInNewContext(require('fs').readFileSync('data.js','utf8'),c);console.log(c.window.PLOTS.length, c.window.GRID.plotCols, c.window.PLOTS[11].validCols, 'PAOAY_PLOTS' in c.window)"`
Expected: `120 12 21 false`

- [ ] **Step 5: Commit**

```bash
git add generate_plots.py data.js tiles/plots
git commit -m "feat: render Sentinel-2 aligned plot images from Esri imagery"
```

The app will be broken until Chunk 3, because `app.js` still reads `PAOAY_PLOTS`. That's expected on this branch.

### Task 4: Supabase schema script (`docs/supabase-foundation.sql`)

**Files:**
- Create: `docs/supabase-foundation.sql`
- Delete: `docs/supabase-setup.sql`, `docs/supabase-add-crops.sql`

You can't run this script yourself. Write it exactly as below; the owner runs it in Task 22. Spec reference: §8.

- [ ] **Step 1: Write `docs/supabase-foundation.sql`**

```sql
-- =====================================================================
-- Taniman labeling foundation schema (spec 2026-10-13, section 8)
-- DESTRUCTIVE: drops and recreates public.plots and public.seasons.
-- All plot notes, photo links and painted labels are deleted.
-- Shared crop names in public.crops are kept, except names that are now
-- classes (carrot, cabbage, potato).
-- Run once in the Supabase SQL Editor when the new app version deploys.
-- =====================================================================

-- 1. Remove the old plot-row model --------------------------------------
drop trigger if exists validate_plot_custom_crops_before_write on public.plots;
drop function if exists public.validate_plot_custom_crops();
drop function if exists public.delete_crop_and_seasons(uuid);
drop function if exists public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]);
drop function if exists public.clear_plot(integer);
drop function if exists public.delete_crop(uuid);
drop table if exists public.seasons cascade;
drop table if exists public.plots cascade;

-- 2. Plot notes and photos ----------------------------------------------
create table public.plots (
  plot_idx   integer     primary key check (plot_idx between 0 and 119),
  note       text        not null default '',
  photo_url  text,
  updated_at timestamptz not null default now()
);

alter table public.plots enable row level security;
drop policy if exists "public_read_write" on public.plots;
create policy "public_read_write" on public.plots
  for all using (true) with check (true);

-- 3. Shared crop names for class 4 "Other cultivated" -------------------
create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex text not null,
  created_at timestamptz not null default now(),
  constraint crops_name_length check (
    char_length(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) between 1 and 80
  ),
  constraint crops_hex_format check (hex ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index if not exists crops_normalized_name_uq
  on public.crops ((lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))));

-- Names that are now classes cannot be crop names.
delete from public.crops
  where lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
    in ('carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas');
alter table public.crops drop constraint if exists crops_not_target_name;
alter table public.crops add constraint crops_not_target_name check (
  lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
    not in ('carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas')
);

insert into public.crops (name, hex) values
  ('Lettuce', '#22C55E'),
  ('Wombok', '#4ADE80')
on conflict do nothing;

alter table public.crops enable row level security;
revoke all on table public.crops from PUBLIC, anon, authenticated;
grant select, insert on table public.crops to anon, authenticated;
drop policy if exists crops_public_read on public.crops;
create policy crops_public_read on public.crops
  for select to anon, authenticated using (true);
drop policy if exists crops_public_insert on public.crops;
create policy crops_public_insert on public.crops
  for insert to anon, authenticated with check (true);

-- 4. Seasons: one row per (plot, class, crop name/remark, dates) ---------
create table public.seasons (
  id         text        primary key check (char_length(id) <= 400),
  plot_idx   integer     not null check (plot_idx between 0 and 119),
  class_id   smallint    check (class_id between 1 and 8),
  crop_id    uuid        references public.crops(id) on delete cascade,
  remark     text        check (remark is null or char_length(remark) <= 200),
  start_mmdd text        not null check (start_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  end_mmdd   text        not null check (end_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  cells      integer[]   not null default '{}',
  updated_at timestamptz not null default now(),
  constraint seasons_crop_only_for_class4
    check ((class_id is not distinct from 4) = (crop_id is not null)),
  constraint seasons_remark_only_for_other
    check ((class_id is null) = (coalesce(char_length(btrim(remark)), 0) > 0))
);

create index seasons_plot_idx on public.seasons (plot_idx);

alter table public.seasons enable row level security;
revoke all on table public.seasons from PUBLIC, anon, authenticated;
grant select on table public.seasons to anon, authenticated;
drop policy if exists seasons_public_read on public.seasons;
create policy seasons_public_read on public.seasons
  for select to anon, authenticated using (true);

-- 5. Atomic cell deltas ---------------------------------------------------
-- cells := (existing ∪ p_add) − p_remove. INSERT ... ON CONFLICT locks the
-- row, so concurrent calls for the same season serialize. The id is derived
-- from the metadata, so metadata never conflicts; remark is not updated.
create or replace function public.apply_season_cells(
  p_id text, p_plot_idx integer, p_class_id smallint, p_crop_id uuid, p_remark text,
  p_start text, p_end text, p_add integer[], p_remove integer[])
returns public.seasons
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result public.seasons;
  v_add integer[] := coalesce(p_add, '{}');
  v_remove integer[] := coalesce(p_remove, '{}');
begin
  if exists (select 1 from unnest(v_add || v_remove) as c where c < 0 or c > 2499) then
    raise exception 'Cell index out of range' using errcode = '22023';
  end if;

  insert into public.seasons as s
    (id, plot_idx, class_id, crop_id, remark, start_mmdd, end_mmdd, cells, updated_at)
  values (
    p_id, p_plot_idx, p_class_id, p_crop_id, nullif(btrim(p_remark), ''), p_start, p_end,
    coalesce((select array_agg(distinct c order by c) from unnest(v_add) as c
              where c <> all (v_remove)), '{}'),
    now())
  on conflict (id) do update set
    cells = coalesce((select array_agg(distinct c order by c) from unnest(s.cells || v_add) as c
                      where c <> all (v_remove)), '{}'),
    updated_at = now()
  returning * into result;

  if cardinality(result.cells) = 0 then
    delete from public.seasons where id = p_id;
    return null;
  end if;
  return result;
end;
$$;

-- 6. Clear a whole plot (including seasons this browser has not seen) ----
create or replace function public.clear_plot(p_plot_idx integer)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.seasons where plot_idx = p_plot_idx;
  insert into public.plots (plot_idx, note, photo_url, updated_at)
  values (p_plot_idx, '', null, now())
  on conflict (plot_idx) do update set note = '', photo_url = null, updated_at = now();
end;
$$;

-- 7. Delete a crop name and its seasons (cascade) -----------------------
create or replace function public.delete_crop(p_crop_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  removed bigint;
begin
  select count(*) into removed from public.seasons where crop_id = p_crop_id;
  delete from public.crops where id = p_crop_id;
  if not found then
    return 0;
  end if;
  return removed;
end;
$$;

revoke all on function public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]) from public;
revoke all on function public.clear_plot(integer) from public;
revoke all on function public.delete_crop(uuid) from public;
grant execute on function public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]) to anon, authenticated;
grant execute on function public.clear_plot(integer) to anon, authenticated;
grant execute on function public.delete_crop(uuid) to anon, authenticated;

-- 8. Photos bucket (unchanged) ------------------------------------------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict do nothing;
drop policy if exists "public_photo_upload" on storage.objects;
create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');
drop policy if exists "public_photo_read" on storage.objects;
create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');

-- 9. Make PostgREST pick up the new functions immediately ---------------
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write an optional smoke test the owner can run afterwards.** Create `docs/supabase-foundation-smoke.sql`:

```sql
-- Optional check after running supabase-foundation.sql. Leaves no data behind.
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', array[1,2,3], '{}');
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', array[4], array[2]);
select id, cells from public.seasons where id = 'p0|2||03-01|06-30|';   -- expect {1,3,4}
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', '{}', array[1,3,4]);
select count(*) from public.seasons where id = 'p0|2||03-01|06-30|';    -- expect 0
select name from public.crops order by name;                              -- expect Lettuce, Wombok (+ any older names)
```

- [ ] **Step 3: Delete the old scripts**

```bash
git rm docs/supabase-setup.sql docs/supabase-add-crops.sql
```

- [ ] **Step 4: Commit**

```bash
git add docs/supabase-foundation.sql docs/supabase-foundation-smoke.sql
git commit -m "feat: add per-season Supabase schema with atomic cell deltas"
```

---

## Chunk 2: Pure JS modules

All modules use the same wrapper as `season-utils.js`:

```js
(function (root) {
  'use strict';
  // ...
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_X = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

Modules that depend on other modules resolve them like this, so they work both in the browser and in Node tests:

```js
const Grid = root.TANIMAN_GRID || require('./grid.js');
```

### Task 5: `grid.js`

**Files:**
- Create: `grid.js`
- Test: `tests/grid.test.mjs`

- [ ] **Step 1: Write the failing test** in `tests/grid.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Grid = require('../grid.js');

// Corners and reference centers computed with pyproj (EPSG:32651 -> 4326).
const plot0 = {
  idx: 0, validCols: 50, validRows: 50,
  corners: [[16.64103485, 120.73772837], [16.6410859, 120.74241321], [16.63656949, 120.74246609], [16.63651846, 120.73778136]],
};
const plot119 = {
  idx: 119, validCols: 21, validRows: 44,
  corners: [[16.60094149, 120.789728], [16.60099124, 120.79441204], [16.59647465, 120.79446357], [16.59642492, 120.78977965]],
};

test('grid constants match the Sentinel-2 composite', () => {
  assert.equal(Grid.CRS, 'EPSG:32651');
  assert.equal(Grid.ORIGIN_X, 258690);
  assert.equal(Grid.ORIGIN_Y, 1841210);
  assert.equal(Grid.S2_WIDTH, 571);
  assert.equal(Grid.S2_HEIGHT, 494);
  assert.equal(Grid.PLOT_COLS, 12);
  assert.equal(Grid.PLOT_ROWS, 10);
});

test('cells map to Sentinel-2 rows and columns', () => {
  assert.deepEqual(Grid.cellToS2(0, 0), { cell_row: 0, cell_col: 0, s2_row: 0, s2_col: 0 });
  assert.deepEqual(Grid.cellToS2(13, 1275), { cell_row: 25, cell_col: 25, s2_row: 75, s2_col: 75 });
  assert.deepEqual(Grid.cellToS2(119, 2499), { cell_row: 49, cell_col: 49, s2_row: 499, s2_col: 599 });
  assert.deepEqual(Grid.s2ToCell(75, 75), { plotIdx: 13, cellIdx: 1275 });
});

test('UTM centers are exact', () => {
  assert.deepEqual(Grid.cellUtmCenter(0, 0), { utm_x: 258695, utm_y: 1841205 });
  assert.deepEqual(Grid.cellUtmCenter(13, 1275), { utm_x: 259445, utm_y: 1840455 });
});

test('cells outside the composite are out of bounds', () => {
  assert.equal(Grid.isCellInBounds(plot0, 2499), true);
  assert.equal(Grid.isCellInBounds(plot119, 20), true);        // col 20 < 21
  assert.equal(Grid.isCellInBounds(plot119, 21), false);       // col 21
  assert.equal(Grid.isCellInBounds(plot119, 43 * 50), true);   // row 43
  assert.equal(Grid.isCellInBounds(plot119, 44 * 50), false);  // row 44
  assert.equal(Grid.isCellInBounds(plot0, -1), false);
  assert.equal(Grid.isCellInBounds(plot0, 2500), false);
  assert.equal(Grid.validCellCount(plot119), 21 * 44);
});

test('brush cells stay inside the plot and the composite', () => {
  assert.deepEqual(Grid.brushCells(plot0, 0, 0, 1), [0]);
  assert.deepEqual(Grid.brushCells(plot0, 0, 0, 3), [0, 1, 50, 51]);       // clipped at the plot edge
  assert.deepEqual(Grid.brushCells(plot119, 0, 20, 3), [19, 20, 69, 70]);  // col 21 is out of bounds
  assert.deepEqual(Grid.brushCells(plot119, 44, 10, 1), []);               // row 44 is out of bounds
});

test('interpolated cell centers are within 0.5 m of the true projection', () => {
  const cases = [
    [plot0, 0, 16.6409902, 120.73777575],
    [plot0, 1275, 16.63875754, 120.74014464],
    [plot0, 2499, 16.63661415, 120.74241872],
    [plot119, 1275, 16.59866342, 120.79214317],
  ];
  for (const [plot, cell, lat, lng] of cases) {
    const got = Grid.cellLatLng(plot, cell);
    const dy = (got.center_lat - lat) * 111320;
    const dx = (got.center_lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
    assert.ok(Math.hypot(dx, dy) < 0.5, `plot ${plot.idx} cell ${cell} off by ${Math.hypot(dx, dy)} m`);
  }
});

test('grid bounds wrap every plot corner', () => {
  const b = Grid.gridBoundsLatLng([plot0, plot119]);
  assert.equal(b.latN, 16.6410859);
  assert.equal(b.latS, 16.59642492);
  assert.equal(b.lngW, 120.73772837);
  assert.equal(b.lngE, 120.79446357);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/grid.test.mjs`
Expected: FAIL with `Cannot find module '../grid.js'`

- [ ] **Step 3: Write `grid.js`**

```js
// Sentinel-2 aligned grid math. One label cell = one 10 m Sentinel-2 pixel.
// Constants from Sentinel2_CSPlus_2024_01_H1.tif (see spec section 1).
(function (root) {
  'use strict';

  const CRS = 'EPSG:32651';
  const ORIGIN_X = 258690;
  const ORIGIN_Y = 1841210;
  const PIXEL_M = 10;
  const S2_WIDTH = 571;
  const S2_HEIGHT = 494;
  const CELLS = 50;
  const PLOT_COLS = Math.ceil(S2_WIDTH / CELLS);
  const PLOT_ROWS = Math.ceil(S2_HEIGHT / CELLS);

  function plotPosition(plotIdx) {
    return { pr: Math.floor(plotIdx / PLOT_COLS), pc: plotIdx % PLOT_COLS };
  }

  function cellPosition(cellIdx) {
    return { cell_row: Math.floor(cellIdx / CELLS), cell_col: cellIdx % CELLS };
  }

  function cellToS2(plotIdx, cellIdx) {
    const { pr, pc } = plotPosition(plotIdx);
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return { cell_row, cell_col, s2_row: pr * CELLS + cell_row, s2_col: pc * CELLS + cell_col };
  }

  function s2ToCell(s2Row, s2Col) {
    const pr = Math.floor(s2Row / CELLS);
    const pc = Math.floor(s2Col / CELLS);
    return { plotIdx: pr * PLOT_COLS + pc, cellIdx: (s2Row % CELLS) * CELLS + (s2Col % CELLS) };
  }

  function isCellInBounds(plot, cellIdx) {
    if (!plot || !Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= CELLS * CELLS) return false;
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return cell_col < plot.validCols && cell_row < plot.validRows;
  }

  function validCellCount(plot) {
    return plot ? plot.validCols * plot.validRows : 0;
  }

  // Cell indexes under a size x size brush centred on (row, col), skipping
  // cells outside the plot or the Sentinel-2 composite.
  function brushCells(plot, row, col, size) {
    const half = Math.floor(size / 2);
    const out = [];
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= CELLS || c >= CELLS) continue;
        const cellIdx = r * CELLS + c;
        if (isCellInBounds(plot, cellIdx)) out.push(cellIdx);
      }
    }
    return out;
  }

  function cellUtmCenter(plotIdx, cellIdx) {
    const { s2_row, s2_col } = cellToS2(plotIdx, cellIdx);
    return {
      utm_x: ORIGIN_X + s2_col * PIXEL_M + PIXEL_M / 2,
      utm_y: ORIGIN_Y - s2_row * PIXEL_M - PIXEL_M / 2,
    };
  }

  function round8(n) {
    return Number(n.toFixed(8));
  }

  // Bilinear interpolation of the plot's WGS84 corners [NW, NE, SE, SW].
  // Error vs. a true UTM->WGS84 projection is < 1 cm over a 500 m plot.
  function cellLatLng(plot, cellIdx) {
    const { cell_row, cell_col } = cellPosition(cellIdx);
    const u = (cell_col + 0.5) / CELLS;
    const v = (cell_row + 0.5) / CELLS;
    const [nw, ne, se, sw] = plot.corners;
    const mix = i => (1 - u) * (1 - v) * nw[i] + u * (1 - v) * ne[i] + u * v * se[i] + (1 - u) * v * sw[i];
    return { center_lat: round8(mix(0)), center_lng: round8(mix(1)) };
  }

  function gridBoundsLatLng(plots) {
    const bounds = { latS: Infinity, latN: -Infinity, lngW: Infinity, lngE: -Infinity };
    for (const plot of plots || []) {
      for (const [lat, lng] of plot.corners) {
        bounds.latS = Math.min(bounds.latS, lat);
        bounds.latN = Math.max(bounds.latN, lat);
        bounds.lngW = Math.min(bounds.lngW, lng);
        bounds.lngE = Math.max(bounds.lngE, lng);
      }
    }
    return bounds;
  }

  const api = {
    CRS, ORIGIN_X, ORIGIN_Y, PIXEL_M, S2_WIDTH, S2_HEIGHT, CELLS, PLOT_COLS, PLOT_ROWS,
    plotPosition, cellPosition, cellToS2, s2ToCell, isCellInBounds, validCellCount,
    brushCells, cellUtmCenter, cellLatLng, gridBoundsLatLng,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_GRID = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/grid.test.mjs`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add grid.js tests/grid.test.mjs
git commit -m "feat: add Sentinel-2 grid math module"
```

### Task 6: `classes.js`

**Files:**
- Create: `classes.js`
- Test: `tests/classes.test.mjs`

It depends on `season-utils.js` (`isValidMmdd`).

- [ ] **Step 1: Write the failing test** in `tests/classes.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Classes = require('../classes.js');

const LETTUCE = '11111111-1111-4111-8111-111111111111';

test('eight classes plus Other, in class_id order', () => {
  assert.deepEqual(Classes.ALL.map(c => c.id), [1, 2, 3, 4, 5, 6, 7, 8, null]);
  assert.deepEqual(Classes.ALL.map(c => c.key), [
    'carrot', 'cabbage', 'potato', 'other_cultivated',
    'forest', 'built_up', 'bare_fallow', 'grass_shrub', 'other',
  ]);
  for (const cls of Classes.ALL) {
    assert.deepEqual(Object.keys(cls.name).sort(), ['en', 'il', 'tl']);
    assert.match(cls.hex, /^#[0-9A-F]{6}$/);
  }
  assert.equal(Classes.byId(null).key, 'other');
  assert.equal(Classes.byId(2).key, 'cabbage');
  assert.equal(Classes.byKey('forest').id, 5);
  assert.equal(Classes.byKey('nope'), null);
});

test('reserved crop names are the three target classes in en/tl/il', () => {
  assert.deepEqual(Classes.RESERVED_CROP_NAMES, ['carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas']);
});

test('non-crop classes default to all year; crops do not', () => {
  assert.deepEqual(Classes.defaultDates('forest'), { start: '01-01', end: '12-31' });
  assert.deepEqual(Classes.defaultDates('grass_shrub'), { start: '01-01', end: '12-31' });
  assert.equal(Classes.defaultDates('cabbage'), null);
  assert.equal(Classes.defaultDates('other'), null);
});

test('selection status blocks painting until complete', () => {
  const resolved = id => id === LETTUCE;
  const s = (sel) => Classes.selectionStatus(sel, resolved);
  assert.deepEqual(s({ classKey: null }), { ready: false, missing: 'class' });
  assert.deepEqual(s({ classKey: 'cabbage', start: null, end: null }), { ready: false, missing: 'dates' });
  assert.deepEqual(s({ classKey: 'cabbage', start: '03-01', end: '06-30' }), { ready: true, missing: null });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: null, start: '03-01', end: '06-30' }), { ready: false, missing: 'cropName' });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: 'deleted', start: '03-01', end: '06-30' }), { ready: false, missing: 'cropName' });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: LETTUCE, start: '03-01', end: '06-30' }), { ready: true, missing: null });
  assert.deepEqual(s({ classKey: 'other', remark: '   ', start: '03-01', end: '06-30' }), { ready: false, missing: 'remark' });
  assert.deepEqual(s({ classKey: 'other', remark: 'weeds', start: null, end: null }), { ready: false, missing: 'dates' });
  assert.deepEqual(s({ classKey: 'forest', start: '01-01', end: '12-31' }), { ready: true, missing: null });
});

test('paint meta keeps only the fields that belong to the class', () => {
  const ok = () => true;
  assert.deepEqual(
    Classes.paintMeta({ classKey: 'cabbage', cropId: LETTUCE, remark: 'x', start: '03-01', end: '06-30' }, ok),
    { classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' });
  assert.deepEqual(
    Classes.paintMeta({ classKey: 'other', remark: '  Weeds   here ', start: '03-01', end: '06-30' }, ok),
    { classId: null, cropId: null, remark: 'Weeds here', start: '03-01', end: '06-30' });
  assert.equal(Classes.paintMeta({ classKey: 'cabbage', start: null, end: null }, ok), null);
});

test('season ids are deterministic and case-insensitive on remarks', () => {
  const a = Classes.seasonId(14, { classId: null, cropId: null, remark: 'Weeds', start: '03-01', end: '06-30' });
  const b = Classes.seasonId(14, { classId: null, cropId: null, remark: ' weeds ', start: '03-01', end: '06-30' });
  assert.equal(a, 'p14|other||03-01|06-30|weeds');
  assert.equal(a, b);
  assert.equal(
    Classes.seasonId(3, { classId: 4, cropId: LETTUCE, remark: '', start: '11-15', end: '02-10' }),
    `p3|4|${LETTUCE}|11-15|02-10|`);
  assert.equal(
    Classes.seasonKey({ classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' }),
    '2||03-01|06-30|');
});

test('colors: class 4 uses its crop color, everything else the class color', () => {
  const catalog = { byId: id => (id === LETTUCE ? { id, hex: '#22C55E' } : null) };
  assert.equal(Classes.seasonColor({ classId: 2 }, catalog), '#A855F7');
  assert.equal(Classes.seasonColor({ classId: 4, cropId: LETTUCE }, catalog), '#22C55E');
  assert.equal(Classes.seasonColor({ classId: 4, cropId: 'missing' }, catalog), '#14B8A6');
  assert.equal(Classes.seasonColor({ classId: null }, catalog), '#F472B6');
  assert.equal(Classes.legendIndex(1), 0);
  assert.equal(Classes.legendIndex(8), 7);
  assert.equal(Classes.legendIndex(null), 8);
});

test('selection label and color describe the brush', () => {
  const catalog = { byId: id => (id === LETTUCE ? { id, hex: '#22C55E', name: { en: 'Lettuce' } } : null) };
  assert.equal(Classes.selectionLabel({ classKey: 'cabbage' }, catalog, 'en'), 'Cabbage');
  assert.equal(Classes.selectionLabel({ classKey: 'other_cultivated', cropId: LETTUCE }, catalog, 'en'), 'Lettuce');
  assert.equal(Classes.selectionLabel({ classKey: 'other', remark: 'weeds' }, catalog, 'en'), 'Other: weeds');
  assert.equal(Classes.selectionColor({ classKey: 'other_cultivated', cropId: LETTUCE }, catalog), '#22C55E');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/classes.test.mjs`
Expected: FAIL with `Cannot find module '../classes.js'`

- [ ] **Step 3: Write `classes.js`**

The Tagalog and Ilocano names are best guesses. Leave the comment below in the file so the team verifies them.

```js
// Land-cover classes (spec section 3). class_id must match the pipeline's
// config.yaml. "Other" has no class_id: it is exported for review, not training.
// TODO(team): verify Tagalog (tl) and Ilocano (il) class names with a speaker.
(function (root) {
  'use strict';

  const Seasons = root.TANIMAN_SEASONS || require('./season-utils.js');

  const CLASSES = [
    { id: 1, key: 'carrot', hex: '#FF6A1F', group: 'target', name: { en: 'Carrot', tl: 'Karot', il: 'Karot' } },
    { id: 2, key: 'cabbage', hex: '#A855F7', group: 'target', name: { en: 'Cabbage', tl: 'Repolyo', il: 'Repolyo' } },
    { id: 3, key: 'potato', hex: '#FFC629', group: 'target', name: { en: 'Potato', tl: 'Patatas', il: 'Patatas' } },
    { id: 4, key: 'other_cultivated', hex: '#14B8A6', group: 'crop', needsCropName: true, name: { en: 'Other cultivated', tl: 'Ibang pananim', il: 'Sabali a mula' } },
    { id: 5, key: 'forest', hex: '#166534', group: 'noncrop', name: { en: 'Forest / woody', tl: 'Gubat / makahoy', il: 'Kabakiran / kakaykaywan' } },
    { id: 6, key: 'built_up', hex: '#DC2626', group: 'noncrop', name: { en: 'Built-up', tl: 'Gusali / kalsada', il: 'Pagbalayan / kalsada' } },
    { id: 7, key: 'bare_fallow', hex: '#A16207', group: 'noncrop', name: { en: 'Bare / fallow', tl: 'Tiwangwang / pahinga', il: 'Awan mulana / pagin-inana' } },
    { id: 8, key: 'grass_shrub', hex: '#84CC16', group: 'noncrop', name: { en: 'Grass / shrub', tl: 'Damuhan / palumpong', il: 'Ruot / babassit a kayo' } },
  ];
  const OTHER = { id: null, key: 'other', hex: '#F472B6', group: 'other', needsRemark: true, name: { en: 'Other', tl: 'Iba pa', il: 'Sabali' } };
  const ALL = [...CLASSES, OTHER];
  const RESERVED_CROP_NAMES = ['carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas'];
  const PROMPT_KEYS = { class: 'pickClass', cropName: 'pickCropName', remark: 'typeRemark', dates: 'pickDates' };
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  function byKey(key) {
    return ALL.find(cls => cls.key === key) || null;
  }

  function byId(classId) {
    if (classId == null) return OTHER;
    return CLASSES.find(cls => cls.id === Number(classId)) || null;
  }

  function className(classId, lang = 'en') {
    const cls = byId(classId);
    return cls ? (cls.name[lang] || cls.name.en) : '';
  }

  function normalizeRemark(text) {
    return String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  }

  function defaultDates(key) {
    const cls = byKey(key);
    return cls && cls.group === 'noncrop' ? { start: '01-01', end: '12-31' } : null;
  }

  function selectionStatus(sel, isCropResolved = () => true) {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return { ready: false, missing: 'class' };
    if (cls.needsCropName && !(sel.cropId && isCropResolved(sel.cropId))) return { ready: false, missing: 'cropName' };
    if (cls.needsRemark && !normalizeRemark(sel.remark)) return { ready: false, missing: 'remark' };
    if (!Seasons.isValidMmdd(sel.start) || !Seasons.isValidMmdd(sel.end)) return { ready: false, missing: 'dates' };
    return { ready: true, missing: null };
  }

  function paintMeta(sel, isCropResolved) {
    if (!selectionStatus(sel, isCropResolved).ready) return null;
    const cls = byKey(sel.classKey);
    return {
      classId: cls.id,
      cropId: cls.needsCropName ? sel.cropId : null,
      remark: cls.needsRemark ? normalizeRemark(sel.remark).slice(0, 200) : '',
      start: sel.start,
      end: sel.end,
    };
  }

  // Plot-independent season identity, also used to group cells into fields.
  function seasonKey(meta) {
    return [
      meta.classId == null ? 'other' : meta.classId,
      meta.cropId || '',
      meta.start,
      meta.end,
      normalizeRemark(meta.remark).toLowerCase(),
    ].join('|');
  }

  function seasonId(plotIdx, meta) {
    return `p${plotIdx}|${seasonKey(meta)}`;
  }

  function seasonColor(season, catalog) {
    const cls = byId(season && season.classId) || OTHER;
    if (cls.id === 4 && season.cropId && catalog) {
      const crop = catalog.byId(season.cropId);
      if (crop && HEX_RE.test(crop.hex || '')) return crop.hex;
    }
    return cls.hex;
  }

  function legendIndex(classId) {
    return classId == null ? ALL.length - 1 : Number(classId) - 1;
  }

  function cropName(catalog, cropId, lang = 'en') {
    const crop = catalog && cropId ? catalog.byId(cropId) : null;
    return crop && crop.name ? (crop.name[lang] || crop.name.en || '') : '';
  }

  function selectionLabel(sel, catalog, lang = 'en') {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return '';
    if (cls.needsCropName && sel.cropId) return cropName(catalog, sel.cropId, lang) || (cls.name[lang] || cls.name.en);
    if (cls.needsRemark) {
      const remark = normalizeRemark(sel.remark);
      return remark ? `${cls.name[lang] || cls.name.en}: ${remark}` : (cls.name[lang] || cls.name.en);
    }
    return cls.name[lang] || cls.name.en;
  }

  function selectionColor(sel, catalog) {
    const cls = sel && byKey(sel.classKey);
    if (!cls) return '#9CA3AF';
    return seasonColor({ classId: cls.id, cropId: sel.cropId }, catalog);
  }

  const api = {
    CLASSES, OTHER, ALL, RESERVED_CROP_NAMES, PROMPT_KEYS,
    byKey, byId, className, normalizeRemark, defaultDates,
    selectionStatus, paintMeta, seasonKey, seasonId,
    seasonColor, legendIndex, cropName, selectionLabel, selectionColor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_CLASSES = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/classes.test.mjs`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add classes.js tests/classes.test.mjs
git commit -m "feat: add land-cover class definitions and painting rules"
```

### Task 7: `season-outbox.js`

**Files:**
- Create: `season-outbox.js`
- Test: `tests/season-outbox.test.mjs`

This module implements the spec's §8 client-sync rules: the coalescing rule, the undo diff, refetch merging and error classification.

- [ ] **Step 1: Write the failing test** in `tests/season-outbox.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Outbox = require('../season-outbox.js');

const meta = { id: 'p0|2||03-01|06-30|', plotIdx: 0, classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' };

test('adds and removes coalesce per season; latest action wins', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2, 3], []);
  box.record(meta, [], [2]);
  box.record(meta, [2], []);        // erase then repaint before flush -> painted
  box.record(meta, [], [9]);
  const [delta] = box.drain();
  assert.deepEqual(delta.add, [1, 2, 3]);
  assert.deepEqual(delta.remove, [9]);
  assert.equal(delta.id, meta.id);
  assert.equal(delta.classId, 2);
  assert.equal(box.size(), 0);
});

test('requeued deltas never override newer edits', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2], []);
  const [sent] = box.drain();
  box.record(meta, [], [2]);        // user erased 2 while the request was in flight
  box.requeue(sent);                // request failed; put it back underneath
  const [delta] = box.drain();
  assert.deepEqual(delta.add, [1]);
  assert.deepEqual(delta.remove, [2]);
});

test('outbox survives JSON round trips and can drop by plot or crop', () => {
  const box = Outbox.create();
  box.record(meta, [1], []);
  box.record({ ...meta, id: 'p1|4|abc|01-01|02-01|', plotIdx: 1, classId: 4, cropId: 'abc' }, [5], []);
  const copy = Outbox.create(JSON.parse(JSON.stringify(box.toJSON())));
  assert.equal(copy.size(), 2);
  assert.equal(copy.has(meta.id), true);
  copy.dropCrop('abc');
  assert.equal(copy.size(), 1);
  copy.dropPlot(0);
  assert.equal(copy.size(), 0);
});

test('diffSeasons turns an undo snapshot into deltas', () => {
  const current = [
    { id: 'a', classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells: [1, 2, 3] },
    { id: 'b', classId: 5, cropId: null, remark: '', start: '01-01', end: '12-31', cells: [7] },
  ];
  const target = [
    { id: 'a', classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells: [1, 4] },
    { id: 'c', classId: 1, cropId: null, remark: '', start: '05-01', end: '08-01', cells: [9] },
  ];
  const deltas = Outbox.diffSeasons(0, current, target);
  assert.deepEqual(deltas.map(d => [d.meta.id, d.add, d.remove]), [
    ['a', [4], [2, 3]],
    ['b', [], [7]],
    ['c', [9], []],
  ]);
  assert.equal(deltas[2].meta.classId, 1);
  assert.equal(deltas[2].meta.plotIdx, 0);
});

test('remote seasons replace local ones unless the local season is pending', () => {
  const local = [
    { id: 'a', cells: [1] },      // pending -> kept
    { id: 'b', cells: [2] },      // not pending, gone remotely -> dropped
    { id: 'c', cells: [3] },      // not pending, replaced by remote
  ];
  const remote = [{ id: 'a', cells: [99] }, { id: 'c', cells: [3, 4] }, { id: 'd', cells: [5] }];
  const merged = Outbox.mergeRemoteSeasons(local, remote, id => id === 'a');
  assert.deepEqual(merged, [{ id: 'a', cells: [1] }, { id: 'c', cells: [3, 4] }, { id: 'd', cells: [5] }]);
});

test('server rows become local seasons', () => {
  assert.deepEqual(Outbox.seasonFromRow({
    id: 'x', plot_idx: 3, class_id: null, crop_id: null, remark: 'weeds',
    start_mmdd: '03-01', end_mmdd: '06-30', cells: [5, 2],
  }), { id: 'x', classId: null, cropId: null, remark: 'weeds', start: '03-01', end: '06-30', cells: [2, 5] });
});

test('in-flight deltas stay pending and are persisted until acknowledged', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2], []);
  const [sending] = box.begin();
  assert.equal(box.size(), 0);
  assert.equal(box.has(meta.id), true);           // still pending while in flight
  box.record(meta, [], [2]);                      // newer edit during the request
  const saved = Outbox.create(JSON.parse(JSON.stringify(box.toJSON())));
  const [delta] = saved.drain();
  assert.deepEqual(delta.add, [1]);               // in-flight add survives a reload
  assert.deepEqual(delta.remove, [2]);            // newer erase wins
  box.ack(sending.id);
  assert.equal(box.isSending(meta.id), false);
});

test('flush sends each delta and reports rows, retries and permanent errors', async () => {
  const other = { ...meta, id: 'p0|5||01-01|12-31|', classId: 5, start: '01-01', end: '12-31' };
  const third = { ...meta, id: 'p1|1||02-01|05-01|', plotIdx: 1, classId: 1, start: '02-01', end: '05-01' };
  const box = Outbox.create();
  box.record(meta, [1], []);
  box.record(other, [2], []);
  box.record(third, [3], []);
  const rows = [];
  const permanent = [];
  const result = await Outbox.flush(box, {
    send: async delta => {
      if (delta.id === other.id) throw Object.assign(new Error('offline'), { status: 0 });
      if (delta.id === third.id) throw Object.assign(new Error('fk'), { code: '23503' });
      return { id: delta.id, cells: delta.add };
    },
    onRow: (delta, row) => rows.push([delta.id, row.cells]),
    onPermanent: delta => permanent.push(delta.id),
  });
  assert.deepEqual(rows, [[meta.id, [1]]]);
  assert.deepEqual(permanent, [third.id]);
  assert.equal(result.retry, true);
  assert.equal(box.size(), 1);                    // only the network failure is requeued
  assert.equal(box.has(other.id), true);
  assert.equal(box.has(third.id), false);
});

test('rows for deltas dropped mid-flight are ignored', async () => {
  const box = Outbox.create();
  box.record(meta, [1], []);
  const rows = [];
  await Outbox.flush(box, {
    send: async delta => { box.dropPlot(0); return { id: delta.id, cells: [1] }; },
    onRow: (delta, row) => rows.push(row),
  });
  assert.deepEqual(rows, []);
  assert.equal(box.has(meta.id), false);
});

test('error classification: data errors are permanent, network errors retry', () => {
  assert.equal(Outbox.classifySyncError({ code: '23503' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ code: '23514' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ code: '22023' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ status: 400 }), 'permanent');
  assert.equal(Outbox.classifySyncError({ status: 408 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 429 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 503 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 0, message: 'offline' }), 'retry');
  assert.equal(Outbox.classifySyncError(new TypeError('Failed to fetch')), 'retry');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/season-outbox.test.mjs`
Expected: FAIL with `Cannot find module '../season-outbox.js'`

- [ ] **Step 3: Write `season-outbox.js`**

```js
// Per-season delta queue for Supabase sync (spec section 8, "Client sync").
// Each entry holds at most one {add, remove} pair per season id; the latest
// action on a cell wins, so the two sets never overlap.
(function (root) {
  'use strict';

  const byNumber = (a, b) => a - b;

  function metaOf(source) {
    return {
      id: source.id,
      plotIdx: source.plotIdx,
      classId: source.classId == null ? null : source.classId,
      cropId: source.cropId || null,
      remark: source.remark || '',
      start: source.start,
      end: source.end,
    };
  }

  function metaFromSeason(plotIdx, season) {
    return metaOf({ ...season, plotIdx });
  }

  function seasonFromRow(row) {
    return {
      id: row.id,
      classId: row.class_id == null ? null : row.class_id,
      cropId: row.crop_id || null,
      remark: row.remark || '',
      start: row.start_mmdd,
      end: row.end_mmdd,
      cells: Array.isArray(row.cells) ? [...row.cells].sort(byNumber) : [],
    };
  }

  function create(serialized) {
    const entries = new Map();   // pending, not yet sent
    const sending = new Map();   // drained by begin(), awaiting ack/fail

    function entryFor(source) {
      let entry = entries.get(source.id);
      if (!entry) {
        entry = { meta: metaOf(source), add: new Set(), remove: new Set() };
        entries.set(source.id, entry);
      }
      return entry;
    }

    function record(meta, add = [], remove = []) {
      const entry = entryFor(meta);
      for (const cell of add) { entry.remove.delete(cell); entry.add.add(cell); }
      for (const cell of remove) { entry.add.delete(cell); entry.remove.add(cell); }
    }

    // Put a failed delta back underneath any edits made since it was drained.
    function requeue(delta) {
      const entry = entryFor(delta);
      for (const cell of delta.add || []) if (!entry.remove.has(cell)) entry.add.add(cell);
      for (const cell of delta.remove || []) if (!entry.add.has(cell)) entry.remove.add(cell);
    }

    function toDelta(entry) {
      return { ...entry.meta, add: [...entry.add].sort(byNumber), remove: [...entry.remove].sort(byNumber) };
    }

    function drain() {
      const out = [...entries.values()].map(toDelta).filter(d => d.add.length || d.remove.length);
      entries.clear();
      return out;
    }

    // Move every pending delta into "sending"; they stay pending (has() is
    // true) and are still persisted by toJSON() until ack() or fail().
    function begin() {
      const out = drain();
      for (const delta of out) sending.set(delta.id, delta);
      return out;
    }

    function ack(id) {
      sending.delete(id);
    }

    function fail(delta) {
      if (!sending.has(delta.id)) return;   // dropped while in flight
      sending.delete(delta.id);
      requeue(delta);
    }

    function dropWhere(predicate) {
      for (const [id, entry] of entries) if (predicate(entry.meta)) entries.delete(id);
      for (const [id, delta] of sending) if (predicate(delta)) sending.delete(id);
    }

    function toJSON() {
      const merged = create();
      for (const delta of sending.values()) merged.record(delta, delta.add, delta.remove);
      for (const entry of entries.values()) merged.record(entry.meta, [...entry.add], [...entry.remove]);
      return merged.pendingDeltas();
    }

    const box = {
      record,
      requeue,
      drain,
      begin,
      ack,
      fail,
      has: id => entries.has(id) || sending.has(id),
      hasQueued: id => entries.has(id),
      isSending: id => sending.has(id),
      size: () => entries.size,
      dropPlot: plotIdx => dropWhere(m => m.plotIdx === plotIdx),
      dropCrop: cropId => dropWhere(m => m.cropId === cropId),
      pendingDeltas: () => [...entries.values()].map(toDelta),
      toJSON,
    };

    for (const delta of Array.isArray(serialized) ? serialized : []) {
      if (delta && typeof delta.id === 'string') record(delta, delta.add || [], delta.remove || []);
    }
    return box;
  }

  function diffSeasons(plotIdx, current, target) {
    const cur = new Map((current || []).map(s => [s.id, s]));
    const tgt = new Map((target || []).map(s => [s.id, s]));
    const out = [];
    for (const id of new Set([...cur.keys(), ...tgt.keys()])) {
      const before = new Set((cur.get(id) || {}).cells || []);
      const after = new Set((tgt.get(id) || {}).cells || []);
      const add = [...after].filter(c => !before.has(c)).sort(byNumber);
      const remove = [...before].filter(c => !after.has(c)).sort(byNumber);
      if (add.length || remove.length) {
        out.push({ meta: metaFromSeason(plotIdx, tgt.get(id) || cur.get(id)), add, remove });
      }
    }
    return out.sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
  }

  function mergeRemoteSeasons(local, remote, isPending) {
    const pending = (local || []).filter(season => isPending(season.id));
    const pendingIds = new Set(pending.map(season => season.id));
    return [...pending, ...(remote || []).filter(season => !pendingIds.has(season.id))];
  }

  function classifySyncError(error) {
    if (!error) return 'retry';
    const code = String(error.code || '');
    if (/^2[23][0-9A-Z]{3}$/.test(code)) return 'permanent';
    const status = Number(error.status);
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'permanent';
    return 'retry';
  }

  // Send every pending delta once. Network failures are requeued (newer
  // edits win); permanent failures are dropped and reported. A row is only
  // reported when the delta was not dropped mid-flight and no newer edit
  // for the same season is queued.
  async function flush(box, { send, onRow = () => {}, onPermanent = () => {} }) {
    let retry = false;
    for (const delta of box.begin()) {
      try {
        const row = await send(delta);
        const stillWanted = box.isSending(delta.id);
        box.ack(delta.id);
        if (stillWanted && !box.hasQueued(delta.id)) await onRow(delta, row);
      } catch (error) {
        if (classifySyncError(error) === 'permanent') {
          const stillWanted = box.isSending(delta.id);
          box.ack(delta.id);
          if (stillWanted) await onPermanent(delta, error);
        } else {
          box.fail(delta);
          retry = true;
        }
      }
    }
    return { retry };
  }

  const api = { create, flush, metaFromSeason, seasonFromRow, diffSeasons, mergeRemoteSeasons, classifySyncError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_OUTBOX = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/season-outbox.test.mjs`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add season-outbox.js tests/season-outbox.test.mjs
git commit -m "feat: add coalescing season delta outbox"
```

### Task 8: `field-ids.js`

**Files:**
- Create: `field-ids.js`
- Test: `tests/field-ids.test.mjs`

- [ ] **Step 1: Write the failing test** in `tests/field-ids.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Fields = require('../field-ids.js');

const full = idx => ({ idx, validCols: 50, validRows: 50 });
const plots = [full(0), full(1), full(12)];
const cabbage = (plotIdx, cells) => ({
  id: `p${plotIdx}|2||03-01|06-30|`, classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells,
});

test('connected same-season cells form one field; separate patches get separate ids', () => {
  const plotData = { 0: { seasons: [cabbage(0, [0, 1, 51, 200, 201])] } };
  const { fields, fieldIdFor } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 0), 'F0001');
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 51), 'F0001');
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 200), 'F0002');
  assert.equal(fields[0].cell_count, 3);
  assert.deepEqual(fields[0].plot_idxs, [0]);
});

test('diagonal contact does not join cells', () => {
  const plotData = { 0: { seasons: [cabbage(0, [0, 51])] } };
  assert.equal(Fields.computeFields(plotData, plots).fields.length, 2);
});

test('a field crossing a plot border keeps one id', () => {
  // plot 0 col 49 touches plot 1 col 0; plot 0 row 49 touches plot 12 row 0
  const plotData = {
    0: { seasons: [cabbage(0, [49, 49 * 50 + 49])] },
    1: { seasons: [cabbage(1, [0])] },
    12: { seasons: [cabbage(12, [49])] },
  };
  const { fields } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields[0].plot_idxs, [0, 1]);
  assert.deepEqual(fields[1].plot_idxs, [0, 12]);
});

test('different seasons on the same cells are different fields', () => {
  const potato = { ...cabbage(0, [0, 1]), id: 'p0|3||07-01|10-30|', classId: 3, start: '07-01', end: '10-30' };
  const plotData = { 0: { seasons: [cabbage(0, [0, 1]), potato] } };
  const { fields, fieldIdFor } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.notEqual(fieldIdFor('p0|2||03-01|06-30|', 0), fieldIdFor('p0|3||07-01|10-30|', 0));
});

test('out-of-bounds cells are ignored and ids are deterministic', () => {
  const partial = [{ idx: 0, validCols: 21, validRows: 50 }];
  const plotData = { 0: { seasons: [cabbage(0, [20, 21, 22])] } };
  const first = Fields.computeFields(plotData, partial);
  const second = Fields.computeFields(plotData, partial);
  assert.equal(first.fields.length, 1);
  assert.equal(first.fields[0].cell_count, 1);
  assert.equal(first.fieldIdFor('p0|2||03-01|06-30|', 21), '');
  assert.deepEqual(first.fields.map(f => f.field_id), second.fields.map(f => f.field_id));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/field-ids.test.mjs`
Expected: FAIL with `Cannot find module '../field-ids.js'`

- [ ] **Step 3: Write `field-ids.js`**

```js
// Field IDs (spec section 6): maximal 4-connected groups of cells that share a
// season key, computed on global Sentinel-2 row/col so fields cross plot edges.
(function (root) {
  'use strict';

  const Grid = root.TANIMAN_GRID || require('./grid.js');
  const Classes = root.TANIMAN_CLASSES || require('./classes.js');
  const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function computeFields(plotData, plots) {
    const groups = new Map();
    for (const plot of plots || []) {
      const data = plotData && plotData[plot.idx];
      if (!data) continue;
      for (const season of data.seasons || []) {
        const key = Classes.seasonKey(season);
        if (!groups.has(key)) groups.set(key, new Map());
        const cells = groups.get(key);
        for (const cellIdx of season.cells || []) {
          if (!Grid.isCellInBounds(plot, cellIdx)) continue;
          const { s2_row, s2_col } = Grid.cellToS2(plot.idx, cellIdx);
          cells.set(s2_row * Grid.S2_WIDTH + s2_col, { season, plotIdx: plot.idx, cellIdx, r: s2_row, c: s2_col });
        }
      }
    }

    const components = [];
    for (const [key, cells] of groups) {
      const seen = new Set();
      for (const start of cells.keys()) {
        if (seen.has(start)) continue;
        seen.add(start);
        const stack = [start];
        const members = [];
        while (stack.length) {
          const member = cells.get(stack.pop());
          members.push(member);
          for (const [dr, dc] of NEIGHBORS) {
            const r = member.r + dr;
            const c = member.c + dc;
            if (r < 0 || c < 0 || r >= Grid.S2_HEIGHT || c >= Grid.S2_WIDTH) continue;
            const next = r * Grid.S2_WIDTH + c;
            if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
          }
        }
        const first = members.reduce((a, m) => (m.r < a.r || (m.r === a.r && m.c < a.c) ? m : a));
        components.push({ key, members, minR: first.r, minC: first.c });
      }
    }

    components.sort((a, b) =>
      a.minR - b.minR || a.minC - b.minC || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const byCell = new Map();
    const fields = components.map((component, i) => {
      const field_id = 'F' + String(i + 1).padStart(4, '0');
      const plotIdxs = new Set();
      for (const m of component.members) {
        byCell.set(`${m.season.id}#${m.cellIdx}`, field_id);
        plotIdxs.add(m.plotIdx);
      }
      return {
        field_id,
        season: component.members[0].season,
        cell_count: component.members.length,
        plot_idxs: [...plotIdxs].sort((a, b) => a - b),
      };
    });

    return { fields, fieldIdFor: (seasonId, cellIdx) => byCell.get(`${seasonId}#${cellIdx}`) || '' };
  }

  const api = { computeFields };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_FIELDS = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/field-ids.test.mjs`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add field-ids.js tests/field-ids.test.mjs
git commit -m "feat: compute cross-plot field ids at export"
```

### Task 9: `label-export.js`

**Files:**
- Create: `label-export.js`
- Test: `tests/label-export.test.mjs`
- Delete: `crop-export.js`, `tests/crop-export.test.mjs`

- [ ] **Step 1: Write the failing test** in `tests/label-export.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/label-export.test.mjs`
Expected: FAIL with `Cannot find module '../label-export.js'`

- [ ] **Step 3: Write `label-export.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/label-export.test.mjs`
Expected: all tests pass. If the `16\.64` center regex fails, print the row and compare it with `Grid.cellLatLng(plot0, 0)`; the latitude should be about 16.64099.

- [ ] **Step 5: Delete the old exporter and its test, then commit**

```bash
git rm crop-export.js tests/crop-export.test.mjs
git add label-export.js tests/label-export.test.mjs
git commit -m "feat: add class/field export builders"
```

---

## Chunk 3: Network layer and app integration

From here on, the existing source-regex tests (e.g. `tests/season-state-source.test.mjs`) will start failing as `app.js` changes. **Ignore failures in the old test files until Task 21**, which updates or deletes them. Run only the new test files as you go:

```bash
node --test tests/grid.test.mjs tests/classes.test.mjs tests/season-outbox.test.mjs tests/field-ids.test.mjs tests/label-export.test.mjs
```

### Task 10: Rewrite `supabase-sync.js`

**Files:**
- Rewrite: `supabase-sync.js`

- [ ] **Step 1: Replace the whole file** with:

```js
// supabase-sync.js
// Network calls only. Seasons are read from public.seasons and written through
// the apply_season_cells RPC; plot notes/photos live in public.plots.
// Every failing call throws an Error carrying {code, status} so callers can
// classify it with TANIMAN_OUTBOX.classifySyncError.

(function () {
  'use strict';
  if (window.__TAURI__) return;

  let db = null;
  const SEASON_COLUMNS = 'id,plot_idx,class_id,crop_id,remark,start_mmdd,end_mmdd,cells,updated_at';
  const PAGE_SIZE = 1000;

  function isOnline() {
    return navigator.onLine && typeof supabase !== 'undefined';
  }

  function initClient() {
    if (db) return db;
    if (typeof supabase === 'undefined') return null;
    db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return db;
  }

  function requireClient() {
    const client = isOnline() ? initClient() : null;
    if (!client) throw Object.assign(new Error('offline'), { status: 0 });
    return client;
  }

  function syncError(error, status) {
    return Object.assign(new Error(error.message || 'Supabase request failed'), {
      code: error.code, status, details: error.details,
    });
  }

  function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  }

  // ── Crop names (class 4) ─────────────────────────────────────────
  window.fetchCustomCrops = async function () {
    const { data, error, status } = await requireClient().from('crops')
      .select('id,name,hex,created_at').order('name');
    if (error) throw syncError(error, status);
    return data || [];
  };

  window.insertCustomCrop = async function (name, hex) {
    const { data, error, status } = await requireClient().from('crops')
      .insert({ name, hex }).select('id,name,hex,created_at').single();
    if (error) throw syncError(error, status);
    return data;
  };

  window.deleteCustomCrop = async function (id) {
    if (!isUuid(id)) throw new Error('Custom crop ID must be a UUID.');
    const { data, error, status } = await requireClient().rpc('delete_crop', { p_crop_id: id });
    if (error) throw syncError(error, status);
    const count = Number(data);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  };

  // ── Seasons ──────────────────────────────────────────────────────
  window.fetchAllSeasons = async function () {
    const client = requireClient();
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error, status } = await client.from('seasons')
        .select(SEASON_COLUMNS).order('id').range(from, from + PAGE_SIZE - 1);
      if (error) throw syncError(error, status);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  };

  window.fetchPlotSeasons = async function (plotIdx) {
    const { data, error, status } = await requireClient().from('seasons')
      .select(SEASON_COLUMNS).eq('plot_idx', plotIdx);
    if (error) throw syncError(error, status);
    return data || [];
  };

  // Returns the season row after the change, or null if it no longer exists.
  window.applySeasonCells = async function (delta) {
    const { data, error, status } = await requireClient().rpc('apply_season_cells', {
      p_id: delta.id,
      p_plot_idx: delta.plotIdx,
      p_class_id: delta.classId,
      p_crop_id: delta.cropId,
      p_remark: delta.remark || null,
      p_start: delta.start,
      p_end: delta.end,
      p_add: delta.add,
      p_remove: delta.remove,
    });
    if (error) throw syncError(error, status);
    return data && data.id ? data : null;
  };

  window.clearPlotRemote = async function (plotIdx) {
    const { error, status } = await requireClient().rpc('clear_plot', { p_plot_idx: plotIdx });
    if (error) throw syncError(error, status);
  };

  // ── Plot notes and photos ────────────────────────────────────────
  function encodePhotos(photos) {
    const urls = (photos || []).map(p => p && p.url).filter(u => u != null);
    if (!urls.length) return null;
    return urls.length === 1 ? urls[0] : JSON.stringify(urls);
  }

  function decodePhotos(photoUrl) {
    if (!photoUrl) return [];
    if (photoUrl.startsWith('[')) {
      try {
        return JSON.parse(photoUrl).map(url => ({ url, dataUrl: null }));
      } catch (e) {
        return [{ url: photoUrl, dataUrl: null }];
      }
    }
    return [{ url: photoUrl, dataUrl: null }];
  }
  window.decodePhotos = decodePhotos;

  window.fetchPlotMeta = async function () {
    const { data, error, status } = await requireClient().from('plots')
      .select('plot_idx,note,photo_url,updated_at');
    if (error) throw syncError(error, status);
    return data || [];
  };

  window.upsertPlotMeta = async function (plotIdx, plotData) {
    try {
      const { error } = await requireClient().from('plots').upsert({
        plot_idx: plotIdx,
        note: plotData.note || '',
        photo_url: encodePhotos(plotData.photos),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plot_idx' });
      if (error) { console.warn('upsertPlotMeta error:', error.message); return false; }
      return true;
    } catch (e) {
      console.warn('upsertPlotMeta error:', e);
      return false;
    }
  };

  window.uploadPhoto = async function (plotIdx, dataUrl, suffix) {
    let client;
    try { client = requireClient(); } catch (e) { return null; }
    try {
      const byteStr = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const path = `plot_${String(plotIdx).padStart(3, '0')}_${suffix || Date.now()}.jpg`;
      const { error } = await client.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) { console.warn('uploadPhoto error:', error.message); return null; }
      return client.storage.from('photos').getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.warn('uploadPhoto error:', e);
      return null;
    }
  };
})();
```

- [ ] **Step 2: Write a test against a fake Supabase client** in `tests/supabase-sync.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');
// Objects created inside the vm have a different Object.prototype; compare as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function load(fake) {
  const window = {};
  const context = {
    window, console, atob, Blob,
    navigator: { onLine: true },
    supabase: { createClient: () => fake },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return window;
}

function fakeClient({ rpc = async () => ({ data: null, error: null, status: 200 }), pages = [] } = {}) {
  const calls = [];
  let page = 0;
  const builder = {
    select() { return builder; },
    order() { return builder; },
    eq(...args) { calls.push(['eq', ...args]); return Promise.resolve({ data: pages[0] || [], error: null, status: 200 }); },
    range(from, to) { calls.push(['range', from, to]); return Promise.resolve({ data: pages[page++] || [], error: null, status: 200 }); },
  };
  return {
    calls,
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return rpc(name, args); },
    from: table => { calls.push(['from', table]); return builder; },
  };
}

const delta = {
  id: 'p0|2||03-01|06-30|', plotIdx: 0, classId: 2, cropId: null, remark: '',
  start: '03-01', end: '06-30', add: [1, 2], remove: [3],
};

test('applySeasonCells maps the delta to RPC arguments and returns the row', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: { id: delta.id, cells: [1, 2] }, error: null, status: 200 }) });
  const row = await load(fake).applySeasonCells(delta);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'apply_season_cells', {
    p_id: delta.id, p_plot_idx: 0, p_class_id: 2, p_crop_id: null, p_remark: null,
    p_start: '03-01', p_end: '06-30', p_add: [1, 2], p_remove: [3],
  }]);
  assert.deepEqual(row, { id: delta.id, cells: [1, 2] });
});

test('a deleted season comes back as null', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: { id: null, cells: null }, error: null, status: 200 }) });
  assert.equal(await load(fake).applySeasonCells(delta), null);
});

test('errors carry the Postgres code and HTTP status', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: null, error: { message: 'fk', code: '23503' }, status: 409 }) });
  await assert.rejects(load(fake).applySeasonCells(delta), err => err.code === '23503' && err.status === 409);
});

test('offline calls throw a retryable error', async () => {
  const window = {};
  const context = { window, console, navigator: { onLine: false }, supabase: { createClient: () => fakeClient() } };
  vm.createContext(context);
  vm.runInContext(source, context);
  await assert.rejects(window.applySeasonCells(delta), err => err.status === 0);
});

test('crop deletion uses the delete_crop RPC', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: 4, error: null, status: 200 }) });
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(await load(fake).deleteCustomCrop(id), 4);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'delete_crop', { p_crop_id: id }]);
});

test('fetchAllSeasons pages through more than 1000 rows', async () => {
  const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` }));
  const fake = fakeClient({ pages: [fullPage, [{ id: 'last' }]] });
  const rows = await load(fake).fetchAllSeasons();
  assert.equal(rows.length, 1001);
  assert.deepEqual(fake.calls.filter(c => c[0] === 'range'), [['range', 0, 999], ['range', 1000, 1999]]);
});

test('clear_plot is called with the plot index', async () => {
  const fake = fakeClient();
  await load(fake).clearPlotRemote(14);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'clear_plot', { p_plot_idx: 14 }]);
});
```

- [ ] **Step 3: Run it**

Run: `node --test tests/supabase-sync.test.mjs`
Expected: all tests pass. (Write the test first if you prefer strict TDD; the implementation above already satisfies it.)

- [ ] **Step 4: Commit**

```bash
git add supabase-sync.js tests/supabase-sync.test.mjs
git commit -m "feat: sync seasons through apply_season_cells RPC"
```

### Task 11: Crop catalog holds class-4 crop names only

**Files:**
- Modify: `crop-catalog.js`
- Modify: `crop-picker.js`

- [ ] **Step 1: Make the edits in `crop-catalog.js`:**

1. Change the cache key (the id format changes): `const CACHE_KEY = 'taniman_custom_crops_v2';`
2. Replace these lines:
   ```js
   const crops = Array.isArray(window.CROPS) ? window.CROPS : [];
   const targets = crops.map(crop => ({ ...crop, isTarget: true, isResolved: true }));
   const targetById = new Map(targets.map(crop => [crop.id, crop]));
   ```
   with:
   ```js
   // Class 4 "Other cultivated" crop names only. Carrot, cabbage and potato are
   // classes now (classes.js), so there are no target crops in this catalog.
   const crops = [];
   const targets = [];
   const targetById = new Map();
   ```
3. In `cropFromRow`, change `id: \`crop_${row.id}\`,` to `id: row.id,`.
4. In `rawRows`, change `id: crop.id.slice('crop_'.length),` to `id: crop.id,`.
5. Replace the loop that fills `targetNames` from `targets` (the `for (const target of targets) { ... }` block) with:
   ```js
   const reservedNames = (window.TANIMAN_CLASSES && window.TANIMAN_CLASSES.RESERVED_CROP_NAMES) || [];
   for (const name of reservedNames) targetNames.add(nameKey(name));
   ```
6. In `validateNewCrop`, change the reserved-name error to `'Carrot, cabbage and potato are classes. Pick them under Class.'`.
7. In `remove`, replace
   ```js
   if (!id.startsWith('crop_') || !isUuid(id.slice('crop_'.length)) || !customById.has(id)) {
   ```
   with `if (!isUuid(id) || !customById.has(id)) {`, and change `await window.deleteCustomCrop(id.slice('crop_'.length))` to `await window.deleteCustomCrop(id)`.

- [ ] **Step 2: Make the edit in `crop-picker.js`.** In `render()`, change `targetGroup.hidden = false;` to:

```js
      targetGroup.hidden = targetCrops().length === 0;
```

- [ ] **Step 3: Syntax check**

Run: `node --check crop-catalog.js && node --check crop-picker.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add crop-catalog.js crop-picker.js
git commit -m "feat: scope shared crop catalog to class-4 crop names"
```

### Task 12: Class picker module

**Files:**
- Create: `class-picker.js`

- [ ] **Step 1: Write `class-picker.js`**

```js
// Class buttons plus the "Other" remark input. Reuses the .crop-btn styles.
(function () {
  'use strict';

  function create({ root, remarkField, remarkInput, remarkLabel, classes, onSelect, onRemark }) {
    remarkInput.addEventListener('input', () => onRemark(remarkInput.value));

    function button(cls, selected, lang) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crop-btn' + (selected ? ' on' : '');
      b.dataset.classKey = cls.key;
      b.setAttribute('aria-pressed', String(selected));
      if (selected) b.style.borderColor = cls.hex;
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = cls.hex;
      swatch.setAttribute('aria-hidden', 'true');
      const info = document.createElement('span');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = cls.name[lang] || cls.name.en;
      info.append(name);
      const check = document.createElement('span');
      check.className = 'chk';
      check.textContent = selected ? '✓' : '';
      check.setAttribute('aria-hidden', 'true');
      b.append(swatch, info, check);
      b.addEventListener('click', () => onSelect(cls.key));
      return b;
    }

    function render({ classKey, remark, lang, tr }) {
      root.replaceChildren(...classes.map(cls => button(cls, cls.key === classKey, lang)));
      remarkField.hidden = classKey !== 'other';
      remarkLabel.textContent = tr('remarkLabel');
      remarkInput.placeholder = tr('remarkPlaceholder');
      if (document.activeElement !== remarkInput && remarkInput.value !== (remark || '')) {
        remarkInput.value = remark || '';
      }
    }

    return { render };
  }

  window.TANIMAN_CLASS_PICKER = { create };
})();
```

- [ ] **Step 2: Commit**

```bash
git add class-picker.js
git commit -m "feat: add land-cover class picker"
```

### Task 13: HTML, styles and strings

**Files:**
- Modify: `taniman.html`
- Modify: `styles.css`
- Modify: `data.js` (the strings only; the generated block was written in Task 3)

- [ ] **Step 1: Make the `taniman.html` edits:**

1. **Header:** delete the `<button class="hdr-action" id="roster-btn">…</button>` element.
2. **Editor title:** delete the `<span class="ed-farmer-chip empty" id="ed-farmer-chip">…</span>` element.
3. **Canvas:** inside `<div class="canvas-frame" id="canvas-frame">`, after the `brush-cursor` div, add:
   ```html
   <div class="canvas-prompt" id="canvas-prompt" role="status" aria-live="polite" hidden></div>
   ```
4. **Tools:** replace the whole second `<div class="tools-section">` (the one containing `id="lab-crop"` and `id="crop-picker"`) with the block below. The inner `#crop-picker` markup stays exactly as it is today:
   ```html
   <div class="tools-section">
     <div class="tools-label" id="lab-class">Class</div>
     <div class="crop-grid" id="class-picker" role="group" aria-labelledby="lab-class"></div>
     <div class="field remark-field" id="other-remark-field" hidden>
       <label id="other-remark-label" for="other-remark">What is it?</label>
       <input id="other-remark" type="text" maxlength="200" autocomplete="off">
     </div>
   </div>

   <div class="tools-section" id="crop-name-section" hidden>
     <div class="tools-label" id="lab-crop">Crop name</div>
     <div class="crop-picker" id="crop-picker">
       <!-- existing crop-target-group and crop-other-group markup, unchanged -->
     </div>
   </div>
   ```
5. **Drawer:** delete the two farmer `<div class="field">` blocks (the "Farmer ID + Name" comment, `in-farmer-id`, `in-farmer`).
6. **Roster:** delete the whole `<!-- ROSTER MODAL -->` `<aside class="modal" id="roster-modal">…</aside>`.
7. **Scripts:** replace `<script src="crop-export.js"></script>` and make the module script order this:
   ```html
   <script src="data.js"></script>
   <script src="config.js"></script>
   <script src="month-view-utils.js"></script>
   <script src="season-utils.js"></script>
   <script src="grid.js"></script>
   <script src="classes.js"></script>
   <script src="season-outbox.js"></script>
   <script src="field-ids.js"></script>
   <script src="label-export.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   <script src="supabase-sync.js"></script>
   <script src="offline-storage.js"></script>
   <script src="crop-catalog.js"></script>
   <script src="crop-picker.js"></script>
   <script src="class-picker.js"></script>
   ```

- [ ] **Step 2: Append to `styles.css`**

```css
/* Painting prompt shown over the canvas until the brush selection is complete */
.canvas-prompt {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  max-width: calc(100% - 24px);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(10, 20, 10, 0.86);
  color: #F2C84B;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
  text-align: center;
  z-index: 3;
}
.canvas-prompt.flash { animation: canvas-prompt-flash 0.5s ease 2; }
@keyframes canvas-prompt-flash { 50% { background: rgba(242, 200, 75, 0.95); color: #0A1A0A; } }
.remark-field { margin-top: 10px; }
.remark-field input { width: 100%; }
```

Check that `.canvas-frame` already has `position: relative` (search `styles.css`). If it doesn't, add `.canvas-frame { position: relative; }`.

- [ ] **Step 3: Make the `data.js` string edits** (outside the generated block). `window.STRINGS` is built by merging `window.STRINGS_LEGACY` with the newer keys (see the loop near the end of the file), so check both objects.

1. Delete `window.CROPS = [...]` entirely (classes now live in `classes.js`).
2. In **every** language (`en`, `tl`, `il`) of both `STRINGS` and `STRINGS_LEGACY`, delete these keys: `farmerId`, `farmerIdPh`, `farmer`, `farmerPh`, `noFarmer`, `roster`, `rosterFarmers`, `rosterUnassigned`, `rosterEmpty`, `rosterNoId`, `rosterNoName`.
3. Add these keys to `STRINGS.en`, `STRINGS.tl` and `STRINGS.il`. The Tagalog and Ilocano values are best guesses; the team will verify them.

   | key | en | tl | il |
   |---|---|---|---|
   | `classLabel` | `Class` | `Uri` | `Kita` |
   | `cropNameLabel2` | `Crop name` | `Pangalan ng pananim` | `Nagan ti mula` |
   | `remarkLabel` | `What is it?` | `Ano ito?` | `Ania daytoy?` |
   | `remarkPlaceholder` | `e.g. greenhouse, river, unsure` | `hal. greenhouse, ilog, hindi sigurado` | `kas pagarigan: greenhouse, karayan, saan a sigurado` |
   | `pickClass` | `Pick a class to start painting` | `Pumili ng uri para magsimula` | `Agpili iti kita tapno mangrugi` |
   | `pickCropName` | `Pick or add a crop name` | `Pumili o magdagdag ng pananim` | `Agpili wenno agnayon iti mula` |
   | `typeRemark` | `Type what it is first` | `Isulat muna kung ano ito` | `Isurat pay no ania daytoy` |
   | `pickDates` | `Pick when it was planted and harvested` | `Piliin kung kailan itinanim at inani` | `Pilien no kaano a naimula ken naapit` |
   | `syncDropped` | `A change couldn't be saved; the plot was reloaded.` | `Hindi na-save ang isang pagbabago; ni-reload ang plot.` | `Saan a naidulin ti maysa a panagbalbaliw; naikarga manen ti plot.` |

4. Change `cropOtherCrops` (en) to `'Crop names'`. Change `cropTargetNameExists` (en) to `'That is a class. Pick it under Class.'` and update tl/il to match in meaning.

- [ ] **Step 4: Check that the strings load**

Run: `node -e "const vm=require('vm');const c={window:{}};vm.runInNewContext(require('fs').readFileSync('data.js','utf8'),c);const S=c.window.STRINGS;console.log(['en','tl','il'].map(l=>!!S[l].pickDates&&!S[l].farmerId).join(','), 'CROPS' in c.window)"`
Expected: `true,true,true false`

- [ ] **Step 5: Commit**

```bash
git add taniman.html styles.css data.js
git commit -m "feat: class picker markup, painting prompt, remove farmer UI"
```

### Task 14: `app.js`, part 1: config, state and data queries

**Files:**
- Modify: `app.js` (line numbers refer to the file before this task; search by the quoted code if they have shifted)

- [ ] **Step 1: Replace the CONFIG block** (from `// ── CONFIG` through the end of `classifyZone`, roughly lines 5–61) with:

```js
// ── CONFIG ────────────────────────────────────────────────────────
const GRID = 50;
const STORAGE_KEY = 'taniman_v6_s2grid';
const ATOK_POLY = window.ATOK_POLY;
const PAOAY_POLY = window.PAOAY_POLY;
const PLOTS = window.PLOTS;
const GridMath = window.TANIMAN_GRID;
const Classes = window.TANIMAN_CLASSES;
const Outbox = window.TANIMAN_OUTBOX;
const LabelExport = window.TANIMAN_LABEL_EXPORT;
const CROPS = window.CROPS;                 // set by crop-catalog.js: class-4 crop names only
const CropCatalog = window.TANIMAN_CROP_CATALOG;
const T     = window.STRINGS;
const GRID_BOUNDS = GridMath.gridBoundsLatLng(PLOTS);
const GEOMETRY_EPSILON = 1e-12;
```

Then update the file header comment (lines 1–3) to:

```js
// ── Taniman v6 ───────────────────────────────────────────────────
// Sentinel-2 aligned grid (one cell = one 10 m pixel), land-cover classes,
// per-season sync through the apply_season_cells RPC.
```

- [ ] **Step 2: Replace the STATE block** (from `const state = loadState() || {` through `if (!PLOTS[state.plotIdx]) state.plotIdx = 0;`) with:

```js
// ── STATE ─────────────────────────────────────────────────────────
const state = loadState() || {
  lang: 'en',
  theme: 'dark',
  brush: 1,
  plotIdx: 0,
  plots: {},
  viewMonth: -1,              // -1 = all months; 0..11 = scrub to month
  viewMonths: ALL_MONTHS,     // mask of months displayed on map/canvas
  mixedStyle: 'diagonal',
  showTweaks: false,
  version: 6,
};
// Every session starts with nothing selected (spec section 4): the brush
// selection and dates are never restored from storage.
state.selection = { classKey: null, cropId: null, remark: '' };
state.paintStartDate = null;
state.paintEndDate = null;
state.datesAuto = false;
delete state.selectedCropId;
delete state.crop;

if (!state.plots || typeof state.plots !== 'object' || Array.isArray(state.plots)) state.plots = {};
CropCatalog.registerReferences(state.plots);
if (state.viewMonth === undefined) state.viewMonth = -1;
state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth);
state.viewMonth = viewMonthFromMask(state.viewMonths);
if (!state.mixedStyle) state.mixedStyle = 'diagonal';
if (!PLOTS[state.plotIdx]) state.plotIdx = 0;
```

In the `SeasonUtils` destructuring just above it, remove `seasonExportRows` (it no longer exists after Task 20).

- [ ] **Step 3: Replace the per-plot structure block** (from `// Per-plot data structure:` through the end of `const DEVICE_ID = getDeviceId();`) with:

```js
// Per-plot data structure:
//   p.seasons = [{ id, classId, cropId, remark, start, end, cells }]
//     id is deterministic: Classes.seasonId(plotIdx, meta)
//   p.note, p.photos
function emptySeasons() { return []; }
function ensurePlot(idx) {
  let p = state.plots[idx];
  if (!p) p = state.plots[idx] = { seasons: emptySeasons(), note: '', photos: [] };
  if (!Array.isArray(p.seasons)) p.seasons = [];
  if (p.note === undefined) p.note = '';
  if (p.photos === undefined) p.photos = [];
  delete p.farmerId;
  delete p.farmer;
  return p;
}
```

- [ ] **Step 4: Update `saveState`** so it never persists the selection, and stores the outbox and the dirty-meta list. Replace the body's `const out = { ...state, plots:{} };` line with:

```js
    const out = { ...state, plots:{}, outbox: outbox.toJSON(), metaDirty: [...metaDirty] };
    delete out.selection;
    delete out.paintStartDate;
    delete out.paintEndDate;
    delete out.datesAuto;
    delete out.paintMonths;
```

`outbox` and `metaDirty` are declared in Task 15. `saveState` only runs after the module has loaded, so declaring them later in the file is fine.

- [ ] **Step 5: Replace the CELL DATA QUERIES helpers.** Delete `cropIndexFromId`, `activePaintSeasonData`, `isCropSelected`, `cropsForPalette`, `cellVisibleCropIds`, `cellVisibleCrops` and `plotCompositionForView`, and add the code below in their place. Keep `escapeHtml`, `monthRangeForViewMonth`, `seasonIntersectsViewMonths`, `seasonMonthsMask` and `activePaintMonthsMask`.

```js
function seasonHex(season) {
  return Classes.seasonColor(season, CropCatalog);
}
function currentSelectionStatus() {
  return Classes.selectionStatus(
    { ...state.selection, start: state.paintStartDate, end: state.paintEndDate },
    id => CropCatalog.isResolved(id));
}
function activePaintSeasonData() {
  return Classes.paintMeta(
    { ...state.selection, start: state.paintStartDate, end: state.paintEndDate },
    id => CropCatalog.isResolved(id));
}
function cellVisibleColors(p, cellIdx, viewMonths = state.viewMonths) {
  const out = [];
  const seen = new Set();
  for (const season of p.seasons || []) {
    if (!Array.isArray(season.cells) || !season.cells.includes(cellIdx)) continue;
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    const hex = seasonHex(season);
    if (!seen.has(hex)) { seen.add(hex); out.push(hex); }
  }
  return out;
}
function plotCompositionForView(idx, viewMonths = state.viewMonths) {
  const plot = PLOTS[idx];
  const p = state.plots[idx];
  const gridCells = GridMath.validCellCount(plot);
  const counts = new Array(Classes.ALL.length).fill(0);
  const percentages = new Array(Classes.ALL.length).fill(0);
  const visibleCells = new Set();
  const seen = new Set();
  for (const season of (p && p.seasons) || []) {
    if (!seasonIntersectsViewMonths(season, viewMonths)) continue;
    const legendIdx = Classes.legendIndex(season.classId);
    for (const cellIdx of season.cells || []) {
      if (!GridMath.isCellInBounds(plot, cellIdx)) continue;
      const key = `${legendIdx}:${cellIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[legendIdx]++;
      visibleCells.add(cellIdx);
    }
  }
  const totalVisibleCells = counts.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < counts.length; i++) percentages[i] = totalVisibleCells ? counts[i] / totalVisibleCells : 0;
  const max = Math.max(...counts);
  const topIdx = max > 0 ? counts.indexOf(max) : -1;
  const nonZero = counts.filter(n => n > 0).length;
  return {
    top: topIdx >= 0 ? Classes.ALL[topIdx] : null,
    counts,
    percentages,
    totalVisibleCells,
    visiblePaintedCells: visibleCells.size,
    emptyCells: Math.max(0, gridCells - visibleCells.size),
    nonZeroCropCount: nonZero,
    isMixed: nonZero > 1,
  };
}
```

- [ ] **Step 6: Update `plotHasData`** to:

```js
function plotHasData(idx) {
  const p = state.plots[idx];
  if (!p) return false;
  return plotHasPaint(idx) || p.note || (p.photos && p.photos.length);
}
```

- [ ] **Step 7: Update `drawMixedCell`** so it takes colors instead of crop indexes. Rename the parameter `cropIdxs` to `colors` and replace every `CROPS[cropIdxs[...]].hex` with `colors[...]`. For example, `ctx.fillStyle = CROPS[cropIdxs[0]].hex;` becomes `ctx.fillStyle = colors[0];`, and `CROPS[cropIdxs[order[i]]].hex` becomes `colors[order[i]]`.

- [ ] **Step 8: Syntax check and commit**

Run: `node --check app.js`
Expected: no output. Runtime errors from references to `outbox` and other functions not added yet are expected until Task 15.

```bash
git add app.js
git commit -m "refactor: class-based state and composition in app.js"
```

### Task 15: `app.js`, part 2: cloud sync, undo, painting

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace the whole CLOUD SYNC section** (from `// ── CLOUD SYNC` through the end of `restoreCloudDirtyQueue`) with:

```js
// ── CLOUD SYNC ───────────────────────────────────────────────────
// Season cells sync as per-season deltas through apply_season_cells (spec
// section 8). Plot note/photos sync as a slim plots row. The outbox is saved
// with state so unsent edits survive reloads.
const outbox = Outbox.create(state.outbox);
const metaDirty = new Set(Array.isArray(state.metaDirty) ? state.metaDirty : []);
delete state.outbox;
delete state.metaDirty;
let cloudTimer = null;
let flushPromise = null;
const CLOUD_SYNC_DELAY = 1500;
const CLOUD_RETRY_DELAY = 30000;

function hasCloud() { return typeof window.applySeasonCells === 'function'; }
// Queued or in flight: the local copy of this season is newer than the server's.
function isSeasonPending(id) { return outbox.has(id); }
function hasPendingPhotoUpload(idx) {
  const p = state.plots[idx];
  return !!(p && p.photos && p.photos.some(ph => ph && ph.dataUrl && !ph.url));
}

function scheduleCloudFlush(delay = CLOUD_SYNC_DELAY) {
  if (!hasCloud()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    flushCloudSync().catch(e => console.warn('cloud sync failed:', e));
  }, delay);
}

function queueSeasonChange(plotIdx, season, add, remove) {
  outbox.record(Outbox.metaFromSeason(plotIdx, season), add, remove);
  scheduleCloudFlush();
}

function queueMetaChange(plotIdx) {
  metaDirty.add(plotIdx);
  scheduleCloudFlush();
}

function afterRemoteChange(idx) {
  CropCatalog.registerReferences(state.plots);
  updateMapPlot(idx);
  if (idx === state.plotIdx) {
    renderCanvas();
    updatePlotHeader();
    refreshMetaToggle();
    if (drawer && drawer.classList.contains('on')) renderScheduleSummary();
  }
  updateProgress();
  schedSave();
}

function applyServerSeason(plotIdx, seasonId, row) {
  const p = ensurePlot(plotIdx);
  const i = p.seasons.findIndex(s => s.id === seasonId);
  if (!row) {
    if (i >= 0) p.seasons.splice(i, 1);
  } else if (i >= 0) {
    p.seasons[i] = Outbox.seasonFromRow(row);
  } else {
    p.seasons.push(Outbox.seasonFromRow(row));
  }
  afterRemoteChange(plotIdx);
}

async function refreshPlotFromServer(idx) {
  if (typeof window.fetchPlotSeasons !== 'function') return;
  try {
    const rows = await window.fetchPlotSeasons(idx);
    const p = ensurePlot(idx);
    p.seasons = Outbox.mergeRemoteSeasons(p.seasons, rows.map(Outbox.seasonFromRow), isSeasonPending);
    clearUndoForPlot(idx);
    afterRemoteChange(idx);
  } catch (e) {
    console.warn('plot refresh failed:', e);
  }
}

async function uploadPendingPhotos(idx) {
  if (typeof window.uploadPhoto !== 'function') return false;
  const p = ensurePlot(idx);
  let changed = false;
  for (let i = 0; i < p.photos.length; i++) {
    const ph = p.photos[i];
    if (!ph || ph.url || !ph.dataUrl) continue;
    const url = await window.uploadPhoto(idx, ph.dataUrl, `${Date.now()}_${i}`);
    if (url) {
      p.photos[i] = { ...ph, url };
      changed = true;
    }
  }
  return changed;
}

// Only one flush runs at a time; callers that need it finished await this.
function flushCloudSync() {
  if (!hasCloud()) return Promise.resolve();
  if (!flushPromise) flushPromise = runCloudFlush().finally(() => { flushPromise = null; });
  return flushPromise;
}

async function runCloudFlush() {
  let retry = false;
  try {
    ({ retry } = await Outbox.flush(outbox, {
      send: delta => window.applySeasonCells(delta),
      onRow: (delta, row) => applyServerSeason(delta.plotIdx, delta.id, row),
      onPermanent: async (delta, error) => {
        console.warn('dropping a change the server rejected:', error);
        // A crop name deleted here makes its in-flight deltas fail; that is expected.
        const cropDeleted = delta.cropId && !CropCatalog.isResolved(delta.cropId);
        if (!cropDeleted) toast(tr('syncDropped'));
        await refreshPlotFromServer(delta.plotIdx);
      },
    }));
    for (const idx of [...metaDirty]) {
      await uploadPendingPhotos(idx);
      const ok = await window.upsertPlotMeta(idx, ensurePlot(idx));
      if (ok && !hasPendingPhotoUpload(idx)) metaDirty.delete(idx);
      else retry = true;
    }
  } finally {
    saveState();
    if (retry) scheduleCloudFlush(CLOUD_RETRY_DELAY);
    else if (outbox.size() || metaDirty.size) scheduleCloudFlush();
  }
}

async function initialCloudLoad() {
  if (typeof window.fetchAllSeasons !== 'function') return;
  try {
    const [seasonRows, metaRows] = await Promise.all([window.fetchAllSeasons(), window.fetchPlotMeta()]);
    const byPlot = new Map();
    for (const row of seasonRows) {
      if (!byPlot.has(row.plot_idx)) byPlot.set(row.plot_idx, []);
      byPlot.get(row.plot_idx).push(Outbox.seasonFromRow(row));
    }
    for (const plot of PLOTS) {
      const remote = byPlot.get(plot.idx) || [];
      if (!state.plots[plot.idx] && !remote.length) continue;
      const p = ensurePlot(plot.idx);
      p.seasons = Outbox.mergeRemoteSeasons(p.seasons, remote, isSeasonPending);
    }
    for (const row of metaRows) {
      if (metaDirty.has(row.plot_idx)) continue;
      const p = ensurePlot(row.plot_idx);
      p.note = row.note || '';
      p.photos = window.decodePhotos(row.photo_url);
    }
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoBtn();
    CropCatalog.registerReferences(state.plots);
    drawPlotsOnMap();
    renderCanvas();
    updatePlotHeader();
    refreshMetaToggle();
    updateProgress();
    saveState();
  } catch (e) {
    console.warn('initial sync failed:', e);
  }
  scheduleCloudFlush(0);
}

function savePlotChange() {
  schedSave();
}
```

- [ ] **Step 2: Replace the UNDO section's `undo`, `redo` and helpers** (keep `undoStack`, `redoStack`, `UNDO_LIMIT`, `cloneSeasons`, `snapshotForUndo` and `updateUndoBtn`) with:

```js
function restoreSeasonsSnapshot(idx, seasons) {
  const p = ensurePlot(idx);
  for (const delta of Outbox.diffSeasons(idx, p.seasons, seasons)) {
    outbox.record(delta.meta, delta.add, delta.remove);
  }
  p.seasons = cloneSeasons(seasons);
  scheduleCloudFlush();
}
function clearUndoForPlot(idx) {
  for (const stack of [undoStack, redoStack]) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].plotIdx === idx) stack.splice(i, 1);
  }
  updateUndoBtn();
}
function applyUndoEntry(e, pushTo) {
  const p = ensurePlot(e.plotIdx);
  pushTo.push({ plotIdx: e.plotIdx, seasons: cloneSeasons(p.seasons) });
  if (pushTo.length > UNDO_LIMIT) pushTo.shift();
  restoreSeasonsSnapshot(e.plotIdx, e.seasons);
  CropCatalog.registerReferences(state.plots);
  if (state.plotIdx !== e.plotIdx) { state.plotIdx = e.plotIdx; updatePlotHeader(); drawPlotsOnMap(); }
  else updateMapPlot(e.plotIdx);
  renderCanvas(); updateProgress(); refreshMetaToggle(); updateUndoBtn();
  schedSave();
}
function undo() {
  const e = undoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  applyUndoEntry(e, redoStack);
  toast(tr('undone'));
}
function redo() {
  const e = redoStack.pop();
  if (!e) { updateUndoBtn(); return; }
  applyUndoEntry(e, undoStack);
}
```

- [ ] **Step 3: Replace the PAINTING helpers** `addCellsToPaintSeason`, `eraseCellsFromSeasons` and `paintAt` with:

```js
function addCellsToPaintSeason(idx, p, cellIds) {
  const meta = activePaintSeasonData();
  if (!meta || !cellIds.length) return false;
  const id = Classes.seasonId(idx, meta);
  let season = p.seasons.find(s => s.id === id);
  if (!season) {
    season = { id, ...meta, cells: [] };
    p.seasons.push(season);
  }
  const cells = new Set(season.cells);
  const added = cellIds.filter(c => !cells.has(c));
  if (!added.length) return false;
  for (const c of added) cells.add(c);
  season.cells = [...cells].sort((a, b) => a - b);
  queueSeasonChange(idx, season, added, []);
  return true;
}
function eraseCellsFromSeasons(idx, p, cellIds) {
  const remove = new Set(cellIds);
  let changed = false;
  for (const season of p.seasons) {
    const removed = (season.cells || []).filter(c => remove.has(c));
    if (!removed.length) continue;
    season.cells = season.cells.filter(c => !remove.has(c));
    queueSeasonChange(idx, season, [], removed);
    changed = true;
  }
  p.seasons = p.seasons.filter(season => season.cells && season.cells.length);
  return changed;
}
function flashPaintPrompt() {
  const el = document.getElementById('canvas-prompt');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;  // restart the animation
  el.classList.add('flash');
}
function paintAt(clientX, clientY){
  const cell = cellAt(clientX, clientY);
  if (!cell) return;
  const linear = cell.r*GRID + cell.c;
  if (linear === lastIdx) return;
  lastIdx = linear;

  const idx = state.plotIdx;
  const plot = PLOTS[idx];
  if (state.brush !== 'erase' && !activePaintSeasonData()) { flashPaintPrompt(); return; }
  const p = ensurePlot(idx);
  const size = state.brush==='erase' ? 1 : state.brush;
  const cellIds = GridMath.brushCells(plot, cell.r, cell.c, size);
  const changed = state.brush === 'erase'
    ? eraseCellsFromSeasons(idx, p, cellIds)
    : addCellsToPaintSeason(idx, p, cellIds);
  if (!changed) return;
  if (state.brush !== 'erase') ensurePaintVisibleOnMap();
  renderCanvas();
  updateProgress();
  updateMapPlot(idx);
  savePlotChange(idx);
}
```

- [ ] **Step 4: Update the brush cursor color in `onMove`.** Replace

```js
      const selectedCrop = CropCatalog.byId(state.selectedCropId);
      cursor.style.borderColor = state.brush==='erase' ? 'var(--danger)' : (selectedCrop?.hex || '#9CA3AF');
```

with

```js
      cursor.style.borderColor = state.brush==='erase'
        ? 'var(--danger)'
        : Classes.selectionColor(state.selection, CropCatalog);
```

- [ ] **Step 5: Only take an undo snapshot when the stroke can change something.** In `onDown`, replace `snapshotForUndo(state.plotIdx);` with:

```js
  if (state.brush === 'erase' || activePaintSeasonData()) snapshotForUndo(state.plotIdx);
```

- [ ] **Step 6: Syntax check and commit**

Run: `node --check app.js`
Expected: no output

```bash
git add app.js
git commit -m "feat: per-season delta sync, undo via deltas, bounded painting"
```

### Task 16: `app.js`, part 3: selection UI and palette

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace the CROP PALETTE section** (`selectCrop`, `removeCustomCrop`, `buildPalette`; keep `updateBrush`) with:

```js
// ── CLASS + CROP NAME SELECTION ───────────────────────────────────
let cropPickerInstance = null;
let classPickerInstance = null;

function applyClassDates(key) {
  const defaults = Classes.defaultDates(key);
  if (defaults && (state.paintStartDate == null || state.datesAuto)) {
    state.paintStartDate = defaults.start;
    state.paintEndDate = defaults.end;
    state.datesAuto = true;
  } else if (!defaults && state.datesAuto) {
    state.paintStartDate = null;
    state.paintEndDate = null;
    state.datesAuto = false;
  }
}
function refreshSelectionUi() {
  buildPalette();
  updateBrush();
  if (typeof window.syncSeasonSelectors === 'function') window.syncSeasonSelectors();
  if (typeof window.updateScheduleReadout === 'function') window.updateScheduleReadout();
  renderCanvas();
}
function selectClass(key) {
  if (!Classes.byKey(key)) return;
  state.selection.classKey = key;
  if (key !== 'other_cultivated') state.selection.cropId = null;
  if (key !== 'other') state.selection.remark = '';
  applyClassDates(key);
  if (state.brush === 'erase') state.brush = 1;
  refreshSelectionUi();
}
function selectCrop(cropId) {
  const crop = CropCatalog.byId(cropId);
  if (!crop || !CropCatalog.isResolved(crop.id)) return;
  state.selection.classKey = 'other_cultivated';
  state.selection.cropId = crop.id;
  state.selection.remark = '';
  applyClassDates('other_cultivated');
  if (state.brush === 'erase') state.brush = 1;
  refreshSelectionUi();
}
function setRemark(text) {
  state.selection.remark = text;
  if (typeof window.updateScheduleReadout === 'function') window.updateScheduleReadout();
  renderCanvas();
}

async function removeCustomCrop(cropId) {
  const removedSeasons = await CropCatalog.remove(cropId);
  outbox.dropCrop(cropId);
  for (const plot of Object.values(state.plots)) {
    if (plot && Array.isArray(plot.seasons)) plot.seasons = plot.seasons.filter(s => s && s.cropId !== cropId);
  }
  if (state.selection.cropId === cropId) state.selection.cropId = null;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoBtn();
  CropCatalog.registerReferences(state.plots);
  saveState();
  renderCanvas();
  drawPlotsOnMap();
  updateLegend();
  updateProgress();
  updatePlotHeader();
  refreshMetaToggle();
  if (drawer && drawer.classList.contains('on')) loadMetadataIntoDrawer();
  refreshSelectionUi();
  return removedSeasons;
}

function buildPalette(){
  if (!classPickerInstance) {
    classPickerInstance = window.TANIMAN_CLASS_PICKER.create({
      root: document.getElementById('class-picker'),
      remarkField: document.getElementById('other-remark-field'),
      remarkInput: document.getElementById('other-remark'),
      remarkLabel: document.getElementById('other-remark-label'),
      classes: Classes.ALL,
      onSelect: selectClass,
      onRemark: setRemark,
    });
  }
  classPickerInstance.render({
    classKey: state.selection.classKey, remark: state.selection.remark, lang: state.lang, tr,
  });
  document.getElementById('crop-name-section').hidden = state.selection.classKey !== 'other_cultivated';
  if (!cropPickerInstance) {
    cropPickerInstance = window.TANIMAN_CROP_PICKER.create({
      root: document.getElementById('crop-picker'),
      catalog: CropCatalog,
      selectedCropId: state.selection.cropId || '',
      lang: state.lang,
      onSelect: selectCrop,
      onCreate: async (name, hex) => {
        const result = await CropCatalog.create(name, hex);
        if (result.status === 'created') selectCrop(result.crop.id);
        return result;
      },
      onRemove: removeCustomCrop,
    });
  }
  cropPickerInstance.render({ selectedCropId: state.selection.cropId || '', lang: state.lang });
}
```

- [ ] **Step 2: Update the keyboard shortcuts.** In the `keydown` handler, replace the `/^[1-3]$/` block with:

```js
  if (/^[1-3]$/.test(e.key)) selectClass(Classes.byId(+e.key).key);
```

Also:
- Replace the `Escape` branch with `if (e.key === 'Escape' && drawer.classList.contains('on')) closeDrawer();`.
- Change the `E` shortcut to `if (e.key === 'e' || e.key === 'E'){ state.brush = 'erase'; updateBrush(); renderCanvas(); }`.
- In the `.brush-btn` click handler, add `renderCanvas();` after `updateBrush();`, so the painting prompt hides or shows when switching between erase and paint.

- [ ] **Step 3: Syntax check and commit**

Run: `node --check app.js`
Expected: no output

```bash
git add app.js
git commit -m "feat: class selection with crop names and Other remark"
```

### Task 17: `app.js`, part 4: map, canvas, header, legend

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Map bounds.** Replace `MAP_DETAIL_BOUNDS` with:

```js
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [GRID_BOUNDS.latS, GRID_BOUNDS.lngW],
  [GRID_BOUNDS.latN, GRID_BOUNDS.lngE]
);
// About 1 km of margin around the composite extent.
const GRID_MAX_BOUNDS = MAP_DETAIL_BOUNDS.pad(0.2);
```

- [ ] **Step 2: Update `initMap`.**
  - Set `maxBounds: GRID_MAX_BOUNDS` (instead of `MAP_CONTEXT_BOUNDS`).
  - Delete the `L.polygon(ATOK_POLY, ...)` call.
  - Keep the Paoay polygon.
  - Replace the `map.fitBounds([...ATOK_DETAIL_BOUNDS...])` call with `map.fitBounds(MAP_DETAIL_BOUNDS);`.

- [ ] **Step 3: Update the plot drawing.**
  - In `plotStyle`, change `const { crop } = composition;` / `if (crop){` to `const { top } = composition;` / `if (top){`.
  - In `compositionBarHtml`, change `background:${CROPS[i].hex}` to `background:${Classes.ALL[i].hex}`.
  - In `drawPlotsOnMap`, change `const rect = L.rectangle([[plot.latS, plot.lngW],[plot.latN, plot.lngE]], style).addTo(map);` to `const rect = L.polygon(plot.corners, style).addTo(map);`.
  - In `openPlot`:
    - Change `const bounds = L.latLngBounds([[plot.latS,plot.lngW],[plot.latN,plot.lngE]]);` to `const bounds = L.latLngBounds(plot.corners);`.
    - Replace the `hasSyncOnNavigate()` block with `refreshPlotFromServer(idx);`.

- [ ] **Step 4: Canvas background and out-of-bounds overlay.**
  - Delete `latLngToGlobalPixel`, `getMapTileImage`, `drawMapTileBackground` and the `mapTileCache` variable.
  - In `renderCanvas`, replace the `if (plot) { if (useOnlineImagery()) {...} else {...} }` block with:
    ```js
    const tile = getPlotTile(state.plotIdx);
    if (tile && tile.complete && tile.naturalWidth > 0) ctx.drawImage(tile, 0, 0, w, h);
    ```
  - In the cell loop, replace `const cropList = cellVisibleCrops(p, idx);` with `const cropList = cellVisibleColors(p, idx);`. Leave the `drawMixedCell(...)` call as it is; it now receives colors.
  - After `ctx.globalAlpha = 1;` (before the grid lines), add:

```js
  if (plot && (plot.validCols < GRID || plot.validRows < GRID)) {
    ctx.fillStyle = 'rgba(64,64,64,0.88)';
    if (plot.validCols < GRID) ctx.fillRect(plot.validCols * cellW, 0, w - plot.validCols * cellW, h);
    if (plot.validRows < GRID) ctx.fillRect(0, plot.validRows * cellH, plot.validCols * cellW, h - plot.validRows * cellH);
  }
```

  - Replace the minor grid loop (`for (let i=5;i<GRID;i+=5){ ... }` with `--grid-line`) with one faint line per cell, so cells can be checked against the photo (1 cell = 20 image px). Keep the major loop every 10 cells:

```js
  ctx.strokeStyle = getCss('--grid-line');
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.45;
  for (let i=1;i<GRID;i++){
    ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(w, i*cellH); ctx.stroke();
  }
  ctx.globalAlpha = 1;
```

  - Change the corner counter to `` `${GRID}×${GRID} · ${painted} / ${GridMath.validCellCount(plot)}` ``.
  - At the very end of `renderCanvas`, add the prompt update:

```js
  const prompt = document.getElementById('canvas-prompt');
  if (prompt) {
    const status = currentSelectionStatus();
    const show = state.brush !== 'erase' && !status.ready;
    prompt.hidden = !show;
    if (show) prompt.textContent = tr(Classes.PROMPT_KEYS[status.missing]);
  }
```

- [ ] **Step 5: Plot header and meta toggle.** In `updatePlotHeader`:
  - Delete the whole `// farmer chip` block.
  - Change the location line to:

```js
  document.getElementById('plot-loc').textContent = `R${plot.pr} · C${plot.pc} · ${plot.centerLat.toFixed(4)}°N, ${plot.centerLng.toFixed(4)}°E`;
```

In `refreshMetaToggle`, change `const has = p && (p.farmer || p.farmerId || p.note || (p.photos && p.photos.length));` to `const has = p && (p.note || (p.photos && p.photos.length));`.

- [ ] **Step 6: Progress and legend.**
  - In `updateProgress`, delete the last three lines (the roster count).
  - Replace `updateLegend` with:

```js
function updateLegend(){
  const root = document.getElementById('map-legend-rows');
  if (!root) return;
  const visibleCells = new Array(Classes.ALL.length).fill(0);
  const plotsWith = new Array(Classes.ALL.length).fill(0);
  let emptyVisibleCells = 0;
  let totalCells = 0;
  PLOTS.forEach(plot => {
    const composition = plotCompositionForView(plot.idx);
    totalCells += GridMath.validCellCount(plot);
    emptyVisibleCells += composition.emptyCells;
    composition.counts.forEach((count, i) => {
      visibleCells[i] += count;
      if (count > 0) plotsWith[i]++;
    });
  });
  const pct = count => totalCells ? Math.round((count / totalCells) * 100) : 0;
  const rows = [`<div class="lgd-row"><span class="lgd-sw empty"></span>
      <span class="lgd-nm">${tr('unpainted')}</span>
      <span class="lgd-val"><span class="lgd-ct">${pct(emptyVisibleCells)}%</span><span class="lgd-sub">${emptyVisibleCells} cells</span></span></div>`];
  Classes.ALL.forEach((cls, i) => {
    rows.push(`<div class="lgd-row"><span class="lgd-sw" style="background:${cls.hex};border-color:${cls.hex}"></span>
      <span class="lgd-nm">${escapeHtml(cls.name[state.lang] || cls.name.en)}</span>
      <span class="lgd-val"><span class="lgd-ct">${pct(visibleCells[i])}%</span><span class="lgd-sub">${visibleCells[i]} cells · ${plotsWith[i]} plots</span></span></div>`);
  });
  root.innerHTML = rows.join('');
}
```

- [ ] **Step 7: Language.** In `applyLang`:
  - Delete the lines for `roster-btn-txt`, `lab-farmer-id`, `lab-farmer`, `ph-farmer` and `ph-farmer-id`.
  - Replace `document.getElementById('lab-crop').textContent = tr('crop');` with:

```js
  document.getElementById('lab-class').textContent = tr('classLabel');
  document.getElementById('lab-crop').textContent = tr('cropNameLabel2');
```

- [ ] **Step 8: Syntax check and commit**

Run: `node --check app.js`
Expected: no output

```bash
git add app.js
git commit -m "feat: draw UTM plots, sharp plot images and out-of-bounds cells"
```

### Task 18: `app.js`, part 5: drawer, clear, roster removal, init

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Drawer.**
  - Delete `nextFarmerId`.
  - In `loadMetadataIntoDrawer`, keep only the `note` and `photos` fields in `detailDraft`, and delete the farmer input and suggestion lines.
  - Delete the `in-farmer-id`, `in-farmer` and `sug-farmer-id` handlers.
  - In `renderScheduleSummary`, replace the crop filter and label with class names:

```js
  const seasons = (p.seasons || []).filter(season =>
    isValidMmdd(season.start) && isValidMmdd(season.end) && season.cells && season.cells.length);
  ...
    const label = season.classId === 4
      ? (Classes.cropName(CropCatalog, season.cropId, state.lang) || Classes.className(4, state.lang))
      : season.classId == null
        ? `${Classes.className(null, state.lang)}: ${season.remark}`
        : Classes.className(season.classId, state.lang);
    return `<div class="ss-season">
      <span class="ss-dot" style="background:${seasonHex(season)}"></span>
      <span>${escapeHtml(label)} · ${season.start}-${season.end}${wraps}</span>
      <span class="ss-count">${season.cells.length}</span>
    </div>`;
```

  - In the `dr-save` handler:
    - Delete the `farmerId`/`farmer` assignments.
    - Replace `markCloudDirty(idx);` with `queueMetaChange(idx);`.

- [ ] **Step 2: Clear plot.** Replace the `btn-clear` handler with:

```js
document.getElementById('btn-clear').onclick = async ()=>{
  const idx = state.plotIdx;
  if (!plotHasData(idx)) return;
  if (!confirm(tr('confirmClear'))) return;
  const p = ensurePlot(idx);
  outbox.dropPlot(idx);   // also drops in-flight deltas, so their results are ignored
  metaDirty.delete(idx);
  p.seasons = emptySeasons();
  p.note = '';
  p.photos = [];
  clearUndoForPlot(idx);
  renderCanvas(); updateProgress(); updateMapPlot(idx);
  if (drawer.classList.contains('on')) loadMetadataIntoDrawer();
  refreshMetaToggle(); updatePlotHeader();
  saveState();
  toast(tr('cleared'));
  if (typeof window.clearPlotRemote === 'function') {
    // Let any request already on the wire land first, so clear_plot runs last.
    if (flushPromise) await flushPromise.catch(() => {});
    try { await window.clearPlotRemote(idx); }
    catch (e) { console.warn('clear plot failed:', e); toast(tr('syncDropped')); }
  }
};
```

Clearing is no longer undoable, because it deletes rows on the server. That's intended.

- [ ] **Step 3: Delete the whole `// ── ROSTER` section** (`buildRosterData` through the three `roster-*` handlers).

- [ ] **Step 4: Init and expose.**
  - Replace the bottom block with the new startup:
    - Replace `restoreCloudDirtyQueue(); if (hasSyncInit()) { ... }` with `initialCloudLoad();`.
  - In the `CropCatalog.subscribe(() => { ... })` callback, keep it as it is.
  - Replace `window.TANIMAN = { ... }` with:

```js
window.TANIMAN = {
  state, GRID, PLOTS, CROPS, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils, CropCatalog, Classes,
  monthsBetween, maskList, maskToLabel, maskIntersects, maskContains,
  normalizeViewMonths, viewMonthFromMask, maskToDisplayLabel,
  shouldAutoSwitchViewMonths, isBrushHiddenOnMap,
  renderCanvas, drawPlotsOnMap, updateMapPlot, updateLegend, updatePlotHeader,
  saveState, tr, schedSave, visiblePlots,
  selectionStatus: currentSelectionStatus,
};
```

- [ ] **Step 5: Search for leftovers**

Run: `grep -n "farmer\|roster\|DEVICE_ID\|PAOAY_PLOTS\|classifyZone\|selectedCropId\|cropIndexFromId\|markCloudDirty\|syncPlots\|syncOnNavigate\|syncInit\|hasSync\|afterRemoteMerge\|seasonExportRows\|CropExport\|ATOK_DETAIL_BOUNDS\|PAOAY_GRID_BOUNDS\|CORE_PLOT_COUNT" app.js`
Expected: no output. Fix anything it finds.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: remove farmer roster, clear plot on server, wire initial load"
```

### Task 19: `calendar.js`: empty dates and the selection readout

**Files:**
- Modify: `calendar.js`

- [ ] **Step 1: Destructuring.** At the top, change the destructured names to include `Classes` and drop nothing else:

```js
const {
  state, CROPS, CropCatalog, Classes, MONTH_SHORT, MONTH_FULL, MONTH_FULL_LONG, ALL_MONTHS,
  SeasonUtils, monthsBetween, normalizeViewMonths, viewMonthFromMask,
  maskToDisplayLabel, isBrushHiddenOnMap, tr,
} = window.TANIMAN;
```

Delete `let activeDateReset = false;`.

- [ ] **Step 2: Replace `normalizeActivePaintRange`** with a version that never invents dates:

```js
function normalizeActivePaintRange() {
  const valid = isValidMmdd(state.paintStartDate) && isValidMmdd(state.paintEndDate);
  state.paintMonths = valid ? monthMaskForSeason(state.paintStartDate, state.paintEndDate) : ALL_MONTHS;
  return false;
}
```

- [ ] **Step 3: Replace `readoutModel` and `updateScheduleReadout`** with:

```js
function readoutModel() {
  const status = window.TANIMAN.selectionStatus();
  const sel = state.selection;
  const hex = Classes.selectionColor(sel, CropCatalog);
  if (!status.ready) {
    return { hex, text: tr(Classes.PROMPT_KEYS[status.missing]), wrapped: false, helper: '' };
  }
  const wrapped = rangeWrapsYear(state.paintStartDate, state.paintEndDate);
  return {
    hex,
    text: tr('seasonPresentFromTo')
      .replace('{crop}', Classes.selectionLabel(sel, CropCatalog, state.lang))
      .replace('{start}', formatMmdd(state.paintStartDate))
      .replace('{end}', formatMmdd(state.paintEndDate)),
    wrapped,
    helper: wrapped ? tr('seasonContinuesNextYear') : '',
  };
}
```

In `updateScheduleReadout`, change `model.crop.hex` to `model.hex`.

- [ ] **Step 4: Empty month and day options.** Replace `populateMonthSelect`, `updateDayOptions`, `syncSeasonSelectors`, `setPaintSeasonRange` and `wireSeasonPicker` with:

```js
function blankOption() {
  const option = document.createElement('option');
  option.value = '';
  option.textContent = '—';
  return option;
}

function populateMonthSelect(select, { short = false } = {}) {
  if (!select) return;
  const previous = select.value;
  clearChildren(select);
  select.appendChild(blankOption());
  for (let i=0; i<12; i++) {
    const option = document.createElement('option');
    option.value = String(i + 1);
    option.textContent = short ? monthShortLabel(i + 1) : MONTH_FULL_LONG[i];
    select.appendChild(option);
  }
  select.value = previous || '';
}

function updateDayOptions(monthSelect, daySelect, desiredDay) {
  if (!monthSelect || !daySelect) return;
  clearChildren(daySelect);
  if (!monthSelect.value) {
    daySelect.appendChild(blankOption());
    daySelect.value = '';
    return;
  }
  const month = Number(monthSelect.value);
  const max = SeasonUtils.MONTH_DAYS[month - 1];
  for (let d=1; d<=max; d++) {
    const option = document.createElement('option');
    option.value = String(d);
    option.textContent = String(d);
    daySelect.appendChild(option);
  }
  daySelect.value = String(clampDayForMonth(desiredDay || 1, month));
}

function syncSeasonSelectors() {
  normalizeActivePaintRange();
  const plantedMonth = document.getElementById('season-planted-month');
  const plantedDay = document.getElementById('season-planted-day');
  const harvestMonth = document.getElementById('season-harvest-month');
  const harvestDay = document.getElementById('season-harvest-day');
  if (!plantedMonth || !plantedDay || !harvestMonth || !harvestDay) return;
  const start = mmddToParts(state.paintStartDate);
  const end = mmddToParts(state.paintEndDate);
  plantedMonth.value = start ? String(start.month) : '';
  updateDayOptions(plantedMonth, plantedDay, start && start.day);
  harvestMonth.value = end ? String(end.month) : '';
  updateDayOptions(harvestMonth, harvestDay, end && end.day);
}
window.syncSeasonSelectors = syncSeasonSelectors;

function setPaintSeasonRange(start, end) {
  state.paintStartDate = start;
  state.paintEndDate = end;
  state.datesAuto = false;
  normalizeActivePaintRange();
  updateScheduleReadout();
  window.TANIMAN.renderCanvas();
}

function wireSeasonPicker() {
  const plantedMonth = document.getElementById('season-planted-month');
  const plantedDay = document.getElementById('season-planted-day');
  const harvestMonth = document.getElementById('season-harvest-month');
  const harvestDay = document.getElementById('season-harvest-day');
  if (!plantedMonth || !plantedDay || !harvestMonth || !harvestDay) return;

  const setFromSelectors = () => {
    if (!plantedMonth.value || !harvestMonth.value) return setPaintSeasonRange(null, null);
    setPaintSeasonRange(
      partsToMmdd(plantedMonth.value, plantedDay.value),
      partsToMmdd(harvestMonth.value, harvestDay.value));
  };
  plantedMonth.addEventListener('change', () => {
    updateDayOptions(plantedMonth, plantedDay, Number(plantedDay.value) || 1);
    setFromSelectors();
  });
  plantedDay.addEventListener('change', setFromSelectors);
  harvestMonth.addEventListener('change', () => {
    const month = Number(harvestMonth.value);
    const lastDay = month ? SeasonUtils.MONTH_DAYS[month - 1] : 1;
    updateDayOptions(harvestMonth, harvestDay, Number(harvestDay.value) || lastDay);
    setFromSelectors();
  });
  harvestDay.addEventListener('change', setFromSelectors);
}
```

Update `window.TANIMAN_SEASON_CONTROL` to export `{ partsToMmdd, mmddToParts, formatMmdd, clampDayForMonth, normalizeActivePaintRange, readoutModel }` (unchanged names).

- [ ] **Step 5: Init.** At the bottom, change

```js
normalizeActivePaintRange();
syncSeasonSelectors({ normalize: false });
```

to

```js
syncSeasonSelectors();
```

- [ ] **Step 6: Syntax check and commit**

Run: `node --check calendar.js`
Expected: no output

```bash
git add calendar.js
git commit -m "feat: dates start empty and the readout follows the brush selection"
```

### Task 20: Export handler in `app.js`

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace the `btn-save` handler body** (keep the Tauri/browser download branch at the end as it is). Delete the old comment block above it and use:

```js
// ── ZIP EXPORT ────────────────────────────────────────────────────
// paoay_cropmap_YYYY-MM-DD/
//   seasons.csv  fields.csv  classes.csv  plots.csv  metadata.json
//   labels/plotNNN.png   photos/plotNNN_N.jpg
document.getElementById('btn-save').onclick = async () => {
  CropCatalog.registerReferences(state.plots);
  const indices = PLOTS.map(plot => plot.idx).filter(plotHasData);
  if (!indices.length){ toast(tr('empty')); return; }
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span>';
  try {
  await flushCloudSync();
  if (outbox.size()) await flushCloudSync();   // edits made while the first flush ran

  const zip = new JSZip();
  const dateStamp = new Date().toISOString().slice(0,10);
  const folder = zip.folder('paoay_cropmap_' + dateStamp);

  const plotData = {};
  for (const idx of indices) plotData[idx] = ensurePlot(idx);
  const exported = LabelExport.buildExport({ plots: PLOTS, plotData, catalog: CropCatalog, grid: window.GRID });
  folder.file('seasons.csv', exported.seasonsCsv);
  folder.file('fields.csv', exported.fieldsCsv);
  folder.file('classes.csv', exported.classesCsv);
  folder.file('plots.csv', exported.plotsCsv);
  folder.file('metadata.json', exported.metadataJson);

  const oc = document.createElement('canvas');
  oc.width = 500; oc.height = 500;
  const oct = oc.getContext('2d');
  for (const idx of indices) {
    const p = plotData[idx];
    const plot = PLOTS[idx];
    if (plotHasPaint(idx)) {
      oct.clearRect(0, 0, 500, 500);
      for (let r=0; r<GRID; r++) for (let c=0; c<GRID; c++) {
        const cellIdx = r*GRID + c;
        if (!GridMath.isCellInBounds(plot, cellIdx)) {
          oct.fillStyle = '#404040';
          oct.fillRect(c*10, r*10, 10, 10);
          continue;
        }
        const colors = cellVisibleColors(p, cellIdx, ALL_MONTHS);
        if (colors.length) drawMixedCell(oct, c*10, r*10, 10, 10, colors, state.mixedStyle);
      }
      folder.file(`labels/plot${String(idx).padStart(3,'0')}.png`,
        oc.toDataURL('image/png').split(',')[1], { base64: true });
    }
    (p.photos || []).filter(ph => ph && ph.dataUrl).forEach((ph, pi) => {
      folder.file(`photos/plot${String(idx).padStart(3,'0')}_${pi}.jpg`, ph.dataUrl.split(',')[1], { base64: true });
    });
  }

  // (keep the existing `if (window.__TAURI__) { ... } else { ... }` download block here)
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHtml;
  }
};
```

Delete the old `csvEscape` helper near the toast code if nothing else uses it (`grep -n csvEscape app.js`).

- [ ] **Step 2: Syntax check and commit**

Run: `node --check app.js`
Expected: no output

```bash
git add app.js
git commit -m "feat: export classes, fields and Sentinel-2 pixel coordinates"
```

---

## Chunk 4: Test cleanup, manual verification, docs and handoff

### Task 21: Update or delete the outdated tests

**Files:**
- Modify or delete files in `tests/`

- [ ] **Step 1: Run the full suite and list the failures**

Run: `node --test tests/*.test.mjs 2>&1 | grep -E "^not ok|# (pass|fail)"`

- [ ] **Step 2: Apply these rules file by file:**

| Test file | Action |
|---|---|
| `atok-paoay-study-area.test.mjs`, `outside-plots.test.mjs`, `crop-migration.test.mjs`, `crop-targets.test.mjs`, `supabase-season-source.test.mjs` | **Delete.** They cover removed behaviour (zones, 112-plot grid, legacy crop index migration, lettuce targets, plot-row sync). |
| `crop-catalog.test.mjs`, `supabase-crops.test.mjs`, `crop-picker.test.mjs`, `crop-selection.test.mjs` | **Update.** Ids are bare UUIDs (no `crop_` prefix). The catalog has no targets. The reserved names are carrot/karot/cabbage/repolyo/potato/patatas. The delete RPC is `delete_crop`. `window.CROPS` is no longer predefined by `data.js`, so load `classes.js` into the test context first if a test needs reserved names. Delete cases that only test target-crop behaviour. |
| `season-state-source.test.mjs`, `season-ui-source.test.mjs`, `season-control-helpers.test.mjs`, `crop-views.test.mjs`, `map-composition-legend.test.mjs`, `map-month-range-integration.test.mjs`, `map-zoom-config.test.mjs` | **Update.** These are regex checks on `app.js`/`calendar.js` source. Rewrite each assertion for the new names (`cellVisibleColors`, `addCellsToPaintSeason(idx, p, cellIds)`, `Classes.legendIndex`, `L.polygon(plot.corners`, `GRID_MAX_BOUNDS`, empty date option, no `seasonDateResetAllYear` reset). Delete assertions about removed behaviour (Atok detail bounds, live Esri canvas background, farmer columns, the all-year reset). |
| `translations.test.mjs` | **Update.** `CROPS` no longer exists in `data.js`; instead, load `season-utils.js` and `classes.js` and assert that every class has `en`/`tl`/`il` names. Keep the IL/TL key-parity checks. |
| `month-view-utils.test.mjs`, `season-utils.test.mjs` | **Keep.** In `season-utils.test.mjs`, delete the `seasonExportRows` test and that import. Then remove `seasonExportRows`, and `cellGeometry` if nothing else uses it (`grep -rn cellGeometry --include=*.js .`), from `season-utils.js` and its `api` object. |
| `tauri-save-zip.test.mjs`, `desktop-lockfile.test.mjs`, `macos-build-workflow.test.mjs` | **Leave alone** (Tauri, out of scope). If one fails because it reads a file you deleted, update the file reference only. |

- [ ] **Step 2b: Retire the old generator path.**
  - Delete `scripts/verify_study_area_assets.mjs`, which checks the old 112-plot `tilePath` values.
  - At the top of `main()` in `generate_tiles.py`, add `raise SystemExit("Legacy Tauri tile builder: it would overwrite the Sentinel-2 grid in data.js. Use generate_plots.py.")`. `generate_plots.py` imports helpers from this file, so keep the file itself.

- [ ] **Step 3: Add the file list to the Tauri staging script** so it doesn't reference a deleted file. In `src-tauri/scripts/prepare-dist.mjs`, replace `'crop-export.js'` with `'grid.js', 'classes.js', 'season-outbox.js', 'field-ids.js', 'label-export.js', 'class-picker.js'`.

- [ ] **Step 4: Run everything**

Run: `node --test tests/*.test.mjs && python -m pytest tests/test_plot_grid.py -q`
Expected: 0 failures

- [ ] **Step 5: Commit**

```bash
git add -A tests scripts src-tauri/scripts/prepare-dist.mjs season-utils.js generate_tiles.py
git commit -m "test: align suite with Sentinel-2 grid and class model"
```

### Task 22: Manual verification in the browser

This needs a Supabase project that has the new schema. Ask the repo owner to run `docs/supabase-foundation.sql` (and optionally `docs/supabase-foundation-smoke.sql`) in the Supabase SQL Editor **now**, and to confirm when it's done. Before that, you can check the UI with the network blocked: everything except sync should work.

- [ ] **Step 1:** Run `python -m http.server 8080` and open `http://localhost:8080/taniman.html`.
- [ ] **Step 2: Grid.**
  - The map shows 120 slightly rotated squares over the composite area, with the Paoay outline dashed on top.
  - Plot 120 (bottom-right) shows a grey band on its right and bottom in the canvas, and the counter reads `… / 924`.
- [ ] **Step 3: Imagery.** Open plots 1, 14 and 60. The canvas shows a sharp photo, and field edges and roads line up with the grid lines (every 20 image px = 1 cell).
- [ ] **Step 4: Painting rules.**
  - On load nothing is selected, and the canvas prompt says "Pick a class to start painting". Clicking the canvas paints nothing and flashes the prompt.
  - Pick Cabbage: the prompt asks for dates. Set Mar 1 to Jun 30, then paint. It works.
  - Pick Forest: the dates switch to Jan 1 to Dec 31 by themselves.
  - Pick Other: a remark is required.
  - Pick Other cultivated: the crop-name list appears, and painting is blocked until a crop name is chosen.
  - Reload: nothing is selected again.
- [ ] **Step 5: Sync (after the owner confirms the schema).**
  - Open the app in two browsers. In A, paint cabbage in plot 14; in B, paint forest in plot 14. Reopen plot 14 in each: both labels are there.
  - Undo in A, reopen in B: the undone cells are gone.
  - Clear plot 14 in A: after reopening, B shows it empty.
- [ ] **Step 6: Export.** Click Save all. Unzip and check:
  - `seasons.csv` has the 16 spec columns.
  - Cabbage painted across the plot 1/plot 2 border has a single `field_id`.
  - `fields.csv`, `classes.csv`, `plots.csv` and `metadata.json` exist; `farmers.csv`, `labels.csv`, `crops.csv` and `plot_crop_counts.csv` do not.
  - `grep -ri farmer` over the folder finds nothing.
- [ ] **Step 7:** Write down anything that doesn't match. Fix it, re-run `node --test tests/*.test.mjs`, and commit.

### Task 23: README and handoff notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite these README sections:**
  - **Setup §1–2:** replace "Generate the Paoay boundary" and "Generate tile assets" with:
    - The grid is fixed to the Sentinel-2 composite (EPSG:32651, origin 258690/1841210, 571×494 px).
    - `python generate_plots.py` re-renders `tiles/plots/` from Esri and rewrites the `data.js` grid block. No `.tif` is needed.
    - The optional alignment check: `python -c "import rasterio;s=rasterio.open('Sentinel2_CSPlus_2024_01_H1.tif');print(s.crs,s.transform,s.width,s.height)"` should print EPSG:32651, origin (258690, 1841210), 10 m and 571 × 494.
  - **Configure Supabase:** delete all mentions of `supabase-setup.sql` and `supabase-add-crops.sql`. Say that the owner runs `docs/supabase-foundation.sql` once (destructive: it wipes plots and seasons and keeps crop names), optionally followed by `docs/supabase-foundation-smoke.sql`.
  - **Data export:** list the new files and columns from spec §7. Say that rows with an empty `class_id` are "Other" (for review, not training). Note that the pipeline's `config.yaml` needs grass/shrub as class 8.
  - **Local development:** add `node --test tests/*.test.mjs` and `python -m pytest tests/test_plot_grid.py`.
  - **Offline/Tauri:** one line saying the desktop build is no longer maintained.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Sentinel-2 grid, classes and new Supabase setup"
```

- [ ] **Step 3: Finish the branch.** Use superpowers:finishing-a-development-branch. **Merge to `main` only after the owner has run `docs/supabase-foundation.sql`**, because Vercel deploys `main` automatically and the new app needs the new schema.
