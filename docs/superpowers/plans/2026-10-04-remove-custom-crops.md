# Remove Custom Crops Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users permanently remove a shared custom crop and all painted seasons that use it, after an explicit confirmation.

**Architecture:** Add an atomic Supabase RPC that accepts a custom crop ID, deletes matching season entries from every `public.plots.seasons` JSONB array, then deletes the catalog row. A plot-write trigger rejects later stale custom IDs that no longer exist in the catalog. The browser catalog calls the RPC and removes the custom row from its stable in-memory/cache state; the app also removes matching local seasons before its next sync. The picker renders a remove button only for non-target crops and presents a native confirmation that names the crop and its consequences.

**Tech Stack:** Browser JavaScript, Supabase/PostgREST RPC, PostgreSQL JSONB, Node.js built-in test runner.

---

## Chunk 1: Destructive catalog operation

### Task 1: Prove and implement the catalog deletion contract

**Files:**
- Modify: `tests/crop-catalog.test.mjs`
- Modify: `crop-catalog.js`
- Modify: `supabase-sync.js`
- Modify: `docs/supabase-add-crops.sql`

- [ ] **Step 1: Write failing tests** for a `catalog.remove(cropId)` API that rejects target/unknown IDs, calls the server deletion API for a custom ID, removes it from the live catalog/cache after success, and retains it after failure. Add adapter tests that validate UUID input, invoke the intended RPC, return its numeric removed-season count, and reject Supabase RPC errors.
- [ ] **Step 2: Run** `node --test tests/crop-catalog.test.mjs` and confirm the new tests fail because `remove` is absent.
- [ ] **Step 3: Implement the minimum browser catalog API.** It must call `window.deleteCustomCrop`, remove only the confirmed custom ID from the catalog, rebuild/persist/notify, and return the RPC’s removed-season count.
- [ ] **Step 4: Add `window.deleteCustomCrop`** in `supabase-sync.js` using `.rpc('delete_crop_and_seasons', { crop_id: <UUID> })`; validate a raw UUID before the call, throw the returned Supabase error, and normalize the scalar response to a non-negative numeric removed-season count.
- [ ] **Step 5: Add an idempotent SQL migration** that creates `delete_crop_and_seasons(uuid)`: lock/check the crop, count matching season entries, rewrite every matching `seasons` JSONB array without entries whose `cropId` is `crop_<uuid>`, update `updated_at`, then delete the catalog row and return one `bigint` count. Treat NULL/non-array seasons as an empty array and retain each nonmatching JSON value in original order. The `SECURITY DEFINER` function must have a fixed `search_path`, fully qualified application objects, revoked PUBLIC execute, and grants only to the application roles; an exception rolls the complete transaction back.
- [ ] **Step 6: Add a `public.plots` write trigger** that permits the three built-in IDs and custom `crop_<uuid>` IDs that still exist in `public.crops`, while rejecting stale/deleted custom crop IDs. Its validation must acquire `FOR KEY SHARE` on each referenced custom crop row, which conflicts with the deletion RPC's `FOR UPDATE`: a concurrent write therefore commits before cleanup or waits and is rejected after deletion. Preserve already-stored unrelated legacy/unknown IDs by validating only custom IDs newly introduced by `NEW` relative to `OLD` (or prevalidate them before enabling the trigger).
- [ ] **Step 7: Run** `node --test tests/crop-catalog.test.mjs tests/supabase-crops.test.mjs` and confirm all catalog/adapter tests pass.

## Chunk 2: Picker confirmation

### Task 2: Prove and implement removable custom-crop controls

**Files:**
- Modify: `tests/crop-picker.test.mjs`
- Modify: `crop-picker.js`
- Modify: `app.js`
- Modify: `data.js`
- Modify: `styles.css`

- [ ] **Step 1: Write failing picker tests** that custom rows have an adjacent, separately labelled remove button, target rows do not, the native confirmation receives the selected crop name and permanent deletion warning, cancelling does not call deletion and preserves focus, and accepting calls `onRemove` exactly once while pending controls are disabled.
- [ ] **Step 2: Run** `node --test tests/crop-picker.test.mjs` and confirm the new tests fail because removal controls are absent.
- [ ] **Step 3: Implement the smallest picker change.** Render a dedicated Remove button beside each custom crop; on click use `window.confirm` with localized copy naming the crop and explaining that its crop record and every painted cell/season in every plot will be permanently removed. Do not show a control for targets; while a removal is pending, disable selection, creation, and all removal controls.
- [ ] **Step 4: Wire `onRemove` from `app.js`** to `CropCatalog.remove`. Only on RPC success, remove matching seasons from every local plot, clear undo/redo history that could restore them, persist/redraw the state, and select the first target if the removed crop was active. Do not issue full stale local upserts after the RPC; instead update local sync metadata or refresh the affected remote rows authoritatively. On failure, retain the catalog, local plots, and current selection and surface a localized error.
- [ ] **Step 5: Add EN, TL, and IL strings and focused CSS** for the accessible control and removal success/error feedback; success copy accurately reports removed season entries, not cells.
- [ ] **Step 6: Run** `node --test tests/crop-picker.test.mjs` and confirm all picker tests pass.

## Chunk 3: Full verification

### Task 3: Verify the complete change

**Files:**
- Verify: `tests/*.test.mjs`
- Verify: `docs/supabase-add-crops.sql`

- [ ] **Step 1: Run** `node --test tests/*.test.mjs` and confirm the full suite passes.
- [ ] **Step 2: Inspect the diff** to verify: targets cannot be removed; confirmation names the crop and states painted cells are permanently removed; database rewrite and catalog deletion are in one transaction; no changes touch unrelated plot data.
- [ ] **Step 3: Commit** the focused implementation only after successful verification.
