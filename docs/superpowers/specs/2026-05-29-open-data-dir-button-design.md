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
- Rust command opens `<exe_dir>/data/` in the system file manager:
  - **Windows:** `explorer <path>`
  - **macOS:** `open <path>`
- No new Cargo dependencies required (uses `std::process::Command`)

## Implementation

| File | Change |
|------|--------|
| `src-tauri/src/main.rs` | Add `open_data_dir` command with `#[cfg(target_os)]` branching; register in `invoke_handler` |
| `taniman.html` | Add button element in `.ftr`, hidden by default, shown only in Tauri mode |
| `app.js` | Wire click handler gated on `window.__TAURI__` |
| `styles.css` | No new CSS — reuse `.hdr-action` |
