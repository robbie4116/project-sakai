# Coverage Pull-Down Tab Design

**App:** Taniman Ambassador crop map

## Goal

Reduce the amount of map space occupied by the visible crop coverage legend when it is collapsed. The default/collapsed state should read as a small pull-down tab attached under the Ambassador map header. Clicking the tab should reveal the existing visible crop coverage rows.

## Approved Direction

Use a small tab directly under the Ambassador strip. The tab is compact in the collapsed state and communicates that it can be pulled down. When expanded, it opens the existing legend content as an overlay below the tab.

## Scope

- Update the shared static web app files used by Vercel.
- Keep the Tauri Windows/macOS desktop builds on the same shared static source. `src-tauri/scripts/prepare-dist.mjs` already copies `taniman.html`, `styles.css`, and `app.js` into the offline desktop bundle.
- Preserve the current coverage calculation and rows.
- Preserve the existing click-to-toggle behavior.

## Interface Behavior

- Collapsed state:
  - The component shows only a small tab under the map header.
  - The label should be short enough to fit: "Coverage".
  - The chevron points down to imply pull-down.
  - The full "Visible crop coverage" wording is not shown in the tab, reducing horizontal footprint.
- Expanded state:
  - The component keeps the compact "Coverage" tab label and shows the existing crop rows below it.
  - The chevron flips upward.
  - The expanded panel remains anchored to the same top edge as the collapsed tab, with no top border, so it reads as the tab being pulled down rather than as a detached floating box.

## Testing

Add static tests that verify:

- The legend starts collapsed in `taniman.html`.
- The collapsed tab has a short accessible label.
- CSS positions the collapsed legend as a compact tab below the Ambassador map header.
- The Tauri prepare-dist script still stages the shared static files, so the same change reaches Windows/macOS builds.

## Review Note

The Superpowers workflow calls for subagent review, but the available subagent tool is restricted to requests that explicitly ask for subagents or delegation. This change will use local review and verification instead.
