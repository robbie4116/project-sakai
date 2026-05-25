# Design Revisions Integration — Spec

**Date:** 2026-05-25  
**Status:** Approved  

## Overview

Integrate five files produced by claude.ai/design into the Taniman thesis digimap project. The revision upgrades the app from v2 (per-cell crop bitmask) to v3 (per-cell per-crop 12-bit month mask), adds a crop calendar picker, a map month scrubber, a farmer ID field, a roster view, and a redesigned full-theme CSS.

## Decisions Made

| Question | Decision |
|---|---|
| Supabase data | Wipe and recreate schema fresh |
| Tile strategy | Keep current offline tile layers + ESRI hybrid (old `initMap`) |
| Vendor libs | Keep local `vendor/` paths (no CDN) |

## Source Files

All five files originate from `C:\Users\Robbie Pineda\Downloads\revise\`:

| File | Action |
|---|---|
| `Taniman.html` | Replace `taniman.html`, then patch CDN → vendor |
| `app.js` | Replace `app.js`, then patch `initMap` block |
| `data.js` | Replace `data.js` (extended CROPS + STRINGS) |
| `calendar.js` | New file — schedule picker + map scrubber |
| `styles.css` | New file — full theme CSS |

## Section 1 — File Operations & HTML Patches

1. Copy all five files into project root (lowercase `taniman.html`).
2. In `taniman.html`, replace four CDN tags with vendor paths:
   - `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` → `vendor/leaflet.css`
   - `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` → `vendor/leaflet.js`
   - CDN `jszip.min.js` → `vendor/jszip.min.js`
   - CDN `FileSaver.min.js` → `vendor/FileSaver.min.js`
3. Strip cache-buster suffixes from exactly three local script/link tags (these are only for the design preview):
   - `styles.css?v=8` → `styles.css`
   - `app.js?v=7` → `app.js`
   - `calendar.js?v=7` → `calendar.js`
   - The CDN tags being replaced in step 2 carry no suffixes — no action needed there.

## Section 2 — app.js: initMap Patch

The new `app.js` MAP section (lines 309–387) contains `initMap()`, `plotStyle()`, `drawPlotsOnMap()`, and `updateMapPlot()`. **Only `initMap()` itself (lines 310–331) is replaced.** `plotStyle`, `drawPlotsOnMap`, and `updateMapPlot` are kept from the new file — they use v3 data model and must not be overwritten.

**Replacement target** — remove lines 309–331 in the new `app.js` (the `// ── MAP ──` header through the closing `}` of `initMap`). The next line is `function plotStyle` — do not touch it.

**Replace with** the following block, ported verbatim from the current `app.js`:
- Three module-level refs declared before `initMap`: `let contextTileLayerRef`, `esriTileLayerRef`, `detailTileLayerRef`
- Constants: `MAP_TILE_VERSION`, `MAP_CONTEXT_MIN_ZOOM`, `MAP_CONTEXT_MAX_ZOOM`, `MAP_DETAIL_MIN_ZOOM`, `MAP_DETAIL_MAX_ZOOM`, `MAP_APP_MIN_ZOOM`, `MAP_APP_MAX_ZOOM`, `MAP_CONTEXT_BOUNDS`, `MAP_DETAIL_BOUNDS`
- Three factory functions: `makeContextTileLayer()`, `makeEsriTileLayer()`, `makeDetailTileLayer()`
- Full `initMap()` that stacks context offline → detail offline → ESRI on top

**`applyTheme()` patch** — the new `applyTheme()` (lines 733–741) has no tile re-layer logic. Add the following block inside it, **before** the `renderCanvas()` call:

```js
if (map && contextTileLayerRef && esriTileLayerRef && detailTileLayerRef) {
  map.removeLayer(esriTileLayerRef);
  map.removeLayer(detailTileLayerRef);
  map.removeLayer(contextTileLayerRef);
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  detailTileLayerRef  = makeDetailTileLayer().addTo(map);
  esriTileLayerRef    = makeEsriTileLayer().addTo(map);
}
```

Layer order is always: context (bottom) → detail → ESRI (top). This matches the offline-first strategy from prior commits.

The rest of the new `app.js` (v3 state, cells model, calendar state, roster, ZIP export, farmer ID) is kept as-is.

## Section 3 — supabase-sync.js Rewrite

### Data model change

| | v2 | v3 |
|---|---|---|
| Cell data | `p.labels`: `Uint8Array(2500)`, bit-per-crop | `p.cells`: `Uint16Array(2500)[]` × 4 crops, 12-bit month mask per cell |
| Farmer | `p.farmer` (name only) | `p.farmerId` + `p.farmer` |

### `plotToRow` changes
- Remove: `labels: Array.from(plotData.labels)`
- Add: `cells: plotData.cells ? plotData.cells.map(a => Array.from(a)) : []`
- Add: `farmer_id: plotData.farmerId || ''`
- Keep: `updated_at: new Date().toISOString()` — client must continue setting this explicitly to preserve timestamp-wins conflict resolution. Do not rely on the DB default.

### `rowToPlot` changes
- Remove: `labels: new Uint8Array(row.labels || [])`
- Add: `cells: Array.isArray(row.cells) ? row.cells.map(a => new Uint16Array(a)) : []`
  - The `Array.isArray` guard handles `null`/`undefined` defensively. Since the schema was wiped (2026-05-25) and `cells` defaults to `'[]'`, all server rows will have a valid array — but the guard is cheap insurance.
- Add: `farmerId: row.farmer_id || ''`

All other sync logic unchanged: `syncInit`, `syncPlots`, `syncOnNavigate`, `uploadPhoto`, timestamp-wins conflict resolution, `onConflict: 'plot_idx'` upsert.

## Section 4 — Supabase Schema

New `supabase-setup.sql` — drop and recreate `plots` table:

```sql
drop table if exists public.plots;
create table public.plots (
  plot_idx   integer      primary key,
  cells      jsonb        not null default '[]',
  farmer_id  text         not null default '',
  farmer     text         not null default '',
  note       text         not null default '',
  photo_url  text,
  device_id  text         not null default '',
  updated_at timestamptz  not null default now()
);

alter table public.plots enable row level security;

create policy "public_read_write" on public.plots
  for all using (true) with check (true);

insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict do nothing;

create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');

create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');
```

**Schema already applied in Supabase console (2026-05-25). `photos` bucket confirmed still present.**

## localStorage Key Change

`taniman_v2` → `taniman_v3`. The new `app.js` includes migration code: on first load of v3 app, existing v2 `labels` data is read and converted to v3 `cells` (assuming year-round for all legacy crops), then `labels` is deleted from the plot object.

## Out of Scope

- Supabase storage bucket changes (already exists, no changes needed)
- Any tile generation changes
- Any changes to `generate_tiles.py` or offline tile pipeline
