# Map Composition and Legend Accuracy Design

## Goal

Make the map overview and legend accurately represent visible crop data instead of collapsing each plot to one dominant crop. The map should prioritize field-level accuracy: mixed plots must visibly communicate mixed crop composition, and the legend must describe the same unit of data that the map is showing.

## Current Problem

`app.js` currently derives plot color from `dominantCropForView(idx)`. `plotStyle()` fills the full plot rectangle with the dominant crop color, and `updateLegend()` counts each plot only under that same dominant crop.

This is misleading when a plot contains more than one crop. For example, a plot with 55% carrot and 45% cabbage appears as a carrot plot, and the legend increments carrot but not cabbage. The month filter makes this more sensitive because the visible composition changes by `state.viewMonths`.

## Design

Use visible cell coverage as the source of truth for both the map and legend.

### Shared Composition Model

Add one shared helper that computes visible crop composition for a plot:

- Input: plot index and the current visible month mask.
- Output: per-crop visible cell counts, total visible crop cells, empty visible cells, non-zero crop count, dominant crop only as secondary metadata, and crop percentages.
- Month filtering must use the same `maskIntersects(v, state.viewMonths)` behavior used today.

This keeps `plotStyle()`, map overlays, tooltips, and `updateLegend()` from independently recalculating slightly different answers.

### Map Encoding

Map plots should use composition-aware rendering:

- Empty plots keep the existing grey translucent styling.
- Single-crop plots keep a crop-colored fill.
- Mixed plots use a neutral translucent base instead of a dominant crop fill.
- Mixed plots get a proportional crop indicator inside or above the rectangle. The recommended first implementation is a segmented horizontal bar sized to the plot bounds, with one segment per visible crop and segment widths based on visible cell share.
- The selected plot keeps the existing yellow selection border so selection remains distinct from crop identity.

Dominant crop can still be available for tooltips or sorting, but it must not be the primary visual encoding for mixed plots.

### Legend Semantics

The legend should summarize visible crop coverage, not dominant plot counts.

Recommended row values:

- Crop color and crop name.
- Percent of visible painted cells across all plots.
- Raw visible cell count as a secondary value if space allows.
- Optional plot-presence count, labeled clearly as "plots containing" if included.

The empty row should represent unpainted visible cells across the plot grid, not plots with no dominant crop. If that is too visually noisy, the row can be labeled "Unpainted cells" and shown after crop rows.

The legend heading should clarify the unit, for example: "Visible crop coverage".

### Data Flow

1. User changes visible map months or edits crop cells.
2. Plot composition is recomputed from `state.plots[idx].cells`.
3. `plotStyle()` uses the composition summary to choose empty, single-crop, or mixed-base styling.
4. Mixed plot indicators are rendered or updated for each affected plot.
5. `updateLegend()` aggregates visible cell counts from the same composition helper.

### Testing

Add focused tests around the helper and integration expectations:

- A mixed plot contributes counts to every visible crop, not only the dominant crop.
- A month filter excludes cells whose crop month mask does not intersect the visible mask.
- A single-crop plot is classified separately from a mixed plot.
- The legend aggregation uses visible cell counts instead of dominant plot counts.
- Existing dominant-crop behavior remains available only as metadata.

## Non-Goals

- Do not change the saved v3 data model.
- Do not change export semantics unless a later request asks for legend-equivalent summary exports.
- Do not render the full 50x50 crop grid on the overview map; it would be more exact but too noisy for the current map scale.

## Open Decision

Choose the exact mixed-plot indicator implementation:

1. Segmented horizontal bar inside each mixed plot: recommended because it is compact and proportional.
2. Proportional stripes across the plot fill: more visually direct, but can become noisy.
3. Small crop chips with percentages on hover only: cleanest map, but less accurate at a glance.

Recommended choice: segmented horizontal bar for mixed plots, with the full crop percentages in the plot tooltip or details panel.
