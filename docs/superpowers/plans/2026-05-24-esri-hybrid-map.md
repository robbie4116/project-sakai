# ESRI Hybrid Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-layer offline-only map with a three-layer stack (offline context → ESRI online satellite → Ambassador detail overlay) and fix the black-rectangle glitch by tightening detail tile bounds, plus move zoom controls inline to the map header.

**Architecture:** ESRI World Imagery loads as the primary satellite base when online; local `tiles/context/` shows through when ESRI tiles fail offline; local `tiles/map/` always overlays the Ambassador area. The dark-rectangle glitch is eliminated by shrinking `MAP_DETAIL_BOUNDS` to the exact Ambassador plot extent, so no outside-fill tiles are ever requested. No tile regeneration required.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4, Node built-in test runner, Python http.server for browser verification

**Spec:** `docs/superpowers/specs/2026-05-24-esri-hybrid-map-design.md`

---

## Chunk 1: app.js Three-Layer Refactor

### Task 1: Update `app.js` — three-layer map constants, factories, and wiring

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Confirm tests pass at baseline**

```powershell
node --test tests/map-zoom-config.test.mjs
```

Expected: `# pass 4  # fail 0`. If not 4/4, stop and investigate before continuing.

- [ ] **Step 2: Add `esriTileLayerRef` to the layer refs**

Find:
```js
let contextTileLayerRef = null;
let detailTileLayerRef = null;
```

Replace with:
```js
let contextTileLayerRef = null;
let esriTileLayerRef = null;
let detailTileLayerRef = null;
```

- [ ] **Step 3: Replace map constants block**

Find the entire block from `const MAP_TILE_VERSION` through the closing `)` of `MAP_DETAIL_BOUNDS`:

```js
const MAP_TILE_VERSION = '20260524-context';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = 10;
const MAP_APP_MAX_ZOOM = 16;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [16.45459, 120.617322],
  [16.50233, 120.663228]
);
```

Replace with:
```js
const MAP_TILE_VERSION = '20260524-esri';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = 10;
const MAP_APP_MAX_ZOOM = 16;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [16.46141, 120.62388],
  [16.49551, 120.65667]
);
```

Key change: `MAP_DETAIL_BOUNDS` is now the tight Ambassador plot extent (no padding). `MAP_TILE_VERSION` bumped to `'20260524-esri'`.

- [ ] **Step 4: Update `makeContextTileLayer()` attribution**

Find inside `makeContextTileLayer()`:
```js
    attribution: 'Offline satellite context',
```

Replace with:
```js
    attribution: '',
```

- [ ] **Step 5: Add `makeEsriTileLayer()` after `makeContextTileLayer()`**

After the closing `}` of `makeContextTileLayer()`, insert:

```js

function makeEsriTileLayer() {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      noWrap: true,
      errorTileUrl: '',
      attribution: '',
    }
  );
}
```

- [ ] **Step 6: Update `makeDetailTileLayer()` attribution**

Find inside `makeDetailTileLayer()`:
```js
    attribution: 'Offline Ambassador detail imagery',
```

Replace with:
```js
    attribution: '',
```

- [ ] **Step 7: Update `applyTheme()` to handle three layers**

Find:
```js
  if (map && contextTileLayerRef && detailTileLayerRef) {
    map.removeLayer(detailTileLayerRef);
    map.removeLayer(contextTileLayerRef);
    contextTileLayerRef = makeContextTileLayer().addTo(map);
    detailTileLayerRef = makeDetailTileLayer().addTo(map);
  }
```

Replace with:
```js
  if (map && contextTileLayerRef && esriTileLayerRef && detailTileLayerRef) {
    map.removeLayer(detailTileLayerRef);
    map.removeLayer(esriTileLayerRef);
    map.removeLayer(contextTileLayerRef);
    contextTileLayerRef = makeContextTileLayer().addTo(map);
    esriTileLayerRef    = makeEsriTileLayer().addTo(map);
    detailTileLayerRef  = makeDetailTileLayer().addTo(map);
  }
```

- [ ] **Step 8: Update `initMap()` to add all three layers in order**

Find:
```js
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  detailTileLayerRef = makeDetailTileLayer().addTo(map);
```

Replace with:
```js
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  esriTileLayerRef    = makeEsriTileLayer().addTo(map);
  detailTileLayerRef  = makeDetailTileLayer().addTo(map);
```

- [ ] **Step 9: Remove `map-hint` from `applyLang()`**

Find in `applyLang()`:
```js
  document.getElementById('map-hint').textContent = '8 × 8 · 64 ' + (state.lang==='tl'?'plot':'plot');
```

Delete this line entirely.

- [ ] **Step 10: Run tests — all 4 must still pass**

```powershell
node --test tests/map-zoom-config.test.mjs
```

Expected: `# pass 4  # fail 0`

If any test fails, read the error carefully and fix before committing. Common issues:
- A regex assertion in `makeContextTileLayer` or `makeDetailTileLayer` may have been accidentally changed — re-check Steps 4 and 6.

- [ ] **Step 11: Commit**

```powershell
git add app.js
git commit -m "feat: add ESRI online base layer, fix detail bounds glitch"
```

---

## Chunk 2: HTML + CSS UI Changes

### Task 2: Update `taniman.html` — inline zoom controls, remove hint text

**Files:**
- Modify: `taniman.html`

- [ ] **Step 1: Update `.map-head` CSS — change baseline to center alignment**

Find:
```css
.map-head{
  padding:14px 20px 10px;
  border-bottom:1px solid var(--border);
  display:flex;align-items:baseline;justify-content:space-between;
  gap:10px;
  flex-shrink:0;
}
```

Replace with:
```css
.map-head{
  padding:10px 20px;
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  gap:10px;
  flex-shrink:0;
}
```

- [ ] **Step 2: Replace `.map-zoom` CSS — from absolute vertical stack to inline horizontal pair**

Find:
```css
.map-zoom{
  position:absolute;right:14px;top:14px;z-index:400;
  display:flex;flex-direction:column;gap:1px;
}
.map-zoom button{
  width:36px;height:36px;background:var(--surface);
  border:1px solid var(--border);color:var(--text);
  font-size:18px;line-height:1;
  display:flex;align-items:center;justify-content:center;
}
.map-zoom button:first-child{border-radius:8px 8px 0 0}
.map-zoom button:last-child{border-radius:0 0 8px 8px;border-top:none}
.map-zoom button:hover{background:var(--surface-2)}
```

Replace with:
```css
.map-zoom{
  display:flex;flex-direction:row;gap:1px;
  flex-shrink:0;
}
.map-zoom button{
  width:34px;height:34px;background:var(--surface);
  border:1px solid var(--border);color:var(--text);
  font-size:18px;line-height:1;
  display:flex;align-items:center;justify-content:center;
}
.map-zoom button:first-child{border-radius:8px 0 0 8px}
.map-zoom button:last-child{border-radius:0 8px 8px 0;border-left:none}
.map-zoom button:hover{background:var(--surface-2)}
```

- [ ] **Step 3: Remove `.map-head .hint` CSS rule**

Find and delete:
```css
.map-head .hint{
  font-size:11px;color:var(--muted);
  text-align:right;
  font-family:'IBM Plex Mono',monospace;
```

Note: this rule likely has a closing `}` on the following line. Delete the full rule block including the closing brace.

- [ ] **Step 4: Replace the map-head HTML — move zoom buttons inline, remove hint**

Find:
```html
      <div class="map-head">
        <h2 id="map-title">Ambassador Survey Area</h2>
        <span class="hint" id="map-hint">8 × 8 = 64 plots</span>
      </div>
      <div id="map"></div>
      <div class="map-zoom">
        <button id="zoom-in" aria-label="Zoom in">+</button>
        <button id="zoom-out" aria-label="Zoom out">−</button>
      </div>
```

Replace with:
```html
      <div class="map-head">
        <h2 id="map-title">Ambassador Survey Area</h2>
        <div class="map-zoom">
          <button id="zoom-out" aria-label="Zoom out">−</button>
          <button id="zoom-in"  aria-label="Zoom in">+</button>
        </div>
      </div>
      <div id="map"></div>
```

Note: buttons are `−` then `+` (left to right). The `.map-zoom` div moves inside `.map-head` and the old absolute-positioned `.map-zoom` after `#map` is removed entirely.

- [ ] **Step 5: Commit**

```powershell
git add taniman.html
git commit -m "feat: move zoom controls inline to map header, remove hint text"
```

---

## Chunk 3: Browser Verification

### Task 3: Verify in browser and run final checks

**Files:**
- No source changes expected unless verification finds defects.

- [ ] **Step 1: Run automated tests**

```powershell
node --test tests/map-zoom-config.test.mjs
```

Expected: `# pass 4  # fail 0`

- [ ] **Step 2: Start local server**

```powershell
Start-Process python -ArgumentList "-m", "http.server", "8080" -WorkingDirectory "D:\Repositories\thesis-digimap" -WindowStyle Hidden
Start-Sleep 2
Test-NetConnection -ComputerName localhost -Port 8080 -InformationLevel Quiet
```

Expected: `True`

- [ ] **Step 3: Open app and check initial state**

Open `http://localhost:8080/taniman.html` in a browser.

Verify:
- Map frames Ambassador with satellite imagery from ESRI.
- Zoom `−` and `+` buttons appear in the map header, inline, `−` left of `+`.
- No "8 × 8" hint text visible.
- No dark/black rectangle over the Ambassador area.
- Plot grid and Ambassador boundary polygon visible over the satellite base.

- [ ] **Step 4: Verify zoom-out to minimum**

Click `−` four times to reach zoom 10.

Verify:
- Map zooms out to show the wider Benguet satellite view.
- No blank areas within the Benguet context bounds.
- ESRI imagery fills the full viewport.

- [ ] **Step 5: Verify offline behaviour**

In browser DevTools → Network tab → throttle to **Offline**.

Reload `http://localhost:8080/taniman.html`.

Verify:
- Local JS/CSS/fonts still load (served from local server).
- `tiles/context/` tiles load from local server.
- `tiles/map/` Ambassador detail tiles load from local server.
- ESRI tiles show as blank (not broken icons).
- No console errors other than the expected ESRI tile network errors.

Restore network to **Online** and reload to confirm ESRI returns.

- [ ] **Step 6: Stop server and check process hygiene**

```powershell
Get-Process -Name "python" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

Verify no leftover python or node processes from this session.

- [ ] **Step 7: Commit any verification fixes**

If verification required fixes to `app.js` or `taniman.html`:

```powershell
git add app.js taniman.html
git commit -m "fix: polish ESRI hybrid map after browser verification"
```

If no fixes were required, do not create an empty commit.

---

## Execution Notes

- All changes are confined to `app.js` and `taniman.html`. No Python, no tile assets.
- The three layers must be added in order: context → ESRI → detail. Reversing breaks online/offline behaviour.
- `MAP_DETAIL_BOUNDS` tight values match `generate_tiles.py` raw `BBOX_*` constants exactly — no padding.
- `errorTileUrl: ''` on the ESRI layer means failed tiles are invisible (transparent), not broken icons. This is intentional — it lets context tiles show through.
- ESRI World Imagery is free for non-commercial use. No API key required.
