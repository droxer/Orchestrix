---
version: 1.0
name: Relay-Phosphor
description: Phosphor — a true-neutral, dual-register design system for an agent-orchestration control plane, built on one rule: Relay is grey until something is working. A neutral canvas (#101214 dark / #f7f8f9 light) with a four-step surface ladder carries the chrome; the ACTION color is pure monochrome, Linear-style — white (#f2f4f6) on dark, black (#16181b) on light — brand mark, primary CTA, focus ring, link emphasis. Status is a grey brightness hierarchy (loud = bright, calm = dim) carried as dots, borders, and text — never fills, never actions; "info" is neutral ink. Exactly one chromatic role exists, --live (#3ee08a dark / #0b7a45 light), and it means one thing only: an agent is doing work right now. A screen's color density is therefore a utilization readout. Both registers are designed side by side — neither derives from the other. JetBrains Mono carries the display tier and technical text, separated by weight and tracking rather than by face, while Geist carries dense UI and reading roles. Geometry is tight — 4px chips, 6px controls, 10px cards — and depth comes from hairline borders, not shadows. Motion is one ease, two speeds, no overshoot. The result reads as serious infrastructure software — a dense, calm control plane that visibly comes alive when its workforce runs.

colors:
  action: "#f2f4f6"
  action-hover: "#ffffff"
  action-soft: "color-mix(in srgb, #f2f4f6 9%, transparent)"
  on-action: "#101214"
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
  ok: "#7d848d"
  warn: "#b2b9c1"
  err: "#f2f4f6"
  info: "#99a0a8"
  live: "#3ee08a"

typography:
  display:
    fontFamily: "var(--font-app-mono), 'JetBrains Mono', monospace"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.04em
  title:
    fontFamily: "var(--font-app-mono), 'JetBrains Mono', monospace"
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.04em
  heading:
    fontFamily: "var(--font-app-mono), 'JetBrains Mono', monospace"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.04em
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
    letterSpacing: 0.03em
  number:
    fontFamily: "var(--font-app-mono), 'JetBrains Mono', monospace"
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: -0.04em
  code:
    fontFamily: "var(--font-app-mono), 'JetBrains Mono', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  r-1: 4px
  r-2: 6px
  r-3: 10px
  r-4: 14px
  full: 9999px

spacing:
  sp-0-5: 2px
  sp-1: 4px
  sp-1-5: 6px
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

# Relay Design — Phosphor

<p align="center">
  <img src="../web/public/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

## Overview

Relay's visual language is **Phosphor**, and it rests on one rule:

> **Relay is grey until something is working.**

A true-neutral canvas, a monochrome white/black action color, status as a grey
brightness hierarchy, two registers designed side by side — and exactly one
chromatic role, reserved entirely for work an agent is doing *right now*. Every
step of brightness is a unit of information, and the single unit of color is
liveness.

- **One action color.** White on dark, black on light (`{colors.action}` —
  #f2f4f6 dark / #16181b light) carries the brand mark, primary CTAs, focus,
  links, and selection. On dark the fill is bright, so on-action text is dark
  ink (#101214); on light the fill is black and carries white. There is no
  disabled hex — disabled is opacity.
- **Status is dot / border / text — never fills.** `--ok` `--warn` `--err`
  are a grey brightness hierarchy — loud = bright (`--err` brightest),
  calm = dim (`--ok` dimmest) — holding exactly one value per register each
  (the dot color and the text color are the same token). `--warn` and `--err`
  pass AA as small text; `--ok` is the decorative-calm tier, below AA by
  design. `--info` is not a separate value: it aliases `--ink-3`.
- **Dual-first registers.** The light theme is not derived from the dark
  one; each hex pair is picked for its own canvas and both live side by
  side in `palette.css`. Dark is the default register (`:root`);
  `html[data-theme="light"]` overrides it.
- **Color means "alive", and nothing else.** `--live` (#3ee08a dark /
  #0b7a45 light) marks work in flight — presence dot, active-row wash and
  edge, elapsed timer, running bar. It is never an action, never a status,
  never decoration. Because idle surfaces hold no color, a screen's color
  density reads as a utilization gauge from across the room. Both register
  values pass AA as small text.
- **One mono, two jobs.** JetBrains Mono carries the display tier *and*
  technical text; they are separated by weight, tracking, and color rather
  than by face — 700/600 in `--ink-1` with `--track-display` for titles,
  names, and metrics; 400 untracked in `--ink-4` for IDs, logs, and code.
  Geist carries reading and control text.
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
   shared utilities (`.tnum`, `.code`, `.eyebrow`, `.tone-*`).

   `.tnum` and `.code` are deliberately two names, not one. `.tnum` gives
   tabular figures in the reading face — counts, timestamps, ratios, sizes.
   `.code` gives the mono face to literal strings the operator could type,
   paste, or diff — node ids, `@handles`, emails, workspace paths,
   credentials. They replace a single `.mono` utility that named a monospace
   face while only ever setting tabular figures, so every identifier wearing
   it silently rendered in the sans. Because `.code` sets `font-family`
   alone, a companion rule using the `font` shorthand resets it; those sites
   carry an explicit `.<class>.code` override.

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
| `--action` | `#f2f4f6` | `#16181b` | actions, focus, brand |
| `--action-hover` | `#ffffff` | `#000000` | hover / active |
| `--action-soft` | 9% action wash | 7% action wash | selection wash, active nav |
| `--on-action` | `#101214` | `#ffffff` | text on the action fill |
| `--ok` | `#7d848d` | `#6b727b` | ready, passed, done — calm (dim) |
| `--warn` | `#99a0a8` | `#5c636b` | attention, degraded |
| `--err` | `#f2f4f6` | `#16181b` | failed, destructive — loud (bright) |
| `--info` | = `--ink-3` | = `--ink-3` | neutral notice |
| `--live` | `#3ee08a` | `#0b7a45` | an agent is working *right now* |
| `--live-wash` | 7% live wash | 7% live wash | active-row tint |
| `--scrim` | `rgba(0,0,0,.66)` | `rgba(12,14,16,.55)` | overlay scrim (one layer) |

`--action-soft` is not a hex: it is `color-mix(in srgb, <action> 9%, transparent)`
on dark and the 7% equivalent on light, so the selection wash always tracks the
action color. Note the deliberate collision in the dark register:
`--err == --ink-1 == --action` (`#f2f4f6`), so dark-theme error text is
pixel-identical to heading text and error states lean on icon and context.
This is inherent to the loud = bright hierarchy — do not "fix" it by tinting.

An **always-dark group** (`--dark-surface`, `--dark-surface-2`,
`--dark-ink`, `--dark-ink-soft`, `--dark-line`) mirrors the dark register
for chrome that never flips (the diff viewer, ink-fill buttons). It is
register-invariant by design.

Artifact chips are **monochrome** — kind is carried by the icon and the
mono kind label, not by hue. The old per-kind rainbow is retired.

### The `--live` scope rule

`--live` is the only chromatic value in the system, so its scope is defined
rather than left to judgment. **`--live` is legal exactly where `--t-pulse` is
used, and nowhere `--t-pulse-calm` is used.** That boundary already existed:
`--t-pulse` is documented as "active work (streaming agent, running task, busy
header)" and `--t-pulse-calm` as "passive presence (online dot, idle node)".

| takes `--live` | stays grey |
|---|---|
| composer running indicator | node online dot |
| task + backlog running rows | workspace metric |
| agent stream activity | login readiness |
| busy header agent | any idle or merely-present state |
| thread pulse, streaming rail node | |

Two carve-outs, both deliberate:

- **Login is monochrome.** It reports node readiness *before authentication*,
  not agent work, and runs on the pinned `--lg-*` palette because no theme has
  loaded. Pre-auth Relay shows zero green — this is not an oversight to fix.
- **App icons carry the accent.** `favicon.svg` and both `relay-mark.svg`
  copies use `--live` on their chevron. A tab-strip icon is not reporting a
  run, but at 16px a grey chevron on a grey square is invisible. This is the
  only non-liveness use of the accent anywhere; the bare mark and the wordmark
  stay monochrome.

Because every `--live` surface also pulses and is accompanied by an elapsed
timer and status copy, color is never the sole channel (WCAG 1.4.1). Motion is
part of that encoding, so `prefers-reduced-motion` needs checking whenever a
liveness surface changes.

## Typography

**JetBrains Mono** carries both `--font-display` (display, title, heading, and
metric roles) and `--font-mono` (code-like content) — one family, two jobs.
**Geist** (`--font-sans`) carries reading and control text. Ten roles:

| Role | Spec | Use |
|---|---|---|
| `--type-display` | 700 32/1.15 | hero headline, admin metric values |
| `--type-title` | 700 20/1.2 | page + chat titles |
| `--type-heading` | 600 16/1.3 | section heads, list labels |
| `--type-body` | 400 15/1.5 | prose, message bodies, inputs |
| `--type-body-sm` | 400 14/1.5 | dense prose, captions |
| `--type-label` | 500 13/1.4 | chrome labels, nav, metadata |
| `--type-label-strong` | 600 13/1.4 | bold chrome, button labels |
| `--type-micro` | 500 11/1.4 | eyebrows and compact metadata |
| `--type-number` | 700 19/1.4 | metrics (mono is already tabular) |
| `--type-code` | 400 13/1.5 | commands, logs, IDs |

Display and code share a face, so the distinction is carried by **weight,
tracking, and color**: display is 700/600 in `--ink-1` with
`--track-display`; `--type-code` is 400, untracked, in `--ink-4`. Keep that
separation intact — it is the only thing preventing an agent name and a
session ID from reading as the same kind of object.

Raw sizes (`--fs-1`…`--fs-6`, rem): 11 / 13 / 14 / 15 / 22 / 32. The root
font-size is pinned to 87.5% so the browser's font-size preference scales
the whole UI (WCAG 1.4.4).

Tracking is four tokens. **`--track-display` (−0.04em) must be applied to every
display-tier rule** — a monospace title without it reads as spaced-out code, and
the `font` shorthand cannot carry letter-spacing.

Display-tier means *two* shapes, and both must be swept:

1. rules using a `--type-display` / `title` / `heading` / `number` role (18), and
2. rules that opt into `font-family: var(--font-display)` by hand (12) — login's
   headline and wordmark, drawer titles, stat values, the mobile topbar title.

Missing the second shape is how the login screen briefly shipped untracked. A
second `letter-spacing` in the same rule silently overrides the first, so
`typographyTokens.test.ts` sweeps every stylesheet and requires exactly one
correct declaration per display-tier rule — 30 in total. The one deliberate
exclusion is `.relay-bleed-mark`, a single decorative glyph with no
inter-character spacing to track.

`--track-tight` and `--track-0` both resolve to zero. `--track-tight` was kept
rather than repurposed for display, and after the sweep it retains exactly one
consumer — `.route-loading`, which is sans. `--track-caps` is a restrained
0.03em, limited to statuses, badges, and table headers that intentionally use
caps.

**CJK:** `html:lang(zh-CN)` / `html:lang(zh-TW)` put a system CJK family first
for both Latin and Han glyphs, keeping mixed-script labels internally coherent.
JetBrains Mono has no Han coverage, so display roles join that same sans stack —
and `--track-display` is pinned to 0 there, or Han titles would be crushed
together. Caps tracking narrows to 0.02em and reading leading loosens.

The vendored WOFF2 is fontsource's **latin** subset of JetBrains Mono
(`@fontsource-variable/jetbrains-mono` 5.3.0, OFL-1.1, wght 100–800). Latin
covers U+00C0–00FF, so accented names render in-face; latin-ext glyphs fall
through to Geist by design rather than shipping a second file.

## Geometry, elevation, motion

- **Radii:** `--r-1` 4px (chips, tags) · `--r-2` 6px (buttons, inputs, all
  controls) · `--r-3` 10px (cards, drawers, modals) · `--r-4` 14px (hero
  plates, sheets) · `--r-full` (dots, avatars, pills).
- **Spacing:** 4px base — `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4`
  16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-7` 32 · `--sp-8` 48 · `--sp-9` 64.
  Below the base sit exactly two micro steps, `--sp-0-5` 2 and `--sp-1-5` 6,
  for glyph-tight pairs (dot ↔ label, icon ↔ text, stacked meta lines) where
  a full 4px step would read as separation rather than pairing. They are the
  only sanctioned sub-4px gaps — do not introduce 3px or 5px one-offs.
  `--sp-row` (12px, compact 8px via `[data-density="compact"]`) sets row
  rhythm; `--control-h` (40px) is the standard control height.
- **Elevation:** the system is flat — planes separate by hairline, not lift.
  `--shadow-1` is `none` (bordered surfaces carry no drop); `--shadow-2`
  resolves to a single 1px ring so borderless floating chrome (drawers,
  dialogs, composer, tooltips) keeps a crisp edge without faux depth.
- **Focus:** `--focus-ring` — 2px solid action ring + 22% halo (WCAG
  1.4.11); destructive controls use `--focus-ring-danger`.
- **Z layers:** `--z-popover` 20 · `--z-drawer` 30 · `--z-sheet` 50 ·
  `--z-float` 120 · `--z-dialog` 300.
- **Motion:** `--ease` `cubic-bezier(0.2, 0, 0, 1)`; `--t-fast` 120ms for
  interaction feedback, `--t-slow` 320ms for entrances. No spring, no
  overshoot.
- **Ambient loops:** two cadences only, so the same liveness reads at the
  same tempo everywhere — `--t-pulse` 1.6s for active work (streaming agent,
  running task, busy header) and `--t-pulse-calm` 2.6s for passive presence
  (online dot, idle node). Never hand-pick a loop duration.
- **Entrances:** one shared `rise` keyframe (`tokens/base.css`) — fade plus
  a translateY read from `--rise-from`. Two travel tiers: `--rise-sm` 4px
  for rows inside a scroller, `--rise` 8px (the default) for panes and
  views. Do not add another fade-and-rise keyframe; set the tier instead.

## Do's and Don'ts

### Do
- Use `--action` for actions, and use it scarcely: brand mark, primary CTA,
  focus ring, link emphasis, selection.
- Pair the action fill with `--on-action` — dark ink on the dark register's
  white fill, white on the light register's black fill.
- Use `--action-soft` for selected rows, active nav, running affordances.
- Carry status as dots/borders/text on the grey brightness hierarchy
  (loud = bright, calm = dim); use `--info` (neutral ink) for status
  without alarm.
- Use `--live` only for work happening right now, and only where `--t-pulse`
  is used — see the scope rule under Colors.
- Pair `--live` with motion and text, never color alone.
- Apply `letter-spacing: var(--track-display)` at every display-role site.
- Disable with opacity, not a dedicated hex.
- Carry depth with hairlines first; shadows only on floating chrome.
- Add new raw values to `palette.css` and new roles to `roles.css` — never
  inline a color in a component file (`npm run lint:css -w web` enforces).

### Don't
- Don't use a status color as an action, or the action color as a status.
- Don't introduce a second chromatic color. `--live` is the only hue in the
  system; everywhere else brightness is the only signal.
- Don't use `--live` for success, health, or "done" — it means *running*, not
  *passed*. A finished task is grey.
- Don't add green to the login screen; pre-auth is monochrome by design.
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

Charts are greyscale — a brightness ramp, not a hue ramp. The admin
token-usage chart uses a fixed three-segment ramp: input = `--action`
(brightest), output = `--ok`, cache = `--ink-4` (dimmest). Fleet-health
bars and activity charts use the status greys inside chart segments only
(`chart-3/4/5` alias `--ok`/`--warn`/`--err`, so they follow the palette
for free).

## History

Graphite (2026-07-19) replaces the Sleek Forest identity (warm near-black +
forest green + Instrument Serif) and its four-tier primitives/semantic token
system. Design rationale and the migration map live in
`docs/superpowers/specs/2026-07-19-graphite-tokens-design.md`.

The monochrome remap (2026-07-20) then retired Graphite's steel-blue action
color and chromatic status hues in favor of the Linear-style white/black
action and the grey status brightness hierarchy — a token-value-only change;
the architecture above is unchanged. Rationale and the exact value map live
in `docs/superpowers/specs/2026-07-20-monochrome-tokens-design.md`.

**Phosphor (2026-07-28)** keeps that monochrome ramp intact and changes what
the system is *about*. Seven identities in eight weeks had each been a palette
swap, and each was judged "generic" within weeks — so this pass changed the
subject instead of the hue: color was reduced to a single role, `--live`, tied
to the product's own subject matter (agents working), and the display tier
moved to JetBrains Mono so type and color argue the same point. Mona Sans and
Geist Mono were retired for a net ~164 KB less font payload. Rationale,
contrast measurements, and the scope rule live in
`docs/superpowers/specs/2026-07-28-phosphor-identity-design.md`.
