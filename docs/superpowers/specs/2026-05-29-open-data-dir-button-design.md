# Open Data Directory Button — Design Spec

**Date:** 2026-05-29  
**Status:** Approved

## Summary

Add a secondary "Open folder" button to the footer that opens the app's data directory in the system file manager. Covers all app-generated data: `state.json`, `photos/`, and `exports/`.

## Placement

Footer (`.ftr`), to the left of the existing "Save all (.zip)" primary button. Both are file/data actions and belong together.

## Appearance

- Styled with `.hdr-action` (bg-2, border, rounded, 40px height) — consistent with the Farmers button weight
- Label: `⊞ Open folder` (folder glyph + text)
- Smaller visual weight than the primary save button
- Only rendered/visible when `window.__TAURI__` is present (hidden in browser/Vercel mode)

## Behavior

- Click invokes a new Tauri command `open_data_dir`
- Rust command opens `<exe_dir>/data/` in the system file manager using the `PathBuf` already managed via the `DataDir` state (no string path manipulation):
  - **Windows:** `std::process::Command::new("explorer").arg(&state.0)`
  - **macOS:** `std::process::Command::new("open").arg(&state.0)`
  - **Linux:** not supported; `#[cfg]` guards ensure it compiles but the button is omitted at the JS level (only `window.__TAURI__` check is needed — Linux builds are out of scope)
- The data directory is always guaranteed to exist: `main.rs` creates it at launch and exits the process with an error dialog if creation fails, so `open_data_dir` will never be called against a missing directory
- No new Cargo dependencies required (uses `std::process::Command`)

## Error Handling

- If the `open`/`explorer` spawn fails (e.g., file manager not available), the error is logged to console only — no UI disruption. This is a convenience utility, not a critical data path.
- The JS handler wraps the invoke in a try/catch and calls `console.warn` on failure.

## Implementation

| File | Change |
|------|--------|
| `src-tauri/src/main.rs` | Add `open_data_dir` command using `state.0: PathBuf` directly; add to `invoke_handler![get_data_dir, write_photo, save_zip, open_data_dir]` |
| `taniman.html` | Add button element in `.ftr` with `style="display:none"` by default |
| `app.js` | On init, if `window.__TAURI__`: show button, wire click handler with try/catch around invoke |
| `styles.css` | No new CSS — reuse `.hdr-action` |
