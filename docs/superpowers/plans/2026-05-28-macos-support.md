# macOS Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add macOS `.dmg` build support to the Taniman Tauri app and set up GitHub Actions CI to build both Windows and macOS installers on every push to `main`.

**Architecture:** Two pure config changes — update `src-tauri/tauri.conf.json` to declare macOS bundle settings, then create `.github/workflows/build.yml` with parallel Windows/macOS build jobs. No Rust code changes required.

**Tech Stack:** Tauri v2, Rust stable, Node 20, GitHub Actions (`actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`, `actions/setup-node@v4`, `actions/upload-artifact@v4`)

---

## Chunk 1: Config and CI

### Task 1: Baseline Windows smoke-test

Confirm the current Windows build still works before any changes, so you have a regression baseline.

**Files:**
- No changes

- [ ] **Step 1: Run prepare-dist**

  In a terminal, from `src-tauri/`:
  ```
  npm run prepare-dist
  ```
  Expected: script exits 0, prints something like:
  ```
  prepare-dist: staged taniman.html→index.html + 8 files + 3 dirs into ...\dist-static
  prepare-dist: total size X.XX MB
  prepare-dist: stripped 1 Supabase CDN <script> tag(s)
  ```

- [ ] **Step 2: Confirm dist-static was populated**

  Check that `src-tauri/dist-static/` contains `index.html`, `app.js`, `tiles/`, `vendor/`, `fonts/`. If any are missing, stop — `prepare-dist.mjs` is broken and must be fixed before proceeding.

---

### Task 2: Update `src-tauri/tauri.conf.json`

Add macOS bundle settings and update the bundle targets.

**Files:**
- Modify: `src-tauri/tauri.conf.json`

Current `bundle` section (lines 26–36):
```json
"bundle": {
  "active": true,
  "targets": ["app"],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.ico",
    "icons/icon.png"
  ]
}
```

- [ ] **Step 1: Replace the `bundle` section**

  Replace the entire `bundle` block with:
  ```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico",
      "icons/icon.png"
    ],
    "macOS": {
      "minimumSystemVersion": "11.0",
      "frameworks": []
    }
  }
  ```

  Changes:
  - `"targets"` changed from `["app"]` to `"all"` — Tauri builds platform-appropriate bundles per OS
  - `"icons/icon.icns"` added — the file already exists in `src-tauri/icons/`
  - `"macOS"` block added — `"11.0"` is the required minimum for arm64 (Apple Silicon) binaries

- [ ] **Step 2: Validate JSON**

  Run from `src-tauri/`:
  ```
  node -e "require('./tauri.conf.json'); console.log('JSON valid')"
  ```
  Expected: `JSON valid`

- [ ] **Step 3: Re-run prepare-dist to confirm nothing broke**

  ```
  npm run prepare-dist
  ```
  Expected: same success output as Task 1 Step 1.

- [ ] **Step 4: Commit**

  ```
  git add src-tauri/tauri.conf.json
  git commit -m "feat(tauri): add macOS bundle config and icon.icns"
  ```

---

### Task 3: Create `.github/workflows/build.yml`

New GitHub Actions workflow that builds Windows NSIS installer and macOS DMG in parallel on every push to `main`.

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create the workflows directory**

  ```
  mkdir -p .github/workflows
  ```
  (No-op if it already exists.)

- [ ] **Step 2: Create `.github/workflows/build.yml`**

  ```yaml
  name: Build

  on:
    push:
      branches: [main]

  jobs:
    build-windows:
      runs-on: windows-latest
      steps:
        - uses: actions/checkout@v4

        - uses: dtolnay/rust-toolchain@stable

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: "src-tauri -> target"

        - uses: actions/setup-node@v4
          with:
            node-version: 20

        - name: Install JS dependencies
          working-directory: src-tauri
          run: npm ci

        - name: Build Windows installer
          working-directory: src-tauri
          run: npm run build -- --bundles nsis

        - uses: actions/upload-artifact@v4
          with:
            name: taniman-windows
            path: src-tauri/target/release/bundle/nsis/
            retention-days: 90

    build-macos:
      runs-on: macos-latest
      steps:
        - uses: actions/checkout@v4

        - uses: dtolnay/rust-toolchain@stable

        - uses: Swatinem/rust-cache@v2
          with:
            workspaces: "src-tauri -> target"

        - uses: actions/setup-node@v4
          with:
            node-version: 20

        - name: Install JS dependencies
          working-directory: src-tauri
          run: npm ci

        - name: Build macOS DMG
          working-directory: src-tauri
          run: npm run build -- --bundles dmg

        - uses: actions/upload-artifact@v4
          with:
            name: taniman-macos
            path: src-tauri/target/release/bundle/dmg/
            retention-days: 90
  ```

  Notes on the workflow:
  - `npm run build -- --bundles nsis` passes `--bundles nsis` to `tauri build`. Tauri automatically runs `beforeBuildCommand` (`npm run prepare-dist`) before compiling.
  - `Swatinem/rust-cache@v2` with `workspaces: "src-tauri -> target"` caches compiled Rust dependencies in `src-tauri/target/`. Without this, each run does a full LTO compile (~20–30 min).
  - `working-directory: src-tauri` ensures all commands run where `tauri.conf.json` lives.

- [ ] **Step 3: Commit**

  ```
  git add .github/workflows/build.yml
  git commit -m "ci: add Windows + macOS build workflow"
  ```

---

### Task 4: Push and verify CI

- [ ] **Step 1: Push the branch to trigger CI**

  ```
  git push origin dev
  ```
  (Or merge to `main` if you want the workflow to fire — the trigger is `push: branches: [main]`.)

  To trigger the workflow, either:
  - Merge `dev` → `main`, or
  - Temporarily change the trigger to `branches: [dev]` while testing, then revert

- [ ] **Step 2: Monitor the Actions run**

  Go to your GitHub repo → Actions tab → "Build" workflow.
  Expected: both `build-windows` and `build-macos` jobs appear and turn green (first run will be slow — 20–30 min without warm cache).

- [ ] **Step 3: Download and spot-check artifacts**

  - Download `taniman-windows` artifact — should contain a `.exe` NSIS installer
  - Download `taniman-macos` artifact — should contain a `.dmg` file
  - On a Mac: mount the DMG, drag to Applications, right-click → Open (bypass Gatekeeper), verify the map loads

- [ ] **Step 4: If macOS job fails**

  Common failure modes and fixes:
  - **`error: unknown bundle format 'dmg'`** — Tauri CLI version doesn't support DMG on macOS runners; run `npm update` in `src-tauri/` and commit the updated `package-lock.json`
  - **`Missing source directory: tiles`** — the `tiles/` directory is unexpectedly absent from the CI checkout; check that it's not accidentally gitignored in a parent `.gitignore`
  - **`prepare-dist: Supabase CDN <script> regex matched zero tags`** — `taniman.html` was modified and the CDN script tag changed; update the regex in `prepare-dist.mjs`

---

## Spec Reference

`docs/superpowers/specs/2026-05-28-macos-support-design.md`
