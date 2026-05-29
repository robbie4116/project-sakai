# Coverage Legend Pull-Tab Redesign (A1)

**Date:** 2026-05-29
**Scope:** UI-only — HTML structure reorder + CSS edits in `taniman.html` and `styles.css`, one test assertion update in `tests/map-composition-legend.test.mjs`

---

## Problem

The coverage legend panel is anchored below the toolbar with `border-top: 0`, creating a tab that "pulls down" to reveal legend rows. In the expanded state the "Coverage" label remains at the top — contradicting the physical metaphor of pulling a tab down. After pulling, the handle should be at the bottom, not still at the top.

## Design Decision

**Option A1 — Label at bottom (full pull-tab metaphor)**

Reorder the DOM so the `lgd-head` button comes *after* `#map-legend-rows`. In the collapsed state rows are hidden, so only the button tab shows as before. In the expanded state, rows fill in between the toolbar and the button, and the "Coverage" label (with chevron inverted to point up) sits at the very bottom of the panel — like a window blind where the pull cord ends up at the bottom after unrolling.

---

## 1. HTML (`taniman.html`, lines 60–66) — reorder only

Before:
```html
<div class="map-legend collapsed" id="map-legend">
  <button class="lgd-head" id="lgd-head" …>…</button>
  <div id="map-legend-rows"></div>
</div>
```

After:
```html
<div class="map-legend collapsed" id="map-legend">
  <div id="map-legend-rows"></div>
  <button class="lgd-head" id="lgd-head" …>…</button>
</div>
```

No change to button content, ARIA attributes, or JS.

**JS — no changes required.** `setLegendCollapsed()` (`app.js` line 979) always writes `headText.dataset.collapsedLabel` ("Coverage") as the label regardless of state. The click handler on `#lgd-head` (line 1521) toggles `.collapsed` on `#map-legend`. Both are unchanged.

---

## 2. CSS (`styles.css`)

`.map-legend` is `display: flex; flex-direction: column` (line 192). For its children, `align-self` controls the **horizontal** (cross) axis — `stretch` means fill container content width, `flex-start` means shrink to content.

### Chevron — no changes

The chevron is `▾` in HTML. Existing rules produce the correct visual in both states:

- Expanded (base): `transform: rotate(180deg)` → ▾ inverted, appears as upward-pointing caret
- Collapsed override: `transform: rotate(0)` → ▾ pointing downward

### 2a. Unified border-radius — edit two existing lines

The base container has `border-radius: 0 0 12px 12px` (line 190) while the button has `0 0 8px 8px` (line 210) and the collapsed container override has `0 0 9px 9px` (line 221). Unify all to `9px`.

**Edit line 190** (inside `.map-legend{}`):
```css
/* was: border-radius:0 0 12px 12px; */
border-radius:0 0 9px 9px;
```

**Edit line 210** (inside `.map-legend .lgd-head{}`):
```css
/* was: border-radius:0 0 8px 8px; */
border-radius:0 0 9px 9px;
```

The collapsed container override (line 221) already reads `0 0 9px 9px` — no change.

### 2b. Base button margin — no change

The base `.map-legend .lgd-head` rule (`margin: 0 0 8px -12px`, line 204) is left as-is — it applies in the collapsed state. The expanded-state rule in 2c fully overrides it for the expanded state via higher specificity (`:not(.collapsed)` wins over the base class selector).

### 2c. Two new rules — insert after the `.map-legend.collapsed .lgd-head` block (currently ending at line 225)

**New rule 1 — expanded container:**
```css
.map-legend:not(.collapsed){
  gap:0;
  padding:10px 12px 0;
}
```

- Overrides the base `gap: 6px` (line 192) and base `padding: 0 12px 10px` (line 190) for the expanded state. The base `padding` on line 190 is now superseded in both states (collapsed uses `padding: 0`, expanded uses `padding: 10px 12px 0`) — it becomes dead code and may be removed, but leaving it is harmless.
- `gap: 0` prevents a double-gap between `#map-legend-rows` and `#lgd-head`. Rows' internal layout is unaffected.
- `padding: 10px 12px 0`: top 10px, sides 12px, bottom 0 — the button provides its own bottom padding via its existing `padding: 0 12px`.
- `min-width: 250px` and `max-width: 300px` from the base rule are not overridden here and remain in effect for the expanded state.

**New rule 2 — expanded button:**
```css
.map-legend:not(.collapsed) .lgd-head{
  align-self:stretch;
  margin:0 -12px 0 -12px;
  padding-top:8px;
  border-top:1px solid var(--border);
  border-radius:0 0 9px 9px;
}
```

- `align-self: stretch` — makes the button fill the container's content area width (the cross-axis in a column flex layout). Without this, the button remains content-sized (`flex-start` from base rule).
- `margin: 0 -12px 0 -12px` — four-value shorthand (top right bottom left). Extends the button 12px beyond the content area on each side, covering the container's `padding: 10px 12px 0` side padding. Together with `align-self: stretch`, the button's visual width equals the container's full border-box width, making the divider and background edge-to-edge.
- `padding-top: 8px` — visual gap between the last legend row and the divider line.
- `border-top: 1px solid var(--border)` — a divider separating the rows above from the button/handle below. This is an *internal* divider, unrelated to the container's `border-top: 0` (which removes the panel's top border where it meets the toolbar).
- `border-radius: 0 0 9px 9px` — matches the unified container bottom corner.
- These four values fully override the base button `margin: 0 0 8px -12px`.

`var(--border)` is defined in all three color themes at `styles.css` lines 5, 20, 35.

---

## 3. Test update (`tests/map-composition-legend.test.mjs`)

**Line 115** asserts the container block contains `border-radius:0 0 12px 12px`. This will fail after the radius is changed to `9px`.

Update line 115:
```js
// was:
assert.match(legendCss, /border-radius:0 0 12px 12px/);
// becomes:
assert.match(legendCss, /border-radius:0 0 9px 9px/);
```

No other test assertions are affected:
- Line 98–103 (collapsed state assertions): all still pass — collapsed class, ARIA label, label text, and `border-radius:0 0 9px 9px` on `.map-legend.collapsed` are unchanged.
- No test asserts DOM order of `#lgd-head` vs `#map-legend-rows`.

---

## Interaction Feel

1. User sees "Coverage ▾" tab attached below toolbar — identical to current collapsed state
2. Clicks — rows appear between the toolbar and the button (instantaneous, no panel animation)
3. "Coverage" label with upward chevron is now at the bottom — the handle was pulled down
4. User clicks again — rows hide, back to just the tab

The chevron's `transition: transform .18s` is the only animated element; no panel animation is added.
