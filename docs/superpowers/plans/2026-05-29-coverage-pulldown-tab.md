# Coverage Pull-Down Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the collapsed visible crop coverage legend with a compact pull-down tab under the Ambassador map header.

**Architecture:** The app uses shared static files for Vercel and Tauri. Change `taniman.html`, `styles.css`, and possibly `app.js` once at the root; `src-tauri/scripts/prepare-dist.mjs` copies those files into desktop bundles.

**Tech Stack:** Static HTML/CSS/JavaScript, Node test scripts, Tauri prepare-dist staging for Windows/macOS.

---

## Chunk 1: Compact Legend Tab

### Task 1: Add regression tests for the collapsed tab

**Files:**
- Modify: `tests/map-composition-legend.test.mjs`
- Read: `taniman.html`
- Read: `styles.css`
- Read: `src-tauri/scripts/prepare-dist.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that read the static files and assert:

```js
test('coverage legend starts as a compact pull-down tab', () => {
  const html = readFileSync('taniman.html', 'utf8');
  const css = readFileSync('styles.css', 'utf8');

  assert.match(html, /class="map-legend collapsed"/);
  assert.match(html, /aria-label="Show visible crop coverage"/);
  assert.match(html, /<span id="lgd-head-txt">Coverage<\/span>/);
  assert.match(css, /\.map-legend\.collapsed\{/);
  assert.match(css, /border-radius:0 0 9px 9px/);
  assert.match(css, /border-top:0/);
});

test('offline desktop staging includes the shared legend source files', () => {
  const script = readFileSync('src-tauri/scripts/prepare-dist.mjs', 'utf8');

  assert.match(script, /cpSync\(tanimanSrc, join\(DIST, 'index\.html'\)\)/);
  assert.match(script, /'app\.js', 'data\.js', 'styles\.css', 'config\.js'/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/map-composition-legend.test.mjs`

Expected: fails because the legend does not start collapsed and does not expose the compact tab markup/CSS yet.

### Task 2: Implement the compact collapsed state

**Files:**
- Modify: `taniman.html`
- Modify: `styles.css`
- Modify: `app.js`

- [ ] **Step 1: Update markup**

Set the legend to start collapsed:

```html
<div class="map-legend collapsed" id="map-legend">
```

Make `#lgd-head` a real button-like toggle:

```html
<button class="lgd-head" id="lgd-head" type="button" aria-expanded="false" aria-label="Show visible crop coverage">
  <span id="lgd-head-txt" data-expanded-label="Visible crop coverage" data-collapsed-label="Coverage">Coverage</span>
  <span class="lgd-chevron" aria-hidden="true">▾</span>
</button>
```

- [ ] **Step 2: Update CSS**

Keep expanded styling close to the current overlay, and make the collapsed state a small tab:

```css
.map-legend.collapsed{
  top:49px;
  min-width:0;
  width:auto;
  max-width:calc(100% - 32px);
  padding:0;
  gap:0;
  border-top:0;
  border-radius:0 0 9px 9px;
}
```

Ensure collapsed rows stay hidden and the toggle has stable small dimensions.

- [ ] **Step 3: Update toggle behavior**

In `app.js`, update the click handler to keep ARIA state and label text in sync:

```js
const legend = document.getElementById('map-legend');
const head = document.getElementById('lgd-head');
const headText = document.getElementById('lgd-head-txt');
const collapsed = legend.classList.toggle('collapsed');
head.setAttribute('aria-expanded', String(!collapsed));
head.setAttribute('aria-label', collapsed ? 'Show visible crop coverage' : 'Hide visible crop coverage');
headText.textContent = headText.dataset.collapsedLabel;
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test tests/map-composition-legend.test.mjs`

Expected: pass.

### Task 3: Verify shared delivery paths

**Files:**
- Read/execute: `src-tauri/scripts/prepare-dist.mjs`

- [ ] **Step 1: Run full Node tests**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Stage desktop static files**

Run: `node src-tauri/scripts/prepare-dist.mjs`

Expected: succeeds and copies the updated shared files into `src-tauri/dist-static/`.

- [ ] **Step 3: Browser-check Vercel/static UI**

Run a local static server and verify:

- Initial map shows only the compact `Coverage` tab under Ambassador.
- Clicking the tab expands the visible crop coverage rows.
- Clicking again returns to the compact tab.
