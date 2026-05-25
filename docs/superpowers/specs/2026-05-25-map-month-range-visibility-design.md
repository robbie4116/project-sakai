# Map Month Range Visibility Design

## Goal

Revise the bottom-left "Showing on map" control so users can display either one month or a range of months, matching the mental model of the existing "Schedule · when planted" picker. Also prevent confusion when users paint cells for one schedule while the map is showing a different month that hides the new markings.

## Current Behavior

The app stores crop schedules as 12-bit month masks. `state.paintMonths` controls the months applied while painting. `state.viewMonth` controls the map and canvas filter, where `-1` means all months and `0..11` means one selected month.

The current bottom-left map scrubber only supports "All" or a single month. If a user paints carrots for January-February while the map is showing December, the data is saved correctly but the mark is hidden until the user switches the map to January or February.

## Proposed Behavior

The map display gets its own month mask:

- `state.viewMonths` stores the current map display as a 12-bit mask.
- `ALL_MONTHS` still means all year.
- A mask with one bit set means a single month.
- A contiguous or wrapped mask means a month range, such as `Jan-Feb` or `Dec-Feb`.

The visible crop logic uses `state.viewMonths` instead of `state.viewMonth`. A crop is visible in a cell when the crop's stored month mask overlaps the map display mask.

## Interaction Design

The "Showing on map" control should behave like the schedule picker but remain compact:

- `All` remains a separate button.
- Clicking a month selects that single month.
- Dragging across months selects an inclusive range.
- Wrapped ranges remain valid, using the existing `monthsBetween(start, end)` helper.
- The readout shows `All year`, `January`, or a short range label like `Jan-Feb`.

For compatibility, if old saved state only has `state.viewMonth`, initialize `state.viewMonths` from it:

- `viewMonth === -1` becomes `ALL_MONTHS`.
- `viewMonth` from `0..11` becomes `1 << viewMonth`.

If saved state contains both fields, `state.viewMonths` is authoritative after validation. `state.viewMonth` is legacy input only and should not be used by rendering or interaction code after initialization.

Invalid saved `viewMonths` values should fall back safely:

- non-number values become `ALL_MONTHS`.
- `0` becomes `ALL_MONTHS`, because an empty map display is not useful for this workflow.
- values outside the 12-bit month range are masked with `ALL_MONTHS`.
- non-contiguous masks are allowed because users can create them indirectly from old or future data; they should render as a compact comma label rather than breaking.

## Painting Visibility Rule

After a non-erase paint operation, compare the active brush schedule to the current map display:

- If the map display is `ALL_MONTHS`, keep it unchanged.
- If the map display fully covers `state.paintMonths`, keep it unchanged.
- If the map display is disjoint from `state.paintMonths`, switch the map display to `state.paintMonths`.
- If the map display only partially overlaps `state.paintMonths`, switch the map display to `state.paintMonths`.

This makes newly painted cells visible immediately and avoids the appearance that plotting is broken.

Erase operations should not auto-switch the map display because erase removes all crops at the cell today, regardless of schedule.

## Hidden Brush Indicator

If the user explicitly changes the map display so it no longer fully covers the active brush schedule, show a small warning/indicator near the map scrubber and canvas view tag:

`Current brush: Jan-Feb hidden on map`

The indicator should appear whenever the current brush schedule is not fully covered by the map display, regardless of whether that mismatch came from changing the brush schedule or changing the map display:

- `state.viewMonths` is not `ALL_MONTHS`, and
- `state.paintMonths` is not fully covered by `state.viewMonths`.

The indicator should disappear when:

- map display is `ALL_MONTHS`, or
- map display fully covers `state.paintMonths`, or
- an automatic paint visibility switch makes the brush schedule visible.

The indicator is informational only. It should not block painting.

## Units and Boundaries

### Month Mask Utilities

Add small pure helpers in `app.js`:

- `maskIntersects(a, b)` returns whether two month masks overlap.
- `maskContains(container, contained)` returns whether all selected months in `contained` are included in `container`.
- `viewMonthsFromLegacy(viewMonth)` converts the old single-month state to the new mask.

These helpers are independently testable and keep month math out of DOM handlers.

### Map Visibility State

Keep map display state in `app.js` beside the existing state initialization. `state.viewMonths` is the canonical value for map and canvas filtering. `state.viewMonth` is only read once during migration when `viewMonths` is absent, then normalized to match the new state for saved-state compatibility:

- `state.viewMonths = normalizeViewMonths(state.viewMonths, state.viewMonth)`
- `state.viewMonth = viewMonthFromMask(state.viewMonths)`

`viewMonthFromMask(mask)` should return `-1` for `ALL_MONTHS`, the month index for a single-month mask, and `-2` for a range or non-contiguous mask. No rendering code should branch on `state.viewMonth`.

### Scrubber Controller

Update `calendar.js` so the map scrubber writes `state.viewMonths`, renders selected ranges, and exposes this exact interface:

`window.setViewMonths(mask, { source } = { source: 'manual' })`

Accepted sources:

- `manual`: user changed the map display from the scrubber.
- `paintAuto`: paint logic changed the map display so new marks are visible.
- `load`: initialization or migration applied a saved display.

The function validates the mask, updates `state.viewMonths`, updates the legacy mirror `state.viewMonth`, refreshes scrubber DOM state, refreshes hidden-brush indicator state, redraws the canvas, redraws map plots, updates the legend, and saves state. The `load` source may skip saving during initial construction if saving would occur before the app is fully initialized.

### Paint Integration

Update `paintAt()` in `app.js` after a successful non-erase paint to call the map display switch when needed. The switch should use the same controller path as manual scrubber changes so all UI and rendering updates stay consistent.

## Rendering and Labels

Update all display filters to use mask overlap:

- `cellVisibleCrops()`
- `plotDominantCrop()`
- map plot style calculations
- canvas view tag text
- legend counts/readout

The canvas tag should use the same label as the map scrubber:

- `Showing · all year`
- `Showing · January`
- `Showing · Jan-Feb`

## Testing

Add focused tests for the month-mask behavior:

- single-month label and visibility mask
- normal range selection
- wrapped range selection
- legacy `viewMonth` migration
- saved state containing both `viewMonths` and `viewMonth`
- invalid saved `viewMonths` normalization
- auto-switch when current map display is disjoint from the paint schedule
- auto-switch when current map display partially overlaps the paint schedule
- no auto-switch when current map display fully covers the paint schedule
- hidden-brush indicator predicate

Existing map tile tests should continue to pass unchanged.

## Persistence

`state.viewMonths` should be persisted in the same local storage payload as the rest of UI state. `state.viewMonth` can remain in saved state as a backward-compatible mirror but is not authoritative. Existing export schema for crop labels and metadata should not change because map display is a UI filter, not plot data.

## Out of Scope

- Changing crop storage format.
- Changing export file schema.
- Changing cloud sync semantics.
- Changing erase semantics.
- Adding a new modal or tutorial flow.
