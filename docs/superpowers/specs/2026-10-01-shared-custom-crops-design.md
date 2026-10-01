# Shared Custom Crops Design

## Goal and scope

Let a field worker add a named crop in the web app, select it again on later plots, and make it available to other web users. Lettuce, potato, and carrot remain the paper's target crops. Every added crop is a full ground truth class: painting it creates the same season and cell records, with the same dates and coordinates, as a target crop. The target designation affects picker placement and export metadata only. It never filters out other crops or reduces their export detail. The number of labeled examples for a class depends on how much field data workers record.

This release covers the static Vercel web app. The offline Tauri build keeps its current three-crop palette and local storage workflow. The two builds share JavaScript files, so web-only catalog loading and controls must be gated explicitly.

## Current behavior and constraints

- `data.js` defines the fixed `window.CROPS` array: lettuce, potato, carrot.
- `app.js` stores a selected crop as an array index (`state.crop`). Plot seasons already store a stable `cropId` string in `plots.seasons` JSONB. Many rendering and export paths look up a crop by that ID, then silently skip an unrecognized ID.
- `supabase-sync.js` syncs plot rows only. The offline build instead persists a state file through `offline-storage.js`.
- `seasons.csv` is the authoritative ML export. It has one row per season and painted cell with crop ID, recurring date range, and WGS84 cell geometry. `labels.csv`, PNGs, `plots.csv`, `farmers.csv`, and `metadata.json` are companion outputs.
- `docs/supabase-setup.sql` drops and recreates `public.plots`. It must not be run to deploy this feature against an existing database.

## Catalog model and ownership

Keep the three target crop definitions in `data.js`, including their EN, TL, and IL names and colors. Add a `public.crops` table for other crops only. Its fields are a generated UUID primary key, a display name, a `#RRGGBB` color, and creation time. The app exposes IDs as `crop_<uuid>` and uses that exact string in `season.cropId`, CSVs, and metadata. An ID remains stable for the life of a crop.

The database enforces nonempty names of at most 80 characters, valid hex colors, and unique names after trimming, collapsing whitespace, and case folding. It also rejects names matching the EN, TL, or IL display names of the three target crops. The web form normalizes and checks names for immediate duplicate feedback, but the database's normalization and unique constraint are authoritative, including for Unicode case rules. A conflicting insert is handled by reading the existing crop and offering to select it.

The app allows public reads and inserts through Supabase, matching the current anonymous plot editing model. It provides no rename or delete control. RLS and grants for the new table allow `SELECT` and `INSERT` to app roles, but not `UPDATE` or `DELETE`; this prevents ordinary users from breaking historical labels by changing catalog rows. Database administrators retain normal maintenance access. This is catalog governance, not a new sign-in system.

## Catalog loading and selection

A focused catalog module combines target definitions with the fetched custom rows and exposes lookup by ID, ordered lists, and change notifications. It owns validation and Supabase catalog requests. Rendering, painting, and exports consume that interface rather than each constructing their own crop list. The shared catalog uses the same crop object shape that current code expects (`id`, `hex`, `name`), with a custom crop's entered display name as `name.en` and a fallback for TL and IL. Existing target translations stay intact.

The catalog module hydrates synchronously from targets and the last valid browser cache before `app.js` and `calendar.js` initialize. Both scripts must receive a usable lookup on their first read; neither waits on a network call. A later Supabase refresh runs asynchronously on load and when the tab regains focus, then notifies both scripts to redraw the picker, map, legend, summaries, and active readout. A successful refresh replaces the custom cache. A newly created crop is selected after the insert succeeds. An insert failure leaves the form and entered name intact; the app must not pretend that a crop is shared when it has not been saved. Existing cached crops remain usable during a connection failure. The Tauri build does not fetch, display, or create custom catalog entries. If this design adds a shared script file, include it in `src-tauri/scripts/prepare-dist.mjs` even though its remote branch is disabled there.

Persist the active choice as `selectedCropId`, not an array position. Migrate a saved numeric `state.crop` to the corresponding built in target ID before the first UI render, then use ID-based lookup throughout painting and the schedule readout. Catalog refresh or alphabetical sorting must not change the selected crop. If a persisted custom ID is absent from both cache and server, retain that ID in state, show an unknown-crop readout, and block new painting until the worker selects a known crop or the catalog resolves it. The schedule readout and startup path must never dereference a missing crop. Keyboard shortcuts `1`, `2`, and `3` continue to choose the three target crops; other crops are selected through the picker.

If a plot contains a crop ID whose definition is unavailable, retain the season unchanged. Show a neutral `Unknown crop (<id>)` marker in views that need a name or color, count its painted cells, and export its original ID and season rows. Do not allow creating new paint with an unresolved crop ID. The catalog refresh should replace the placeholder when the matching row becomes available. No valid season should silently disappear from the map, roster, or ground truth export because a catalog fetch failed.

## Picker UI

The existing crop section gains two groups:

1. **Target crops:** the three existing cards stay visible in their current order.
2. **Other crops:** a search field, result count, scrollable list, and **Add crop** button. Search matches display names case-insensitively and filters only the other-crop list. The selected crop remains visible or clearly indicated when a search filter hides its row.

The add control opens a compact form in the tools area with a required name and a suggested color swatch that can be changed. It has Save and Cancel actions, a saving state, and inline validation or network errors. A duplicate name offers to select the existing crop. On success the new card appears in the list and becomes the active paint crop. Crop names are treated as text and escaped wherever the UI uses HTML templates. Custom names are displayed as entered in all three language modes; the form explains that they are not automatically translated. Control labels and errors are translated into EN, TL, and IL.

Keep the sidebar usable as the list grows by constraining only the other-crop list's height. On narrow screens, the controls and cards remain touch-sized and the list scrolls within the existing mobile tools layout. The map legend must also handle a growing catalog without covering the map indefinitely. No crop editing, deletion, bulk import, or taxonomy management is part of this feature.

## Painting, views, and ground truth

The selected custom crop uses the existing planting-to-harvest range, brush, erase, undo, and sync behavior. A painted season records the custom ID in `cropId` with the same `start`, `end`, cell indexes, timestamps, and overlap rules as a target crop. Supabase's existing `public.plots.seasons` JSONB column already supports this, so there is no plot-table migration or plot-data reset.

Map cells and composition bars, the legend, progress, schedule summary, roster, and label PNGs resolve every crop through the catalog. Mixed crops and overlapping seasons keep their current semantics. Display order can group targets first and sort custom crops by name, but all counts include custom crops. Unknown IDs use the fallback described above rather than being skipped.

## Export contract

`seasons.csv` remains authoritative and includes one row per season and cell for every crop, with identical columns and geospatial/date precision for targets and custom crops. `labels.csv` also includes each custom crop's ID and display name. Add `crops.csv` with `crop_id`, `crop_name`, `hex`, `is_target`, and `is_resolved`, so a later ML pipeline can choose any subset of classes and detect missing catalog definitions. It contains all known catalog entries plus one placeholder row for each unresolved ID referenced by an exported season. Add `plot_crop_counts.csv` with `plot_idx`, `crop_id`, and `season_cell_rows`. It contains one row for each plot/crop pair with at least one exported season-cell row; its count is the number of rows for that pair in `seasons.csv`, including separate overlapping seasons on the same cell. This is the same counting rule used by the current `plots.csv` target columns, distinct from the map composition's unique visible cell counts. Keep those target columns in `plots.csv` for compatibility and add an `other_crop_cells` aggregate calculated from the same export rows; the normalized counts file is the complete per-crop summary. `farmers.csv` lists all crop IDs present for each farmer. `metadata.json` includes the same catalog and unresolved placeholders, plus an incremented export schema version. PNG colors are visual QA only; they are not class IDs.

The `is_target` flag in `crops.csv` and metadata is informational. It must not suppress custom crop rows from any ground truth file. Exports preserve raw season IDs and crop IDs even when a catalog entry is temporarily unavailable; an unresolved crop uses `Unknown crop (<id>)`, a neutral color, `is_target=false`, and `is_resolved=false` in lookup outputs. CSV text fields, including unexpected raw IDs, must be escaped. This preserves labeled observations and a joinable lookup for later reconciliation.

## Supabase rollout

Add a dedicated, repeatable SQL migration for `public.crops` and document its use in `README.md`. Run it in the Supabase SQL Editor **before** deploying the web changes. This migration only creates the table, constraints/index, permissions, and policies. It does not drop or rewrite `public.plots`, seasons, or photos. Keep `docs/supabase-setup.sql` clearly identified as a destructive initial setup/reset script; document that existing projects use the new migration instead. A fresh project can run the initial setup and then the crop migration.

If the web code loads before the migration, the three target crops remain usable and the Add crop form reports that the catalog is unavailable. That fallback prevents a broken field session but does not claim a new crop was saved. After deployment, verify that one browser can add a crop and a second browser can select and paint it, then inspect the exported CSVs.

## Validation

Use focused tests for name normalization and duplicate prevention, stable ID selection across refresh and saved-state migration, catalog fetch/insert failure behavior, unknown-ID preservation, and custom crop inclusion in all views and exports. Check the SQL migration for additive behavior and the intended read/insert permissions. In a browser smoke test, add a non-target crop, paint a cell with a date range, reload in another browser, select the crop, paint again, and inspect `seasons.csv`, `crops.csv`, and `plot_crop_counts.csv` for equal treatment of target and custom classes. Also check the narrow-screen picker and the offline build's unchanged fixed palette.
