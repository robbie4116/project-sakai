# Shared Custom Crops Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let web users add and reuse shared crop labels, with every crop receiving the same season, cell, date, and coordinate ground truth records.

**Architecture:** Keep the three translated target crops in `data.js`. Add an additive Supabase catalog table for custom crops, a focused browser catalog module that hydrates targets plus cache before app startup, and an ID-based selection path. The web picker, map views, and exports use the catalog; the Tauri build stays on its fixed three crops.

**Tech Stack:** Static HTML/CSS/JavaScript, Supabase JS v2 and PostgreSQL, Node built-in test runner, existing Tauri static staging.

---

**Approved spec:** `docs/superpowers/specs/2026-10-01-shared-custom-crops-design.md`.

**Execution boundary:** This document is a plan, not permission to run SQL against the live Supabase project or push to `main`. Implement and test on a `codex/` branch or isolated worktree. Because Vercel deploys `main` automatically, run the additive SQL in the existing Supabase project before merging or pushing the feature to `main`.

**File map:**

| File | Responsibility |
| --- | --- |
| `docs/supabase-add-crops.sql` | Repeatable catalog table migration, validation, grants, and RLS. Never touches plot rows. |
| `supabase-sync.js` | Web-only Supabase fetch and insert adapter for catalog rows. |
| `crop-catalog.js` | Browser cache, built in/custom/unknown crop resolution, validation, refresh notifications. No DOM. |
| `crop-picker.js` | Picker search, cards, add form, and interaction states. No database access. |
| `crop-export.js` | Pure lookup and per-plot crop summary calculations for CSV export. |
| `app.js` | ID-based selection, painting, map/summaries, orchestration, ZIP packaging. |
| `calendar.js` | Safe crop readout for selected or unresolved IDs. |
| `taniman.html`, `styles.css`, `data.js` | Picker structure and styles; EN/TL/IL control text. |
| `src-tauri/scripts/prepare-dist.mjs` | Stage shared scripts, with web catalog actions disabled in Tauri. |
| `README.md`, `docs/supabase-setup.sql` | Deployment instructions and clear warning on the destructive reset script. |

## Chunk 1: Database and catalog foundation

### Task 1: Add the non-destructive Supabase migration

**Files:** Create `docs/supabase-add-crops.sql`; create `tests/crop-migration.test.mjs`.

- [ ] **Step 1: Write the failing migration source test.** In `tests/crop-migration.test.mjs`, read the new SQL file and assert it creates `public.crops`, enables RLS, revokes from `PUBLIC` and both app roles, grants only `select, insert` to `anon, authenticated`, contains distinct select/insert policies, and has no `drop table`, `truncate`, or mutation of `public.plots` or storage. Assert SQL reserves all distinct built in display names: lettuce, letsugas, potato, patatas, carrot, karot. Assert the same whitespace-collapse-then-trim expression is used in the length check, target-name check, and unique index. The behavioral SQL cases (tabs and duplicates) are verified in Task 8 against Supabase.
- [ ] **Step 2: Run `node --test tests/crop-migration.test.mjs`.** Expected: FAIL because the migration file does not exist.
- [ ] **Step 3: Write `docs/supabase-add-crops.sql` as a repeatable migration.** Use the following SQL contract. Keep each `if not exists` and policy drop so rerunning the file is safe. The `name` column is display text; the expression index is the authoritative comparison rule.

```sql
create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex text not null,
  created_at timestamptz not null default now(),
  constraint crops_name_length check (
    char_length(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) between 1 and 80
  ),
  constraint crops_hex_format check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint crops_not_target_name check (
    lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
      not in ('lettuce', 'letsugas', 'potato', 'patatas', 'carrot', 'karot')
  )
);

create unique index if not exists crops_normalized_name_uq
  on public.crops ((lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))));

alter table public.crops enable row level security;
revoke all on table public.crops from PUBLIC, anon, authenticated;
grant select, insert on table public.crops to anon, authenticated;

drop policy if exists crops_public_read on public.crops;
create policy crops_public_read on public.crops
  for select to anon, authenticated using (true);
drop policy if exists crops_public_insert on public.crops;
create policy crops_public_insert on public.crops
  for insert to anon, authenticated with check (true);
```

- [ ] **Step 4: Run `node --test tests/crop-migration.test.mjs`.** Expected: PASS. Inspect SQL manually for the absence of plot or storage reset statements; the source test does not execute SQL.
- [ ] **Step 5: Commit:** `git add docs/supabase-add-crops.sql tests/crop-migration.test.mjs && git commit -m "feat: add shared crop catalog migration"`.

### Task 2: Add a web-only Supabase catalog adapter

**Files:** Modify `supabase-sync.js`; create `tests/supabase-crops.test.mjs`.

- [ ] **Step 1: Write failing adapter tests** with a fake Supabase client in a VM. Cover reading `id,name,hex,created_at`, inserting only `name,hex`, returning the inserted row, propagating error codes such as `23505`, and rejecting reads/inserts when offline. The existing plot sync tests must still pass.
- [ ] **Step 2: Run `node --test tests/supabase-crops.test.mjs`.** Expected: FAIL because `window.fetchCustomCrops` and `window.insertCustomCrop` are absent.
- [ ] **Step 3: In `supabase-sync.js`, expose two web functions using its existing `initClient` and `isOnline`:**

```js
window.fetchCustomCrops = async function () {
  if (!isOnline()) throw new Error('offline');
  const { data, error } = await initClient().from('crops')
    .select('id,name,hex,created_at').order('name');
  if (error) throw error;
  return data || [];
};
window.insertCustomCrop = async function (name, hex) {
  if (!isOnline()) throw new Error('offline');
  const { data, error } = await initClient().from('crops')
    .insert({ name, hex }).select('id,name,hex,created_at').single();
  if (error) throw error;
  return data;
};
```

- [ ] **Step 4: Run `node --test tests/supabase-crops.test.mjs tests/supabase-season-source.test.mjs`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add supabase-sync.js tests/supabase-crops.test.mjs && git commit -m "feat: add Supabase crop catalog adapter"`.

### Task 3: Build the catalog model and cache

**Files:** Create `crop-catalog.js`; create `tests/crop-catalog.test.mjs`.

- [ ] **Step 1: Write failing catalog tests** in a VM with fake `window.CROPS`, localStorage, `fetchCustomCrops`, and `insertCustomCrop`. Test synchronous target-plus-cache hydration from a versioned `{version:1,rows:[...]}` cache; malformed JSON and invalid rows ignored; custom UUID mapping to `crop_<uuid>`; target-first ordering; search/name normalization (including tabs/newlines); target-name rejection across EN/TL/IL; valid hex; focus refresh calls sharing one in-flight request; stale refresh not overwriting a newly inserted row; `23505` conflict awaiting any older request and then fetching the authoritative existing row anew; subscription notifications; unknown referenced ID placeholders; Supabase failure preserving cache; and Tauri mode ignoring custom cache and remote calls.
- [ ] **Step 2: Run `node --test tests/crop-catalog.test.mjs`.** Expected: FAIL because the module is absent.
- [ ] **Step 3: Implement a DOM-free `window.TANIMAN_CROP_CATALOG` API:**

```js
// Required public operations; keep their return shapes documented in the module.
catalog.all();                    // target, custom, then referenced unknown crops
catalog.byId(cropId);             // known crop or unresolved placeholder; null for blank ID
catalog.isResolved(cropId);
catalog.isTarget(cropId);
catalog.registerReferences(plots); // collect season.cropId values; retain unknown IDs
catalog.subscribe(listener);     // returns unsubscribe function
catalog.refresh(options);        // Promise; default shares in-flight fetch; {force:true} starts a later fetch
catalog.create(name, hex);       // Promise<{status:'created'|'duplicate',crop}>; insert first if new
catalog.normalizeName(name);     // trim/collapse whitespace for UI precheck
```

  Hydrate targets and valid browser cache synchronously when the script loads. Keep the original `window.CROPS` array object and replace its contents on catalog changes, because `app.js` and `calendar.js` currently retain references to that array. Prefix custom UUIDs with `crop_`; use neutral color and `isResolved:false` for unknown IDs. Deduplicate ordinary refresh calls while one is in flight. Before applying a fetch response, compare a request generation value so a fetch started before an insert cannot remove the new entry. On insert error `23505`, await any older in-flight refresh, then force a fresh fetch from Supabase, find the existing name, and return the `duplicate` result for the picker to offer selection; if a Unicode normalization mismatch prevents matching locally, keep the refreshed list visible and show a duplicate error with search guidance. In Tauri mode expose target-only operations and skip custom cache/network calls.
- [ ] **Step 4: Run `node --test tests/crop-catalog.test.mjs`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add crop-catalog.js tests/crop-catalog.test.mjs && git commit -m "feat: model shared and unresolved crops"`.

## Chunk 2: Selection and picker UI

### Task 4: Migrate selection to a crop ID and wire script startup

**Files:** Modify `taniman.html`, `app.js`, `calendar.js`, `src-tauri/scripts/prepare-dist.mjs`, `tests/crop-targets.test.mjs`, `tests/season-control-helpers.test.mjs`; create `tests/crop-selection.test.mjs`.

- [ ] **Step 1: Write failing selection/startup tests.** Check that a persisted numeric `state.crop` of `0/1/2` maps to `lettuce/potato/carrot` before first render; a persisted `selectedCropId` wins over a numeric legacy value; a selected custom ID remains selected when a catalog refresh changes list order; a missing custom ID remains selected but blocks painting; `calendar.js` readout uses a safe fallback; `taniman.html` loads `crop-catalog.js` after `data.js`/`supabase-sync.js` and before `app.js`; and Tauri staging copies it. Update older source tests that assume array-index selection, without weakening their behavior checks.
- [ ] **Step 2: Run `node --test tests/crop-selection.test.mjs tests/crop-targets.test.mjs tests/season-control-helpers.test.mjs`.** Expected: new selection/startup assertions FAIL.
- [ ] **Step 3: Add `crop-catalog.js` to `taniman.html` before the dynamic `app.js` injection and to the `FILES` list in `src-tauri/scripts/prepare-dist.mjs`.** The catalog must synchronously hydrate before `app.js` initializes. Keep the Supabase SDK removed from the staged Tauri HTML as before.
- [ ] **Step 4: In `app.js`, normalize state immediately after `loadState()`:** set `state.selectedCropId` from a valid legacy numeric index if absent, default to `lettuce`, then delete or stop reading `state.crop`. Replace painting, cursor, palette selection, and `window.TANIMAN` exposure with ID-based lookup. `activePaintSeasonData()` returns `null` unless `catalog.isResolved(selectedCropId)` and dates are valid. Keep unknown selected IDs in state; show their placeholder until a catalog refresh resolves them. Shortcuts 1–3 select the targets only.
- [ ] **Step 5: In `calendar.js`, make `readoutModel()` use `catalog.byId(state.selectedCropId)` and tolerate a missing/unresolved crop.** It must always return text and a neutral dot; no `CROPS[state.crop]` dereference remains. Register referenced IDs from local plots before the first map/readout render, and register newly merged remote seasons before redraw. Subscribe the app and calendar readouts to catalog changes. After subscriptions are installed in `app.js`, call `catalog.refresh()` once on web startup and again when the tab regains focus (`window.focus`); use the in-flight deduplication from Task 3 and do not make startup wait for network. Test both triggers with a fake event target, and verify Tauri makes neither network call.
- [ ] **Step 6: Run `node --test tests/crop-selection.test.mjs tests/crop-targets.test.mjs tests/season-control-helpers.test.mjs` and `node --check app.js` and `node --check calendar.js`.** Expected: PASS and syntax checks exit 0.
- [ ] **Step 7: Commit:** `git add taniman.html app.js calendar.js src-tauri/scripts/prepare-dist.mjs tests/crop-selection.test.mjs tests/crop-targets.test.mjs tests/season-control-helpers.test.mjs && git commit -m "feat: select crops by stable ID"`.

### Task 5: Build the searchable picker and add form

**Files:** Create `crop-picker.js`, `tests/crop-picker.test.mjs`; modify `taniman.html`, `styles.css`, `data.js`, `src-tauri/scripts/prepare-dist.mjs`, `app.js`.

- [ ] **Step 1: Write failing picker tests** using a small fake DOM or browser harness. Cover target cards always visible, custom search filtering, selected custom crop indication when filtered out, duplicate-name choice, saving/error form states, and hidden Add crop controls in Tauri. Add translation assertions for the new EN/TL/IL UI keys.
- [ ] **Step 2: Run `node --test tests/crop-picker.test.mjs tests/translations.test.mjs`.** Expected: picker tests FAIL.
- [ ] **Step 3: Add markup to the crop section of `taniman.html`:** visible target group; other-crop heading and count; accessible search input; scrollable custom list; Add crop button; inline form with name input, color input, Save/Cancel, and an `aria-live` message. Use translated keys from `data.js`. Add `crop-picker.js` before `app.js` in both the web script order and Tauri `FILES` list.
- [ ] **Step 4: Implement `crop-picker.js` as a UI-only renderer** taking `{catalog, selectedCropId, lang, onSelect, onCreate}`. Escape crop names and IDs before interpolation, or use `textContent`. Normalize and precheck names against target/custom names. Offer the existing crop as a selection for local duplicates and a returned `{status:'duplicate',crop}` from a concurrent server insert. Use a deterministic suggested color from the existing palette, allow a valid `#RRGGBB` override, disable Save during insert, and keep entered values on failure. The app callback awaits `catalog.create()` and selects only a `{status:'created',crop}` result; a duplicate is selected only if the worker chooses that action. In Tauri, render the existing three target cards only.
- [ ] **Step 5: Add styles in `styles.css`** for the group headings, search, scroll region, form errors, focus state, and narrow screens. Keep touch controls at least as large as nearby existing buttons. Bound the custom list and expanded map legend height so a large catalog does not take over the screen.
- [ ] **Step 6: Run `node --test tests/crop-picker.test.mjs tests/translations.test.mjs` and `node --check crop-picker.js`.** Expected: PASS. Inspect the picker at desktop and narrow widths in a browser before committing.
- [ ] **Step 7: Commit:** `git add crop-picker.js tests/crop-picker.test.mjs taniman.html styles.css data.js src-tauri/scripts/prepare-dist.mjs app.js && git commit -m "feat: add searchable custom crop picker"`.

## Chunk 3: Complete ground truth parity and rollout

### Task 6: Include custom and unresolved crops in views

**Files:** Modify `app.js`; create `tests/crop-views.test.mjs`; modify `tests/map-composition-legend.test.mjs` as needed.

- [ ] **Step 1: Write failing view tests** with a custom ID and an unknown ID on separate seasons. Check map composition/legend counts, schedule summary, farmer roster, mixed-cell drawing, and label PNG paint colors resolve both IDs. Include a crop name and raw unknown ID containing HTML metacharacters and assert neither creates markup in the legend, schedule summary, or roster. Assert each season's crop remains visible/countable when the remote catalog fetch fails. Retain existing overlap behavior tests.
- [ ] **Step 2: Run `node --test tests/crop-views.test.mjs tests/map-composition-legend.test.mjs`.** Expected: new view assertions FAIL.
- [ ] **Step 3: Update `app.js` view paths** (`cropIndexFromId`, `cellVisibleCrops`, `plotCompositionForView`, `drawMixedCell`, `updateLegend`, `renderScheduleSummary`, `buildRosterData`, and map composition bars) to consume the catalog's current known plus referenced crop array. Call `catalog.registerReferences(state.plots)` before building fixed-length count arrays on startup, remote merge, undo/redo, and before export. Render an unresolved crop with the neutral color and `Unknown crop (<id>)`; do not filter it out with `cropIdx < 0`. Use `textContent` or one HTML-escaping helper for every crop name and raw ID interpolated into `innerHTML`, including schedule summary, legend, roster, and map overlays. Keep targets first and custom crops name-sorted.
- [ ] **Step 4: Run `node --test tests/crop-views.test.mjs tests/map-composition-legend.test.mjs tests/map-month-range-integration.test.mjs`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add app.js tests/crop-views.test.mjs tests/map-composition-legend.test.mjs && git commit -m "feat: show every labeled crop in map views"`.

### Task 7: Export every crop with a joinable class lookup

**Files:** Create `crop-export.js`, `tests/crop-export.test.mjs`; modify `app.js`, `taniman.html`, `src-tauri/scripts/prepare-dist.mjs`, `README.md`, `tests/season-state-source.test.mjs` as needed.

- [ ] **Step 1: Write failing pure export tests** for target, custom, and unresolved IDs. Use two seasons on the same cell and assert two `season_cell_rows` for that crop; use another plot with zero observations and assert it has no normalized count rows. Check one lookup row per ID, including `is_resolved=false` placeholders, and safe CSV escaping of names/IDs.
- [ ] **Step 2: Run `node --test tests/crop-export.test.mjs`.** Expected: FAIL because the module is absent.
- [ ] **Step 3: Implement `window.TANIMAN_CROP_EXPORT` in `crop-export.js`** as pure helpers accepting the already produced `seasonExportRows` and a catalog snapshot. Return (a) all crop lookup rows, including referenced unknowns, and (b) sparse `{plot_idx,crop_id,season_cell_rows}` rows counted directly from `seasons.csv`-equivalent rows. Keep target flags as metadata only. Provide one CSV-escaping helper for all new text columns. Add the script before `app.js` in web HTML and Tauri staging.
- [ ] **Step 4: Update `app.js` ZIP generation.** Preserve all season rows, including unknown IDs. Apply `csvEscape` to every CSV text value, especially `season_id`, `crop_id`, `farmer_id`, custom names, unresolved raw IDs, plot notes, and farmer crop-ID lists; numeric coordinates, indexes, and boolean flags remain unquoted values. Add `crops.csv` (`crop_id,crop_name,hex,is_target,is_resolved`) and `plot_crop_counts.csv` (`plot_idx,crop_id,season_cell_rows`). `labels.csv` uses the resolved or placeholder name. Keep `plots.csv` lettuce/potato/carrot columns and add `other_crop_cells`, all counted from season-cell rows. Keep `farmers.csv` crop ID lists complete, and set metadata schema version to 5 with the same lookup rows. Do not use label PNG colors as training labels.
- [ ] **Step 5: Run `node --test tests/crop-export.test.mjs tests/season-utils.test.mjs tests/season-state-source.test.mjs` and `node --check crop-export.js`.** Expected: PASS. Export a sample ZIP and compare `plot_crop_counts.csv` totals against grouped `seasons.csv` rows.
- [ ] **Step 6: Commit:** `git add crop-export.js tests/crop-export.test.mjs app.js taniman.html src-tauri/scripts/prepare-dist.mjs README.md tests/season-state-source.test.mjs && git commit -m "feat: export custom crops as full ground truth classes"`.

### Task 8: Document setup, run the full verification, and stage deployment

**Files:** Modify `README.md`, `docs/supabase-setup.sql`; modify any failing tests only when their expectations are intentionally superseded.

- [ ] **Step 1: Update `README.md` with a dedicated Existing Supabase project section.** State the exact order: back up data if desired; in the existing project's SQL Editor run `docs/supabase-add-crops.sql`; verify `public.crops` exists; then merge/push the feature to `main` for Vercel auto deploy; reload two browsers and verify shared crop creation/painting/export. State that no new Vercel environment variable, Supabase project, key, bucket, or manual seed rows are needed. Tell readers not to run the existing reset script on an existing project.
- [ ] **Step 2: Add a leading destructive-reset warning to `docs/supabase-setup.sql`.** Preserve its current initial-setup semantics and tests. Document that a fresh project runs the setup script and then the additive crop script.
- [ ] **Step 3: Run `node --test`, `node --check app.js`, `node --check calendar.js`, `node --check supabase-sync.js`, and `git diff --check`.** Expected: all tests pass, syntax checks exit 0, no whitespace errors. If a browser runner or build tool was used, follow `process-hygiene` before ending that implementation session.
- [ ] **Step 4: Local browser smoke test with all Supabase requests isolated:** start `python -m http.server 8080`; open `http://localhost:8080/taniman.html` in a browser harness that intercepts the configured Supabase host's requests for both `public.crops` and `public.plots` (reads, inserts, upserts, deletes, and photo/storage calls). Return fixture rows for the catalog and plots, and assert that no request reaches the live Supabase project. Verify desktop and narrow-screen picker, duplicate feedback, custom crop paint/legend/roster, export ZIP, and offline/fetch-error fallback. Run `npm run prepare-dist` from `src-tauri/` and confirm the staged offline HTML shows only the three target crops. Stop the local server afterward.
- [ ] **Step 5: After the user-approved migration is run on the existing Supabase project, verify it with the web anon client:** `SELECT` and `INSERT` into `public.crops` succeed, while `UPDATE` and `DELETE` are denied. Run the SQL again and confirm it is repeatable. Through the SQL Editor, use **separate** rollback transactions for tab-only and `Lettuce` plus tab failures, since a constraint error aborts its transaction. In a third transaction insert a unique throwaway name, then insert the same name followed by a tab and expect a uniqueness error; roll back that transaction. Check plot row count before/after to confirm no plot data was touched. Use a unique test crop and retain it as a valid catalog entry or remove it through the dashboard if the user prefers; app users have no delete control.
- [ ] **Step 6: With the migrated project, perform the real two-browser smoke test:** in browser A add a custom crop, then reload browser B and select it; paint a season/cell, reload both, and inspect the ZIP's `seasons.csv`, `crops.csv`, and `plot_crop_counts.csv` for that ID. Run this before merging to `main`, using a local or preview deployment pointed at the existing migrated project.
- [ ] **Step 7: Commit:** `git add README.md docs/supabase-setup.sql && git commit -m "docs: explain shared crop rollout"`. Review the branch diff and hand off the exact migration file and deploy order before merging to `main`.

## Deployment configuration answer

The implementation requires **one manual database change** in the existing Supabase project: run `docs/supabase-add-crops.sql` in the Supabase SQL Editor. That file creates the custom crop table, validation, grants, and RLS policies. It does not clear or migrate `public.plots`; its `seasons` JSONB already stores string crop IDs. Run it **before** pushing the feature to `main`, since Vercel automatically deploys that branch. The current `config.js`, Supabase URL/key, Vercel settings, and photo bucket do not need to change. Do **not** run `docs/supabase-setup.sql` on the existing project: it drops and recreates `public.plots`.

After Vercel deploys, add a test crop in one browser, reload another browser, and check that both can select it. Paint a cell and confirm `seasons.csv` includes its ID and `crops.csv` resolves the ID to the name. If the SQL has not been run yet, the three built in crops remain available, but adding a shared crop will report a catalog error.
