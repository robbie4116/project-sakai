# macOS Support for Taniman Tauri App

**Date:** 2026-05-28  
**Status:** Approved  
**Scope:** Add macOS `.dmg` build support to the Taniman standalone Tauri app, plus GitHub Actions CI for automated Windows and macOS builds on every push to `main`.

---

## Background

The Taniman app is a Tauri v2 desktop application that bundles a static offline frontend (crop mapping tool) for field researchers with no internet access. It currently builds only for Windows. The Rust code is already platform-agnostic; the only blockers are configuration-level.

Distribution is direct download (unsigned). Users are internal/thesis stakeholders, so the macOS Gatekeeper prompt on first launch is acceptable (right-click → Open).

---

## Goals

1. The app builds and runs on macOS Apple Silicon (M-series Macs).
2. A `.dmg` disk image is produced for macOS distribution.
3. GitHub Actions automatically builds a Windows NSIS installer and a macOS `.dmg` on every push to `main`.
4. Local Mac builds work with `cd src-tauri && npm run build`.

## Non-Goals

- macOS codesigning / notarization.
- App Store distribution.
- Intel Mac (x86_64) support — `macos-latest` runners are Apple Silicon (arm64); Intel Macs are not targeted.
- Linux support.
- GitHub Releases / artifact persistence beyond 90 days.

---

## Architecture

No architectural changes. The app's data model, file I/O, and Tauri plugin usage are already cross-platform. This is a pure configuration change plus a new CI workflow file.

The `prepare-dist.mjs` script copies `vendor/`, `fonts/`, and `tiles/` directories from the repo root. These directories are committed to the repository (confirmed: not in `.gitignore`) and will be present in CI after checkout.

---

## Changes

### 1. `src-tauri/tauri.conf.json`

**Three targeted modifications:**

**a) Update `bundle.targets`** from `["app"]` to `"all"`:
```json
"targets": "all"
```
Using `"all"` lets Tauri build platform-appropriate bundles on each OS (it ignores non-applicable targets). CI jobs will further narrow this with the `--bundles` CLI flag to produce exactly one artifact type per job.

**b) Add `bundle.macOS` block:**
```json
"macOS": {
  "minimumSystemVersion": "11.0",
  "frameworks": []
}
```
- `"11.0"` is the correct minimum for arm64 (Apple Silicon) binaries; setting `"10.13"` or `"10.15"` is invalid for arm64 targets.
- `"frameworks": []` explicitly declares no extra native frameworks are required.

**c) Add `icons/icon.icns` to `bundle.icon`:**
```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico",
  "icons/icon.png"
]
```
`icons/icon.icns` already exists in the repo; it just needs to be referenced.

No changes to `app.windows` (the webview window definition is already cross-platform).  
No changes to Rust source, Cargo.toml, or capability files.

---

### 2. `.github/workflows/build.yml` (new file)

Triggered on every push to `main`. Two parallel jobs.

**`build-windows`** (runs on `windows-latest`):
1. `actions/checkout@v4`
2. `dtolnay/rust-toolchain@stable`
3. `Swatinem/rust-cache@v2` with `workspaces: "src-tauri -> target"` — avoids full LTO recompile on each run
4. `actions/setup-node@v4` with Node 20
5. `npm ci` in `src-tauri/` (lockfile is committed at `src-tauri/package-lock.json`)
6. `npm run build -- --bundles nsis` in `src-tauri/` — Tauri CLI runs `beforeBuildCommand` (`prepare-dist`) automatically, then builds
7. `actions/upload-artifact@v4` — path: `src-tauri/target/release/bundle/nsis/`, name: `taniman-windows`

**`build-macos`** (runs on `macos-latest`, Apple Silicon / arm64):
1–5. Same as Windows job
6. `npm run build -- --bundles dmg` in `src-tauri/`
7. `actions/upload-artifact@v4` — path: `src-tauri/target/release/bundle/dmg/`, name: `taniman-macos`

Both artifacts are downloadable from the GitHub Actions run page for 90 days.

---

## Data Flow

No changes to runtime data flow. The app locates its `data/` directory relative to the executable path using `std::env::current_exe()`. On macOS, the executable lives at `Taniman.app/Contents/MacOS/Taniman`; the `data/` directory is expected adjacent to it inside the bundle. This matches how the Windows build works and requires no code change.

---

## Error Handling

- If `prepare-dist` fails in CI (missing source files), `tauri build` will not run — the job fails clearly.
- No new error handling required in Rust code.

---

## Testing

1. **macOS smoke test:** Mount the `.dmg`, drag app to Applications, launch. Verify the map loads, plots can be added, and offline data persists across restarts.
2. **Gatekeeper test:** On first launch, confirm right-click → Open bypasses the unsigned app warning.
3. **Windows regression:** Confirm the Windows NSIS installer still produces a working app after the `tauri.conf.json` changes.
4. **CI verification:** Push to `main`, confirm both `taniman-windows` and `taniman-macos` artifacts appear in the GitHub Actions run.

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | Update `bundle.targets` to `"all"`, add `bundle.macOS` block, add `icons/icon.icns` to icon list |
| `.github/workflows/build.yml` | New — CI workflow building Windows NSIS + macOS DMG in parallel |
