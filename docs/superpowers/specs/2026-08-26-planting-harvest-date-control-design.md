# Planting-To-Harvest Date Control Design

## Goal

Redesign the crop schedule control so field users can intuitively define the period when a selected crop is present in a plot, from planting through harvest.

The current implementation stores the correct data shape, but the UI is confusing and visually unpolished. The redesigned control should make the user's task explicit:

```text
Choose crop -> define planting-to-harvest period -> paint cells
```

This is a UX refinement of the existing season model. It does not change the exported season data contract.

## Current Behavior

The schedule bar currently presents:

```text
Schedule · when planted
Start [06-21]  End [06-30]  [June v]  [Whole] [Early] [Mid] [Late]
```

This works functionally, but it has several usability problems:

- `Schedule · when planted` is misleading because the stored range means crop presence from planting through harvest, not only the planting date.
- `Start` and `End` are too abstract for the field workflow.
- The shortcut month dropdown appears as a primary field even though it only supports the shortcut buttons.
- `Whole`, `Early`, `Mid`, and `Late` are ambiguous without already understanding that they refer to the selected month.
- The readout uses raw `MM-DD` values, which is precise but not reassuring for a non-technical field workflow.
- The visual arrangement reads as separate form controls rather than one coherent editor.

## Proposed Behavior

Replace the current schedule row with a grouped planting-to-harvest editor.

The control should communicate this sentence:

```text
Potato present from Jun 21 to Jun 30
```

The visible editing controls should use separate month and day selectors instead of freeform `MM-DD` typing:

```text
Planting to harvest                         Potato present from Jun 21 to Jun 30

Planted   [Jun v] [21 v]    Harvest   [Jun v] [30 v]

Preset month [June v]
[All Jun] [Jun 1-10] [Jun 11-20] [Jun 21-30]
```

On narrow screens, the same control stacks without changing meaning:

```text
Planting to harvest
Potato present from Jun 21 to Jun 30

Planted   [Jun v] [21 v]
Harvest   [Jun v] [30 v]

Preset month [June v]
[All Jun] [Jun 1-10]
[Jun 11-20] [Jun 21-30]
```

## Interaction Rules

The main label is `Planting to harvest`.

The selected crop readout should use readable month/day text:

```text
Potato present from Jun 21 to Jun 30
```

For wrapped annual ranges, the readout remains valid:

```text
Carrot present from Nov 15 to May 5
```

The UI may add a small neutral helper for wrapped ranges:

```text
Continues into next year
```

The date selectors are:

- planted month
- planted day
- harvest month
- harvest day

Changing a month regenerates the valid day options for that date. If the previous selected day is higher than the selected month's maximum day, clamp to the last valid day. For example, changing `Jun 30` to February becomes `Feb 29`.

Shortcut buttons are generated from the preset month. If the preset month is June, labels should be:

- `All Jun`
- `Jun 1-10`
- `Jun 11-20`
- `Jun 21-30`

Clicking a shortcut updates all four planted/harvest selectors and then updates app state through the same existing state path used by manual selector changes.

The shortcut matching the active planted/harvest range should show a selected state. If the range does not match one of the preset shortcuts, no shortcut is selected.

## Data And State

The internal state remains unchanged:

```js
state.paintStartDate = "06-21";
state.paintEndDate = "06-30";
```

Season records remain unchanged:

```js
{
  cropId: "potato",
  start: "06-21",
  end: "06-30",
  cells: [1044, 1045]
}
```

Exports continue using the existing `start_mmdd` and `end_mmdd` fields. This design only changes how users choose and understand those dates.

## Component Boundaries

The implementation should keep the date-control logic isolated in `calendar.js`.

Expected helpers:

- Convert selected month/day values into canonical `MM-DD`.
- Parse canonical `MM-DD` into month/day selector values.
- Format canonical `MM-DD` for display as `Jun 21`.
- Regenerate day options for a selected month.
- Clamp invalid month/day combinations by construction.
- Update shortcut labels when the preset month changes.
- Mark a matching shortcut as selected.

The pure calendar rules should continue to come from `season-utils.js`, especially:

- `MONTH_DAYS`
- `shortcutRange`
- `isValidMmdd`
- `rangeWrapsYear`

The implementation should avoid duplicating date validity rules across files.

## Markup Scope

Update the schedule bar in `taniman.html`.

The old raw text inputs:

- `season-start`
- `season-end`

should be replaced by explicit month/day selectors for planted and harvest dates.

Recommended IDs:

- `season-planted-month`
- `season-planted-day`
- `season-harvest-month`
- `season-harvest-day`
- `season-preset-month`

The existing shortcut mechanism may continue using `data-season-shortcut`, but the labels should be dynamic.

## Visual Design

The schedule bar should feel like one compact lifecycle editor.

Visual hierarchy:

1. `Planting to harvest` label.
2. Human-readable crop presence readout.
3. Planted and harvest selectors.
4. Preset month and shortcut buttons.

The planted and harvest selectors are the primary controls. The preset month is secondary and should not visually dominate the row.

The field labels `Planted` and `Harvest` must remain visible. They should not rely only on placeholder text.

The date values should be easy to scan but not oversized. The control sits above the canvas, so it must stay compact.

The shortcut buttons should have equal height and stable dimensions. Text must not overflow on desktop or mobile.

Unused styles from the previous schedule track, month cells, and handles should be removed if no longer referenced.

## Validation And Edge Cases

Impossible dates should be prevented by the month/day selector design.

If existing state somehow contains an invalid date, the UI should recover without blocking the page. Use a safe fallback such as:

```text
01-01 to 12-31
```

Same-day ranges remain valid.

Wrapped annual ranges remain valid.

Changing crop should update only the readout crop name and dot; it should not reset the selected planted/harvest range.

Changing the preset month should not change the planted/harvest range until the user clicks a shortcut.

## Testing

Add focused source tests for the redesigned control:

- The schedule UI exposes planted and harvest month/day selectors.
- The schedule UI no longer exposes raw `season-start` and `season-end` text fields.
- The preset month select exists separately from planted and harvest selectors.
- Shortcut buttons still use `data-season-shortcut`.
- `calendar.js` routes all date changes through `setPaintSeasonRange`.
- `calendar.js` uses `shortcutRange` for shortcut behavior.
- `calendar.js` updates shortcut labels based on the preset month.
- `calendar.js` contains logic to regenerate day options when a month changes.

Run the full existing test suite after implementation:

```powershell
node --test tests/*.test.mjs
```

## Out Of Scope

- Changing the season data model.
- Changing the export schema.
- Building a timeline or draggable date-range control.
- Changing the map month scrubber.
- Adding selective season editing or selective erase behavior.
- Adding year-specific dates.
