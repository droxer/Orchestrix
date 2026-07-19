---
version: 1.0
name: Relay-Graphite
description: Graphite — a true-neutral, dual-register design system for an agent-orchestration control plane. A neutral graphite canvas (#101214 dark / #f7f8f9 light) with a four-step surface ladder carries the chrome; one restrained steel blue (#6ba1d4 dark / #33689e light) is the single chromatic ACTION color — brand mark, primary CTA, focus ring, link emphasis. Status (green / amber / red) is the only other chroma, carried as dots, borders, and text — never fills, never actions; "info" is neutral ink. Both registers are designed side by side — neither derives from the other. One crisp grotesk (Geist) carries every text role with weight doing the differentiating; Geist Mono is reserved for code, IDs, and logs. Geometry is tight — 4px chips, 6px controls, 10px cards — and depth comes from hairline borders, not shadows. Motion is one ease, two speeds, no overshoot. The result reads as serious infrastructure software — a dense, calm control plane for AI agents.

colors:
  action: "#6ba1d4"
  action-hover: "#84b3e0"
  action-soft: "#15202c"
  on-action: "#0e1216"
  ink-1: "#f2f4f6"
  ink-2: "#c9ced4"
  ink-3: "#99a0a8"
  ink-4: "#6b727b"
  line-1: "#282c31"
  line-2: "#1f2226"
  surface-0: "#101214"
  surface-1: "#16181b"
  surface-2: "#1c1f23"
  surface-3: "#22262b"
  ok: "#3fb96c"
  warn: "#d9a13f"
  err: "#e5635f"
  info: "#99a0a8"

typography:
  display:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
  title:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  heading:
    fontFamily: "'Geist', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body:
    fontFamily: "'Geist', sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  label-strong:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  micro:
    fontFamily: "'Geist', sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.05em
  number:
    fontFamily: "'Geist', sans-serif"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  code:
    fontFamily: "'Geist Mono', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  r-1: 4px
  r-2: 6px
  r-3: 10px
  full: 9999px

spacing:
  sp-1: 4px
  sp-2: 8px
  sp-3: 12px
  sp-4: 16px
  sp-5: 20px
  sp-6: 24px
  sp-7: 32px
  sp-8: 48px
  sp-9: 64px

components:
  side-nav:
    backgroundColor: "{colors.surface-1}"
    activeBackgroundColor: "{colors.action-soft}"
    textColor: "{colors.ink-2}"
    widthCollapsed: 72px
    widthExpanded: 228px
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.r-2}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-1}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.r-2}"
    border: "1px solid {colors.line-1}"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.r-3}"
    border: "1px solid {colors.line-1}"
    padding: 16px
  text-input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-1}"
    typography: "{typography.body}"
    rounded: "{rounded.r-2}"
    height: 40px
  badge:
    backgroundColor: transparent
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    border: "1px solid {colors.line-1}"
  status-dot:
    rounded: "{rounded.full}"
    size: 7px
---

# Relay Design — Graphite

<p align="center">
  <img src="../web/public/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

## Overview

Relay's visual language is **Graphite**: a true-neutral canvas, one steel-blue
action color, status-only chroma, and two registers designed side by side.
Every other unit of chroma in the interface is a unit of information.

- **One action color.** Steel blue (`{colors.action}` — #6ba1d4 dark /
  #33689e light) carries the brand mark, primary CTAs, focus, links, and
  selection. On dark the fill is bright, so on-action text is dark ink
  (#0e1216); on light the fill deepens and carries white. There is no
  disabled hex — disabled is opacity.
- **Status is dot / border / text — never fills.** `--ok` `--warn` `--err`
  hold exactly one value per register each, tuned to pass AA as small text
  (the dot color and the text color are the same token). `--info` is not a
  color: it aliases `--ink-3`.
- **Dual-first registers.** The light theme is not derived from the dark
  one; each hex pair is picked for its own canvas and both live side by
  side in `palette.css`. Dark is the default register (`:root`);
  `html[data-theme="light"]` overrides it.
- **One grotesk.** Geist carries every text role — weight and size
  differentiate, never a family switch, and emphasis tops out at 600.
  Geist Mono is reserved for code, IDs, and logs. There is no display
  serif.
- **Tight geometry, hairline depth.** 4px chips, 6px controls, 10px
  cards/drawers/modals. Structure comes from 1px hairlines; the two shadow
  tokens are reserved for floating chrome.
- **One ease, two speeds.** `--ease` `cubic-bezier(0.2, 0, 0, 1)`,
  `--t-fast` 120ms, `--t-slow` 320ms. Nothing overshoots.

A living specimen page is `docs/design-system-preview.html` — open it in a
browser; it implements these exact tokens with a register toggle.

## Token architecture

Tokens live under `web/src/styles/tokens/`, imported in order by
`web/src/styles/tokens.css` (a pure `@import` manifest — never add a token
there):

1. **`palette.css`** — raw values: both color registers side by side, plus
   the register-invariant scales (radii, spacing, type sizes, tracking,
   leading, z-index, motion, families, shell dimensions). This is the
   *only* file allowed to originate a color — enforced by
   `web/.stylelintrc.json`.
2. **`roles.css`** — the composites: ten `--type-*` roles, `--shadow-1` /
   `--shadow-2`, `--focus-ring` / `--focus-ring-danger`, and the `--info`
   alias.
3. **`shadcn-bridge.css`** — the `@theme inline` block and
   `--background` / `--primary` / etc. aliases that shadcn/ui and Tailwind
   utilities consume. Utility names (`bg-surface-soft`, `text-ink`,
   `rounded-md`, `text-sm`) stay stable so component markup never tracks
   token renames. Note shadcn's own `--accent` / `--ring` names are its
   aliases (hover surface / outline color), which is why the action family
   is named `--action`, not `--accent`.
4. **`base.css`** — html/body reset, the `:focus-visible` contract, and the
   shared utilities (`.mono`, `.eyebrow`, `.tone-*`).

**Naming rule:** component CSS only ever references a palette token
(`--surface-*`, `--ink-*`, `--line-*`, `--action*`, `--ok/--warn/--err/--info`,
`--r-*`, `--sp-*`, `--fs-*`, `--track-*`, `--font-*`, `--z-*`, `--t-*`,
`--ease`) or a role (`--type-*`, `--shadow-*`, `--focus-ring*`) — never a
literal hex/`rgb()`/`hsl()`.

**Documented exceptions** (see `web/.stylelintrc.json`): `login.css` (a
pinned `--lg-*` pre-auth dark ramp mirroring the dark register verbatim),
`preferences.css` (theme swatches that must show both registers at once),
`artifact.css` (the frame preview is a literal white document page), and
`backlog.css` (the procedurally-hued assignee avatar).

## Colors

Dark register / light register:

| Token | Dark | Light | Role |
|---|---|---|---|
| `--surface-0` | `#101214` | `#f7f8f9` | canvas |
| `--surface-1` | `#16181b` | `#ffffff` | cards, panels |
| `--surface-2` | `#1c1f23` | `#eef0f2` | fills, search, hover |
| `--surface-3` | `#22262b` | `#ffffff` + shadow | drawers, modals |
| `--ink-1` | `#f2f4f6` | `#16181b` | headings, emphasis |
| `--ink-2` | `#c9ced4` | `#3f444b` | body |
| `--ink-3` | `#99a0a8` | `#5c636b` | secondary labels |
| `--ink-4` | `#6b727b` | `#7d848d` | timestamps, disabled |
| `--line-1` | `#282c31` | `#e2e5e8` | structural hairline |
| `--line-2` | `#1f2226` | `#eceef0` | soft hairline |
| `--action` | `#6ba1d4` | `#33689e` | actions, focus, brand |
| `--action-hover` | `#84b3e0` | `#2a5786` | hover / active |
| `--action-soft` | `#15202c` | `#e4eef7` | selection wash, active nav |
| `--on-action` | `#0e1216` | `#ffffff` | text on the action fill |
| `--ok` | `#3fb96c` | `#1e8a4c` | ready, passed, done |
| `--warn` | `#d9a13f` | `#9a6b1a` | attention, degraded |
| `--err` | `#e5635f` | `#c93d3d` | failed, destructive |
| `--info` | = `--ink-3` | = `--ink-3` | neutral notice |
| `--scrim` | `rgba(0,0,0,.66)` | `rgba(12,14,16,.55)` | overlay scrim (one layer) |

An **always-dark group** (`--dark-surface`, `--dark-surface-2`,
`--dark-ink`, `--dark-ink-soft`, `--dark-line`) mirrors the dark register
for chrome that never flips (the diff viewer, ink-fill buttons). It is
register-invariant by design.

Artifact chips are **monochrome** — kind is carried by the icon and the
mono kind label, not by hue. The old per-kind rainbow is retired.

## Typography

**Geist** (`--font-sans`) carries every text role; **Geist Mono**
(`--font-mono`) is reserved for code-like content. Ten roles:

| Role | Spec | Use |
|---|---|---|
| `--type-display` | 600 32/1.15 | hero headline, admin metric values |
| `--type-title` | 600 22/1.2 | page + chat titles |
| `--type-heading` | 600 16/1.3 | section heads, list labels |
| `--type-body` | 400 15/1.5 | prose, message bodies, inputs |
| `--type-body-sm` | 400 14/1.5 | dense prose, captions |
| `--type-label` | 500 13/1.4 | chrome labels, nav, metadata |
| `--type-label-strong` | 600 13/1.4 | bold chrome, button labels |
| `--type-micro` | 500 11/1.4 | eyebrows (uppercase + `--track-caps`) |
| `--type-number` | 600 19/1.4 | metrics (tabular-nums) |
| `--type-code` | 400 13/1.5 mono | commands, logs, IDs |

Raw sizes (`--fs-1`…`--fs-6`, rem): 11 / 13 / 14 / 15 / 22 / 32. The root
font-size is pinned to 87.5% so the browser's font-size preference scales
the whole UI (WCAG 1.4.4).

Tracking is three tokens: `--track-tight` (−0.02em, display ≥22px),
`--track-0`, `--track-caps` (0.05em, uppercase labels).

**CJK:** `html:lang(zh-CN)` / `html:lang(zh-TW)` reorder the font stacks
onto system CJK faces, zero the display tracking, narrow caps tracking, and
loosen leading — all in `palette.css` (+ the two reading roles restated in
`roles.css`).

## Geometry, elevation, motion

- **Radii:** `--r-1` 4px (chips, tags) · `--r-2` 6px (buttons, inputs, all
  controls) · `--r-3` 10px (cards, drawers, modals) · `--r-full` (dots,
  avatars, pills).
- **Spacing:** 4px base — `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4`
  16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-7` 32 · `--sp-8` 48 · `--sp-9` 64.
  `--sp-row` (12px, compact 8px via `[data-density="compact"]`) sets row
  rhythm; `--control-h` (40px) is the standard control height.
- **Elevation:** `--shadow-1` — soft drop for surfaces that already carry a
  hairline; `--shadow-2` — ring + drop for borderless floating chrome
  (drawers, dialogs, composer, tooltips). Pick by the surface, not by
  intuition.
- **Focus:** `--focus-ring` — 2px solid action ring + 22% halo (WCAG
  1.4.11); destructive controls use `--focus-ring-danger`.
- **Z layers:** `--z-popover` 20 · `--z-drawer` 30 · `--z-sheet` 50 ·
  `--z-float` 120 · `--z-dialog` 300.
- **Motion:** `--ease` `cubic-bezier(0.2, 0, 0, 1)`; `--t-fast` 120ms for
  interaction feedback, `--t-slow` 320ms for entrances. No spring, no
  overshoot.

## Do's and Don'ts

### Do
- Use `--action` for actions, and use it scarcely: brand mark, primary CTA,
  focus ring, link emphasis, selection.
- Pair the action fill with `--on-action` — dark ink on the dark register's
  bright steel, white on the light register's deepened steel.
- Use `--action-soft` for selected rows, active nav, running affordances.
- Reserve all other hue for status, as dots/borders/text; use `--info`
  (neutral ink) for status without alarm.
- Disable with opacity, not a dedicated hex.
- Carry depth with hairlines first; shadows only on floating chrome.
- Add new raw values to `palette.css` and new roles to `roles.css` — never
  inline a color in a component file (`npm run lint:css -w web` enforces).

### Don't
- Don't use a status color as an action, or the action color as a status.
- Don't introduce a second chromatic accent or use steel as a decorative
  fill.
- Don't fill backgrounds with status colors.
- Don't tint agent avatars with vendor brand colors — glyph shape carries
  identity.
- Don't add overshoot or extra easing curves — there is exactly one ease.
- Don't color artifact chips by kind — monochrome, icon + label only.

## Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 72px | Collapsed left rail |
| `--sidenav-w-open` | 228px | Expanded left rail |
| `--thread-w` | 318px | Conversation list pane |
| `--header-h` | 64px | Chat panel top bar |

## Data visualization

The admin token-usage chart uses a fixed three-segment ramp: input =
`--action`, output = `--ok`, cache = `--ink-4`. Fleet-health bars and
activity charts use the status tones inside chart segments only.

## History

Graphite (2026-07-19) replaces the Sleek Forest identity (warm near-black +
forest green + Instrument Serif) and its four-tier primitives/semantic token
system. Design rationale and the migration map live in
`docs/superpowers/specs/2026-07-19-graphite-tokens-design.md`.
