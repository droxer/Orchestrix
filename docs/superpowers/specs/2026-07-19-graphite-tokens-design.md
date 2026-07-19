# Relay web — Graphite token system

Date: 2026-07-19
Status: approved (demo reviewed: claude.ai/code/artifact/d1dc7495-9fc3-42c6-92a0-e50ea3f94f1e)
Replaces: Sleek Forest identity (2026-07-14) and the primitives/semantic token tiers.

## Intent

Replace the Sleek Forest identity and its bloated token system with **Graphite**:
a true-neutral canvas, one steel-blue accent, status-only chroma, two registers
designed side by side (dual-first — neither theme derives from the other), and a
token file small enough to hold in your head. Comments become terse and factual;
design rationale lives here, not in the CSS.

## Color

Both registers live in `palette.css`, side by side.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--surface-0` | `#101214` | `#f7f8f9` | canvas |
| `--surface-1` | `#16181b` | `#ffffff` | cards, panels |
| `--surface-2` | `#1c1f23` | `#eef0f2` | fills, search, hover |
| `--surface-3` | `#22262b` | `#ffffff`+shadow | drawers, modals |
| `--ink-1` | `#f2f4f6` | `#16181b` | headings, emphasis |
| `--ink-2` | `#c9ced4` | `#3f444b` | body |
| `--ink-3` | `#99a0a8` | `#5c636b` | secondary labels |
| `--ink-4` | `#6b727b` | `#7d848d` | timestamps, disabled |
| `--line-1` | `#282c31` | `#e2e5e8` | structural hairline |
| `--line-2` | `#1f2226` | `#eceef0` | soft hairline |
| `--action` | `#6ba1d4` | `#33689e` | actions, focus, brand |
| `--action-hover` | `#84b3e0` | `#2a5786` | hover/active |
| `--action-soft` | `#15202c` | `#e4eef7` | selection wash |
| `--on-action` | `#0e1216` | `#ffffff` | text on action fill |
| `--ok` | `#3fb96c` | `#1e8a4c` | success (dot/border/text) |
| `--warn` | `#d9a13f` | `#9a6b1a` | warning |
| `--err` | `#e5635f` | `#c93d3d` | danger |
| `--info` | = `--ink-3` | = `--ink-3` | neutral notice |
| `--scrim` | `rgba(0,0,0,.66)` | `rgba(12,14,16,.55)` | overlay scrim (one layer) |

Rules:

- Named `--action` (not `--accent` — shadcn reserves `--accent`/`--ring` as its own aliases). It is the only action color. No disabled hex — disabled is opacity.
- Status is dot/border/text only, never fills, never actions. One value per hue
  per register, tuned to pass AA as small text (kills the dot-vs-text dual ramp).
- Deleted: the 7 artifact-kind hues (chips go monochrome; kind carried by icon +
  mono label), `--color-rust` (code numerals → ink-2 mono), porcelain, the
  3-layer overlay stack (nesting = opacity), the graphite always-dark trio (the
  always-dark diff surface consumes dark-register values via one scoped block).

## Typography

Geist for everything; Geist Mono for code, IDs, logs. **Instrument Serif is
deleted** — hero headlines (login, empty states) become Geist 600 with tight
tracking; the font import goes away.

Ten roles: `--type-display` (600 32/1.15), `--type-title` (600 22/1.2),
`--type-heading` (600 16/1.3), `--type-body` (400 15/1.5), `--type-body-sm`
(400 14/1.5), `--type-label` (500 13/1.4), `--type-label-strong` (600 13/1.4),
`--type-micro` (500 11/1.4 caps), `--type-number` (600 19/1.4 tabular),
`--type-code` (400 13/1.5 mono).

Raw sizes: 11 / 13 / 14 / 15 / 22 / 32. Tracking: `--track-tight` (−0.02em,
≥22px), `--track-0`, `--track-caps` (0.05em). Body drops 17→15px — the one
deliberate visual change; the colder console reads better one notch denser.
CJK overrides survive (leading + caps-tracking neutralization), fewer knobs.

## Geometry, elevation, motion

- Radii: `--r-1` 4px (chips/tags), `--r-2` 6px (controls), `--r-3` 10px
  (cards/drawers/modals), `--r-full`.
- Spacing: 4px scale renamed `--sp-1`…`--sp-9` (4/8/12/16/20/24/32/48/64); `--sp-row`, `--control-h` 40px.
- Shadows: `--shadow-1` (soft drop, for bordered surfaces), `--shadow-2`
  (ring+drop, for borderless floating chrome).
- Focus: `--focus-ring` (2px action + 22% halo), `--focus-ring-danger`.
- Z: 5 layers — popover 20 / drawer 30 / sheet 50 / float 120 / dialog 300
  (modal merges into drawer, overlay into dialog).
- Motion: one ease `cubic-bezier(0.2,0,0,1)`; `--t-fast` 120ms, `--t-slow`
  320ms. Nothing overshoots.

## Files

```
styles/tokens.css               @import manifest, short header
styles/tokens/palette.css       raw values, both registers (only place hex is allowed)
styles/tokens/roles.css         role aliases, type roles, shadows, rings, z, motion
styles/tokens/shadcn-bridge.css rewired to new names
styles/tokens/base.css          reset + utilities rewired
```

`primitives.css` and `semantic.css` are deleted. Migration is a mechanical
rename map applied across component CSS + TSX call-sites; old names are deleted
(no alias shim). Stylelint keeps enforcing hex-only-in-palette. Serif
call-sites restyled; Instrument Serif removed from `layout.tsx`. Artifact chips
drop kind-colored borders.

## Verification

tsc, stylelint, full web suite, then Playwright screenshots across
chat / backlog / admin / login in both registers.
