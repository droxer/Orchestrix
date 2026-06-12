# Relay Logo Polish — Design Spec

**Date:** 2026-06-08
**Status:** Approved
**Scope:** Brand mark + wordmark lockup. Affects `assets/brand/`, the daemon control panel header, and (transitively, via existing references) the README hero images.

## Goal

Polish the existing circuit-X mark into a single, product-grade lockup that:

1. Reads clearly at favicon (≤32px wide) and nav (48×32px) sizes — the current mark renders muddy because it has eleven elements competing in a small space.
2. Communicates Relay's actual function (multiple agents handing off into one coordinated forward action) rather than a generic "network".
3. Stays inside the existing brand tokens (ink `#18232d`, Relay Blue `#0052ff`, Inter weight 400).

Non-goals: changing the wordmark typography, introducing a new brand color, redesigning the wider design system in `docs/design-system.md`.

## Concept

Two ink input nodes on the left converge via short circuit traces into a single Relay-Blue signal terminated by a forward arrowhead. The asymmetry is the meaning: many inputs, one forward signal. The arrowhead is the right side — there is no terminating node — so the eye reads motion, not a closed circuit.

This is a simplification of, not a departure from, the existing circuit-X. The four outer dots collapse to two, the right-side traces and inner blue dots are removed entirely, and the signal line becomes the only horizontal element.

## Geometry

**Mark — `viewBox="0 0 96 64"`:**

| Element | Coords | Stroke / fill |
|---|---|---|
| Input node (top) | `cx=10 cy=14 r=4` | fill `#18232d` |
| Input node (bottom) | `cx=10 cy=50 r=4` | fill `#18232d` |
| Input trace (top) | `M10 14 H22 L32 24 H40` | stroke `#18232d`, width 4, round caps/joins |
| Input trace (bottom) | `M10 50 H22 L32 40 H40` | stroke `#18232d`, width 4, round caps/joins |
| Signal line | `M32 32 H76` | stroke `#0052ff`, width 4, round caps |
| Arrowhead | polyline `68,24 80,32 68,40` | stroke `#0052ff`, width 4, round caps/joins, fill none |

All coordinates are integers. Stroke-width 4 in a 96-wide viewBox lands at clean integer pixels at every common render size (24px wide → 1px, 48px → 2px, 96px → 4px). The input traces flank the signal line on parallel run-ins at `y=24` and `y=40`, with the signal line itself at `y=32` between them; the traces deliberately do not touch the signal, which gives the converging shape visual breathing room and lets the blue signal read as the figure on its own.

**Logo lockup — `viewBox="0 0 320 64"`:**

- Mark group rendered at the same coordinates as above (occupies x: 0–96).
- Wordmark text element at `x=110 y=44`:
  - `font-family`: `'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
  - `font-size`: 42
  - `font-weight`: 400 (per `docs/design-system.md` — display weights stay at 400)
  - `letter-spacing`: -1
  - `fill`: `#18232d`
  - Content: `Relay`
- Wordmark baseline (`y=44`) is chosen so the optical center of the "Relay" cap-height aligns with the mark's vertical center (`y=32`).

**Clear space:** Reserve `mark-width × 0.25` (≈24 viewBox units, scaling with render size) of empty canvas on all sides of the lockup. Never crop into this region.

## Color rules

- Ink `#18232d` — input nodes, input traces, and wordmark. Nothing else.
- Relay Blue `#0052ff` — signal line and arrowhead. Nothing else.
- On dark surfaces, every element currently filled or stroked with ink `#18232d` (input nodes, input traces, wordmark) swaps to `#ffffff`. Relay Blue is unchanged.
- No secondary colors. No gradients. No shadows.

## Rendering

- Every SVG includes `shape-rendering="geometricPrecision"` so anti-aliasing stays clean at non-integer scales.
- Default render sizes:
  - Standalone mark in nav bars: 48×32 px.
  - Favicon: 24×16 px (the mark was simplified specifically to remain legible here).
  - Logo lockup in headers / READMEs: 200×40 px or larger.
- The mark must remain legible at 16px wide. Anything smaller falls back to the favicon at integer sizes.

## Files affected

| File | Change |
|---|---|
| `assets/brand/relay-mark.svg` | Rewrite to V3 geometry. |
| `assets/brand/relay-logo.svg` | Rewrite with V3 mark group + wordmark text. |
| `packages/relay-daemon/src/relay/daemon.ts` | Replace the inline SVG inside the `.wordmark` span (`top-nav`) with V3 markup. CSS stays as-is (`width: 48px; height: 32px; shape-rendering: geometricPrecision`). |
| `README.md` | No change — already references `assets/brand/relay-logo.svg`, which will resolve to the new lockup. |
| `assets/brand/README.md` | Add a short usage note: mark vs. logo, clear-space, color swap on dark. |

## Verification

After implementation:

1. Open the daemon control panel (`make serve`, then `http://localhost:<port>/cp`) and confirm the mark renders cleanly at nav scale.
2. Render `relay-mark.svg` and `relay-logo.svg` to PNG via `sips` at 1×, 2×, and favicon sizes; visually confirm strokes stay crisp.
3. Confirm READMEs still resolve their logo image correctly on GitHub.
4. Typecheck: `npx tsc -p packages/relay-daemon/tsconfig.json --noEmit`.

## Out of scope

- Animated logo variants.
- Monochrome / single-color fallback variants beyond the dark-mode swap rule.
- Marketing-site brand pages.
- Updates to `docs/design-system.md` — the design tokens used here are unchanged.
