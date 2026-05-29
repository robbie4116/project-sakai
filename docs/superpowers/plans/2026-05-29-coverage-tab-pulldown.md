# Coverage Legend Pull-Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Coverage" label/button to the bottom of the expanded legend panel so it behaves like a physical pull-tab — the handle ends up at the bottom after pulling.

**Architecture:** DOM reorder only (button moves after rows in HTML), paired with three CSS edits (two in-place radius fixes, two new `:not(.collapsed)` rules added after the existing collapsed block). One test assertion updated to match the new radius value.

**Tech Stack:** Vanilla HTML/CSS, Node.js test runner (`node --test`)

**Spec:** `docs/superpowers/specs/2026-05-29-coverage-tab-pulldown-design.md`

---

## Files

- Modify: `taniman.html` — reorder two child elements inside `#map-legend`
- Modify: `styles.css` — two in-place edits + two new rule blocks appended after line 225
- Modify: `tests/map-composition-legend.test.mjs` — update one regex assertion on line 115

---

## Chunk 1: Update the test first, then implement

### Task 1: Update the failing test assertion

The test at line 115 asserts `border-radius:0 0 12px 12px` in the expanded container block. We are changing the base radius to `9px`, which will break this test. Update it first so we have a clear red/green signal.

**Files:**
- Modify: `tests/map-composition-legend.test.mjs:115`

- [ ] **Step 1: Run the full test suite to confirm it currently passes**

```
node --test tests/map-composition-legend.test.mjs
```

Expected: `pass 9, fail 0`

- [ ] **Step 2: Update the assertion**

In `tests/map-composition-legend.test.mjs`, find line 115 (inside the `'expanded coverage legend stays attached to the pull-down tab anchor'` test):

```js
// Before:
assert.match(legendCss, /border-radius:0 0 12px 12px/);

// After:
assert.match(legendCss, /border-radius:0 0 9px 9px/);
```

- [ ] **Step 3: Run tests to confirm this one test now fails**

```
node --test tests/map-composition-legend.test.mjs
```

Expected: `pass 8, fail 1` — the `'expanded coverage legend stays attached...'` test fails with a match error.

---

### Task 2: Edit the two existing CSS radius values

**Files:**
- Modify: `styles.css:190` (container base radius)
- Modify: `styles.css:210` (button base radius)

- [ ] **Step 1: Edit line 190 — container base border-radius**

In `styles.css`, inside `.map-legend{...}`, change:

```css
/* Before: */
border-radius:0 0 12px 12px;padding:0 12px 10px;

/* After: */
border-radius:0 0 9px 9px;padding:0 12px 10px;
```

(Only the radius value changes; `padding` and all other properties stay the same.)

- [ ] **Step 2: Edit line 210 — button base border-radius**

In `styles.css`, inside `.map-legend .lgd-head{...}`, change:

```css
/* Before: */
border-radius:0 0 8px 8px;

/* After: */
border-radius:0 0 9px 9px;
```

- [ ] **Step 3: Run tests — the previously-failing test should now pass**

```
node --test tests/map-composition-legend.test.mjs
```

Expected: `pass 9, fail 0`

- [ ] **Step 4: Commit**

```
git add styles.css tests/map-composition-legend.test.mjs
git commit -m "fix: unify legend border-radius to 9px (collapsed/expanded/button)"
```

---

### Task 3: Add the two new expanded-state CSS rules

Insert both rules **after** the `.map-legend.collapsed .lgd-head` block (currently ending around line 225 — the line containing just `}`).

**Files:**
- Modify: `styles.css` — insert after `.map-legend.collapsed .lgd-head{...}` block

- [ ] **Step 1: Add the two new rules**

After the closing `}` of `.map-legend.collapsed .lgd-head{...}`, insert:

```css
.map-legend:not(.collapsed){
  gap:0;
  padding:10px 12px 0;
}
.map-legend:not(.collapsed) .lgd-head{
  align-self:stretch;
  margin:0 -12px 0 -12px;
  padding-top:8px;
  border-top:1px solid var(--border);
  border-radius:0 0 9px 9px;
}
```

Rule explanations (do not add as comments — here for the implementer's reference):
- `gap:0` — removes the 6px flex gap between `#map-legend-rows` and the button; rows' internal spacing is unaffected
- `padding:10px 12px 0` — overrides the base padding; bottom 0 because the button provides its own
- `align-self:stretch` — makes button fill the container's horizontal content area (cross-axis in `flex-direction:column`)
- `margin:0 -12px 0 -12px` — bleeds button 12px left and right beyond the content area, covering the container's side padding so the button is edge-to-edge
- `padding-top:8px` — visual gap between the last legend row and the divider line
- `border-top:1px solid var(--border)` — internal divider between rows and handle (unrelated to container's `border-top:0`)
- `border-radius:0 0 9px 9px` — matches the container's unified bottom corner

- [ ] **Step 2: Run tests to confirm they still pass**

```
node --test tests/map-composition-legend.test.mjs
```

Expected: `pass 9, fail 0`

- [ ] **Step 3: Commit**

```
git add styles.css
git commit -m "feat: add expanded-state CSS rules for pull-tab legend handle"
```

---

### Task 4: Reorder the HTML — button moves after rows

**Files:**
- Modify: `taniman.html:61-65`

- [ ] **Step 1: Reorder the two children of `#map-legend`**

In `taniman.html`, find the `#map-legend` div (around line 60). It currently reads:

```html
<div class="map-legend collapsed" id="map-legend">
  <button class="lgd-head" id="lgd-head" type="button" aria-expanded="false" aria-label="Show visible crop coverage">
    <span id="lgd-head-txt" data-collapsed-label="Coverage">Coverage</span>
    <span class="lgd-chevron" aria-hidden="true">▾</span>
  </button>
  <div id="map-legend-rows"></div>
</div>
```

Change it to:

```html
<div class="map-legend collapsed" id="map-legend">
  <div id="map-legend-rows"></div>
  <button class="lgd-head" id="lgd-head" type="button" aria-expanded="false" aria-label="Show visible crop coverage">
    <span id="lgd-head-txt" data-collapsed-label="Coverage">Coverage</span>
    <span class="lgd-chevron" aria-hidden="true">▾</span>
  </button>
</div>
```

No other changes — button content, ARIA attributes, and all JS remain identical.

- [ ] **Step 2: Run tests to confirm they still pass**

```
node --test tests/map-composition-legend.test.mjs
```

Expected: `pass 9, fail 0`

- [ ] **Step 3: Commit**

```
git add taniman.html
git commit -m "feat: move coverage legend handle to bottom (pull-tab A1)"
```

---

### Task 5: Verify in the browser

- [ ] **Step 1: Open `taniman.html` in a browser**

Open `D:\Repositories\thesis-digimap\taniman.html` directly in a browser (file://).

- [ ] **Step 2: Check the collapsed state**

The "Coverage ▾" tab should appear below the toolbar, unchanged from before.

- [ ] **Step 3: Click the tab — check the expanded state**

After clicking:
- Legend rows should appear between the toolbar and the button
- "Coverage" label with upward chevron (▾ rotated 180°) should be at the very bottom of the panel
- A thin divider line should separate the last row from the "Coverage" label
- The button background and divider should span the full panel width edge-to-edge
- Bottom corners of the panel (button) should be rounded

- [ ] **Step 4: Click again — check collapse**

The panel should collapse back to just the "Coverage ▾" tab. Chevron should flip back to pointing down.

- [ ] **Step 5: Check all three color themes (if accessible)**

If the app has a theme switcher, verify the divider line and border-radius look correct in light, dark, and any other theme — `var(--border)` is different per theme.
