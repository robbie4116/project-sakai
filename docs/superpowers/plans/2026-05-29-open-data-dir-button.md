# Open Data Directory Button — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Open folder" button to the Taniman footer that opens the app data directory in the system file manager on Windows and macOS.

**Architecture:** A new Rust command `open_data_dir` uses the already-managed `DataDir` state (`PathBuf`) to spawn the native file manager. The JS init block shows the button and wires the click handler only when `window.__TAURI__` is present; the button is hidden by default in the HTML so the Vercel/browser build is unaffected.

**Tech Stack:** Tauri v2, Rust `std::process::Command`, vanilla JS, HTML/CSS.

---

## Chunk 1: Rust command + frontend wiring

### Task 1: Add `open_data_dir` Rust command

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add the command function**

In `src-tauri/src/main.rs`, add the following function after the `save_zip` function (before `fn main()`):

```rust
#[tauri::command]
fn open_data_dir(state: tauri::State<DataDir>) -> Result<(), String> {
    let path = &state.0;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Register command in invoke_handler**

Find this line in `fn main()`:

```rust
.invoke_handler(tauri::generate_handler![get_data_dir, write_photo, save_zip])
```

Replace it with:

```rust
.invoke_handler(tauri::generate_handler![get_data_dir, write_photo, save_zip, open_data_dir])
```

- [ ] **Step 3: Verify it compiles**

```powershell
cd src-tauri && cargo check
```

Expected: no errors. Warnings about unused imports are fine.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tauri): add open_data_dir command"
```

---

### Task 2: Add button to HTML

**Files:**
- Modify: `taniman.html`

- [ ] **Step 1: Add button to footer**

Find this block in `taniman.html` (lines ~181–195):

```html
  <footer class="ftr">
    <div class="progress-wrap">
```

Locate the `<button class="btn-primary" id="btn-save">` line. Insert the new button immediately before it:

```html
      <button class="hdr-action" id="btn-open-dir" style="display:none" title="Open data folder">
        <span>⊞</span>
        <span>Open folder</span>
      </button>
```

The footer block should now read:

```html
  <footer class="ftr">
    <div class="progress-wrap">
      <div class="progress-text">
        <strong id="prog-done">0</strong> <span id="prog-marked-label">plots marked</span>
        <span style="opacity:.4;padding:0 10px">·</span>
        <strong id="prog-patches">0</strong> <span id="prog-painted-label">patches painted</span>
      </div>
    </div>
    <div class="autosave"><span class="pulse"></span><span id="autosave-txt">Auto-saved · just now</span></div>
    <button class="hdr-action" id="btn-open-dir" style="display:none" title="Open data folder">
      <span>⊞</span>
      <span>Open folder</span>
    </button>
    <button class="btn-primary" id="btn-save">
      <span>↓</span>
      <span id="btn-save-txt">Save all (.zip)</span>
      <span class="count" id="save-count">0</span>
    </button>
  </footer>
```

- [ ] **Step 2: Commit**

```bash
git add taniman.html
git commit -m "feat(html): add open-folder button to footer (hidden by default)"
```

---

### Task 3: Wire button in JS

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Find the Tauri-gated block near the bottom of app.js**

Look for this line near the end of `app.js` (around line 1594):

```js
if (!window.__TAURI__) seedDemoIfEmpty();
```

- [ ] **Step 2: Add button wiring just above that line**

Insert the following block immediately before `if (!window.__TAURI__) seedDemoIfEmpty();`:

```js
if (window.__TAURI__) {
  const btnOpenDir = document.getElementById('btn-open-dir');
  btnOpenDir.style.display = '';
  btnOpenDir.onclick = async () => {
    try {
      await window.__TAURI__.core.invoke('open_data_dir');
    } catch (e) {
      console.warn('open_data_dir failed', e);
    }
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(js): wire open-folder button for Tauri builds"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Build and run the Tauri app**

```powershell
npm run tauri dev
```

- [ ] **Step 2: Verify button appears in footer**

The "Open folder" button should be visible to the left of the "Save all (.zip)" button. It should NOT appear in the browser at `taniman.html` opened directly.

- [ ] **Step 3: Click the button**

The system file manager (Explorer on Windows, Finder on macOS) should open the `data/` directory next to the executable. Confirm `state.json` (or an empty-but-created folder) is visible.

- [ ] **Step 4: Verify no console errors**

Open DevTools in the Tauri window. No errors should appear on click.

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix: open-folder button adjustments after smoke test"
```
