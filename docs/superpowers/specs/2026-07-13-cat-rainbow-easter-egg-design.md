# Cat + Rainbow Burst Easter Egg — Design

**Date:** 2026-07-13 · **Scope:** client only, dashboard masthead

## What

A small line-drawn cat sits at the top-left of the scan dashboard (first
element in the `.masthead`, left of the EyeGlyph). Clicking it fires a
"rainbow burst": ~14 rainbow arcs appear at random positions across the whole
viewport, drift and fade out over ~2.5s, then clean themselves up. Clicks
stack — each click adds an independent burst. Pure whimsy; no product
behavior changes.

## How

- **`client/src/components/CatRainbows.tsx`** — the one new component. Renders:
  - a `<button className="cat-button">` wrapping an inline-SVG cat face drawn
    in the EyeGlyph idiom (`currentColor` stroke, strokeWidth 2, no image
    assets), `aria-label="Release the rainbows"`;
  - when bursts are active, a `position: fixed; inset: 0` overlay with
    `pointer-events: none` (app stays fully usable) holding the arcs.
- **`makeBurstArcs(count, rng)`** — pure, exported: maps an injected rng to
  arc specs `{x, y, size, rotation, delayMs}` (viewport-percentage coords).
  Deterministic under a seeded rng; this is the tested surface.
- **Animation** — one CSS keyframe (`rainbow-sail`): translate + slight
  rotate + opacity fade, transform/opacity only. Each burst self-removes via
  a timeout matching the longest delay + duration. `prefers-reduced-motion`:
  arcs fade in place, no sailing.
- **CSS** — namespaced `.cat-*` / `.rainbow-*` in `styles.css`.
- **Wiring** — one line in `ScanPage.tsx`: `<CatRainbows />` first in the
  masthead. No server, shared/, or routing changes.

## Color discipline

Rainbow band colors (red→violet) exist only inside the transient overlay.
They are decoration, never status: red = guaranteed arb, green =
surveillance live, yellow = speculative remain untouched (the cat glyph
itself is `currentColor`, no fill).

## Testing

- Vitest: `makeBurstArcs` — seeded rng gives deterministic specs; count
  respected; coords/rotation/delay within bounds.
- Manual: click the cat in the running app; rainbows sail; app remains
  clickable mid-burst; second click stacks.
