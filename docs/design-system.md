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

- **One action color.** White on dark, black on light (`--action` —
  #f2f4f6 dark / #16181b light) carries the brand mark, primary CTAs, focus,
  and selection. On dark the fill is bright, so on-action text is dark
  ink (#101214); on light the fill is black and carries white. There is no
  disabled hex — disabled is opacity. Links are **not** `--action`: they take
  `--link`, which resolves to the same value today but is a different job.
- **Status is dot / border / text — never fills.** `--ok` `--warn` `--err`
  are a grey brightness hierarchy — loud = bright (`--err` brightest),
  calm = dim (`--ok` dimmest) — holding exactly one value per register each
  (the dot color and the text color are the same token). **Every tone clears
  AA as small text** against the worst plane it can land on; the tones render
  as text often enough (counts, inline state labels) that a decorative-only
  tier was a liability. `--info` is not a separate value: it aliases `--ink-3`.
- **Every ink tier that can carry text clears 4.5:1.** The bar is the worst
  plane a tier can land on — `--surface-3`, not the canvas — because meta text
  sits on drawers and inset wells too. See the ratio table under Colors.
- **Dual-first registers.** The light theme is not derived from the dark
  one; each hex pair is picked for its own canvas and both live side by
  side in `palette.css`. Dark is the default register (`:root`);
  `html[data-theme="light"]` overrides it.
- **Color means "alive", and nothing else.** `--live` (#3ee08a dark /
  #0b7a45 light) marks work in flight — active dot or ring, elapsed timer,
  and running bar. It is never an action, status, fill, or decoration. Because
  idle surfaces hold no color, a screen's color density reads as a utilization
  gauge from across the room. Both register values pass AA as small text.
- **One mono, two jobs.** JetBrains Mono carries the display tier *and*
  technical text; they are separated by weight, tracking, and color rather
  than by face — 700/600 in `--ink-1` with `--track-display` for titles,
  names, and metrics; 400 untracked in `--ink-4` for IDs, logs, and code.
  Geist carries reading and control text.
- **Tight geometry, hairline depth.** 4px chips, 6px controls, 10px
  cards/drawers/modals. Structure comes from 1px hairlines; the two shadow
  tokens are reserved for floating chrome.
- **One ease, two speeds.** `--ease` `cubic-bezier(0.2, 0, 0, 1)`,
  `--t-fast` 120ms, `--t-slow` 280ms. Nothing overshoots.

The executable source is `web/src/styles/tokens/`. Review the application in
both registers when changing tokens; do not maintain a second hard-coded token
demo.

## Token architecture

Tokens live under `web/src/styles/tokens/`, imported by
`web/src/styles/styles.css`. The three Relay files are pulled in with
`layer(relay)`; `shadcn-bridge.css` stays **unlayered** because it carries the
Tailwind `@theme` machinery:

1. **`palette.css`** — raw values: both color registers side by side, plus
   the register-invariant scales (radii, spacing, measure, type sizes,
   tracking, leading, z-index, motion, families, shell dimensions). This is
   the *only* file allowed to originate a color — enforced by
   `web/.stylelintrc.json`.
2. **`roles.css`** — the composites: ten `--type-*` roles and their paired
   `--type-*-track` tokens, `--shadow-1` / `--shadow-2`, the focus contract
   (`--focus-outline` / `--focus-outline-danger` / `--focus-w` /
   `--focus-offset`), `--link` / `--link-hover`, and the `--info` alias.
3. **`shadcn-bridge.css`** — the `@theme inline` block and
   `--background` / `--primary` / etc. aliases that shadcn/ui and Tailwind
   utilities consume. Utility names (`text-ink`, `border-hairline`,
   `rounded-md`, `text-sm`) stay stable so component markup never tracks
   token renames. Note shadcn's own `--accent` / `--ring` names are its
   aliases (hover surface / outline color), which is why the action family
   is named `--action`, not `--accent`.

   The file has two halves with different rules. The **additive** colour
   aliases exist only if a component asks for them — Tailwind ships no default
   for `text-ink`, so an unused entry is dead and gets deleted. The **scale
   guards** (`--radius-*`, `--text-*`, `--spacing`) override stock Tailwind
   scales, so they are kept complete whether or not each step is used:
   deleting `--radius-xl` does not remove `rounded-xl`, it hands it back to
   Tailwind's 12px default, off the 4/6/10/14 ramp. There is deliberately no
   named spacing scale — `p-sm` and `p-3` were the same 12px reached two ways,
   and the numeric scale is the one that maps 1:1 onto `--sp-N`.
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
`--r-*`, `--sp-*`, `--measure*`, `--fs-*`, `--track-*`, `--font-*`, `--z-*`,
`--t-*`, `--ease`) or a role (`--type-*`, `--shadow-*`, `--focus-*`,
`--link*`) — never a literal hex/`rgb()`/`hsl()`.

**Exceptions are per-line, not per-file.** `web/.stylelintrc.json` grants
exactly one file-level override — `palette.css`, which originates colour by
definition. Everything else that needs a raw value carries an inline
`stylelint-disable-next-line` naming its reason, and there are only two:
`profile-image.css` and `backlog.css`, both for the procedurally-generated
per-identity avatar hue, where the hue *is* the value and no fixed token could
express it. `login.css`, `preferences.css`, and `artifact.css` are **not**
exceptions — they consume the pinned `--dark-*` / `--light-*` / `--paper`
tokens, which is exactly why those tokens exist.

## Colors

Dark register / light register:

| Token | Dark | Light | Role |
|---|---|---|---|
| `--surface-0` | `#0b0d0f` | `#f1f3f5` | canvas |
| `--surface-1` | `#16181b` | `#fafbfc` | cards, panels |
| `--surface-2` | `#1c1f23` | `#e9ecef` | fills, search, hover |
| `--surface-3` | `#22262b` | `#ffffff` | drawers, modals |
| `--ink-1` | `#f2f4f6` | `#16181b` | headings, emphasis |
| `--ink-2` | `#c9ced4` | `#3f444b` | body |
| `--ink-3` | `#a6adb5` | `#545b63` | secondary labels |
| `--ink-4` | `#878e97` | `#636a72` | timestamps, meta, disabled |
| `--line-1` | `#282c31` | `#dcdfe3` | structural hairline |
| `--line-2` | `#1f2226` | `#eceef0` | soft hairline |
| `--action` | `#f2f4f6` | `#16181b` | actions, focus, brand |
| `--action-hover` | `#ffffff` | `#000000` | hover / active |
| `--action-soft` | 9% action wash | 7% action wash | selection wash, active nav |
| `--on-action` | `#101214` | `#ffffff` | text on the action fill |
| `--link` / `--link-hover` | = `--ink-1` / `--action-hover` | same | anchors in prose |
| `--ok` | `#8f96a0` | `#5a6169` | ready, passed, done — calm (dim) |
| `--warn` | `#b2b9c1` | `#484f57` | attention, degraded |
| `--err` | `#f2f4f6` | `#16181b` | failed, destructive — loud (bright) |
| `--info` | = `--ink-3` | = `--ink-3` | neutral notice |
| `--live` | `#3ee08a` | `#0b7a45` | an agent is working *right now* |
| `--scrim` | `rgba(0,0,0,.66)` | `rgba(12,14,16,.55)` | overlay scrim (one layer) |

### The surface ladder runs both ways

In **dark** the ladder is elevation: 0 < 1 < 3 in perceived lift, with 2 as
the fill tier between card and drawer. **Light cannot reproduce that**, because
white is a ceiling you cannot build above — so 0..3 there is a ladder of
*distinctness*: canvas `#f1f3f5` → cards `#fafbfc` (raised) → drawers/modals
`#ffffff` (top plane), with `--surface-2` deliberately **recessed** below the
canvas. A search field or hover well recedes from white and emerges from black;
that inversion is correct, and only `--surface-2` does it.

Elevation is flat, so the canvas → card step plus a hairline is *all* that
separates a card from the page. It is therefore the **widest** step in the dark
ladder on purpose (okL 0.05 vs 0.03 for the rest): an evenly spaced ramp left it
at 1.06:1, below the point where a borderless card reads as raised at all.

### Contrast floors

Every tier that can carry text clears WCAG 1.4.3 against **the worst plane it
can land on**, not against the canvas. Ratios against that plane:

| | ink-1 | ink-2 | ink-3 | ink-4 | ok | warn | err |
|---|---|---|---|---|---|---|---|
| dark (vs `--surface-3`) | 13.80 | 9.61 | 6.71 | 4.60 | 5.10 | 7.68 | 13.80 |
| light (vs `--surface-2`) | 15.00 | 8.28 | 5.80 | 4.62 | 5.29 | 7.00 | 15.00 |

`monochromeTokens.test.ts` computes these from the declared hexes rather than
pinning the hexes themselves, so a future palette move is checked for
*legibility* rather than for matching a list. The light steps are tighter than
dark (1.26 at the calm end vs 1.46) and that is structural: white bounds the
light ramp at one end and the AA floor at the other.

`--action-soft` is not a hex: it is `color-mix(in srgb, <action> 9%, transparent)`
on dark and the 7% equivalent on light, so the selection wash always tracks the
action color. Note the deliberate collision in the dark register:
`--err == --ink-1 == --action` (`#f2f4f6`), so dark-theme error text is
pixel-identical to heading text and error states lean on icon and context.
This is inherent to the loud = bright hierarchy — do not "fix" it by tinting.

A **pinned group** (`--dark-canvas`, `--dark-surface`, `--dark-surface-2`,
`--dark-elevated`, `--dark-ink`, `--dark-ink-strong`, `--dark-body`,
`--dark-ink-soft`, `--dark-line`, `--dark-line-soft`, plus `--light-canvas`,
`--light-surface`, `--light-ink`) mirrors the registers for chrome that must
*not* follow the active theme: the pre-auth login ramp, the theme-picker
swatches that show both registers at once, the diff viewer, ink-fill buttons.

These only do their job if they track the register they mirror, and they
silently drifted the moment the canvas moved — the exact failure they exist to
prevent. A test now asserts each pinned token equals its live counterpart.

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
| status pill on a running agent/node (TonePill `live`) | |

"One colour" is a claim about **meaning**, not pigment. Three carve-outs, all
deliberate — a reader who takes the rule literally will file them as bugs:

- **Login is monochrome.** It reports node readiness *before authentication*,
  not agent work, and runs on the pinned `--lg-*` palette because no theme has
  loaded. Pre-auth Relay shows zero green — this is not an oversight to fix.
- **App icons carry the accent.** `favicon.svg` and both `relay-mark.svg`
  copies use `--live` on their chevron. A tab-strip icon is not reporting a
  run, but at 16px a grey chevron on a grey square is invisible. The bare mark
  and the wordmark stay monochrome.
- **Identity hues are procedural.** `IdentityMonogram` and `TaskAssignee`
  derive a per-name hue (`hsl(var(--avatar-hue) …)` in `profile-image.css` and
  `backlog.css`, each with an inline stylelint exemption). These encode *who*,
  never *what is happening*, and no fixed token could express them because the
  hue is computed from the name.

None of the three is a status, so none competes with `--live` for meaning. Any
**fourth** source of colour is a bug.

Because every `--live` surface also pulses and is accompanied by an elapsed
timer and status copy, color is never the sole channel (WCAG 1.4.1). Motion is
part of that encoding, so `prefers-reduced-motion` needs checking whenever a
liveness surface changes.

## Typography

**JetBrains Mono** carries both `--font-display` (display, title, heading, and
metric roles) and `--font-mono` (code-like content) — one family, two jobs.
**Geist** (`--font-sans`) carries reading and control text. Ten roles:

| Role | Spec | Paired track | Use |
|---|---|---|---|
| `--type-display` | 700 32/1.15 | `--track-display` | hero headline, admin metric values |
| `--type-title` | 700 20/1.2 | `--track-display` | page + chat titles |
| `--type-heading` | 600 17/1.3 | `--track-display` | section heads, list labels, in-message h1 |
| `--type-body` | 400 15/1.5 | `--track-body` | prose, message bodies, inputs |
| `--type-body-sm` | 400 14/1.5 | `--track-body-sm` | dense prose, captions |
| `--type-label` | 500 13/1.4 | `--track-body-sm` | chrome labels, nav, metadata |
| `--type-label-strong` | 600 13/1.4 | `--track-body-sm` | bold chrome, button labels |
| `--type-micro` | 500 11/1.4 | `--track-caps` | eyebrows and compact metadata |
| `--type-number` | 700 20/1.4 | `--track-display` | metrics (mono is already tabular) |
| `--type-code` | 400 13/1.5 | `--track-0` | commands, logs, IDs |

**Every role ships a paired `--type-<role>-track`.** The `font:` shorthand
cannot carry `letter-spacing`, so a role applied as `font: var(--type-title)`
silently loses its tracking unless the call site remembers a second
declaration — which is how an untracked login headline shipped once. Pairing
the tokens by name is what makes the omission greppable; Linear ships
`--title-1` beside `--title-1-letter-spacing` for exactly this reason.

Display and code share a face, so the distinction is carried by **weight,
tracking, and color**: display is 700/600 in `--ink-1` with
`--track-display`; `--type-code` is 400, untracked, in `--ink-4`. Keep that
separation intact — it is the only thing preventing an agent name and a
session ID from reading as the same kind of object.

The size ladder is **11 / 13 / 14 / 15 / 17 / 20 / 22 / 32** (`--fs-1`,
`--fs-2`, `--fs-3`, `--fs-4`, `--fs-heading`, `--fs-title`, `--fs-5`,
`--fs-6`, all rem). Nothing sits closer than 2px above `--fs-4`: steps a
single pixel apart cost a token and buy no visible hierarchy. The two that
tried — KPI numerals at 19 and in-message h1 at 18 — were retired into
`--fs-title` and `--fs-heading`, and `--fs-heading` moved 16 → 17 so a heading
clears body copy without relying on weight alone. Roles that must differ
inside one size differ by weight and colour, the same rule the display tier
already runs on. The root font-size is pinned to 87.5% so the browser's
font-size preference scales the whole UI (WCAG 1.4.4).

Tracking is five tokens: `--track-display` (−0.04em), `--track-body`
(−0.011em), `--track-body-sm` (−0.013em), `--track-0`, and `--track-caps`
(0.03em, limited to statuses, badges, and table headers that intentionally use
caps).

**`--track-display` must be applied to every display-tier rule** — a monospace
title without it reads as spaced-out code.

**Reading text is tracked too, and set once.** `--track-body` is applied on
`html`+`body` in `base.css` and inherited, because a per-role approach would
need a second declaration at every reading call site in the app. Faces that
must not be tightened opt back out: `.tnum` (tabular figures exist to line up;
tightening narrows the advance and undoes that) and every rule that takes
`font-family: var(--font-mono)` (a monospace face is chosen for its fixed
advance, and these are strings an operator compares character by character).
A test sweeps for mono rules that forgot to opt out.

Display-tier means *two* shapes, and both must be swept:

1. rules using a `--type-display` / `title` / `heading` / `number` role (20), and
2. rules that opt into `font-family: var(--font-display)` by hand (16) — login's
   headline and wordmark, drawer titles, stat values, the mobile topbar title.

Missing the second shape is how the login screen briefly shipped untracked. A
second `letter-spacing` in the same rule silently overrides the first, so
`typographyTokens.test.ts` sweeps every stylesheet and requires exactly one
correct declaration per display-tier rule — 36 in total — accepting either
`--track-display` or the role's paired `--type-*-track`. The one deliberate
exclusion is `.relay-bleed-mark`, a single decorative glyph with no
inter-character spacing to track.

There is deliberately **no `--track-tight`**. It was declared `0`, so its name
promised a tightening it never applied, and its single consumer wanted
`--track-0` all along. A token whose name contradicts its value is worse than
no token; use `--track-0` when you mean zero.

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
- **Focus:** `--focus-outline` — a 2px solid action ring at a 2px offset
  (WCAG 1.4.11), drawn with `outline`, **not** `box-shadow`. A box-shadow ring
  is painted inside the nearest `overflow: hidden` ancestor and gets sliced
  off by it; this app is built out of scrollers, drawers, and clipped rows.
  `outline` is also the one ring property forced-colors mode preserves.
  Destructive controls take `--focus-outline-danger`, which differs by
  **shape** (dashed) rather than colour — `--err` and `--action` resolve to
  the same value in both registers, so a colour-only danger ring was
  pixel-identical to the normal one and communicated nothing.
- **Measure:** the reading-column cap, in `ch` so the column tracks the font
  rather than the layout — `--measure-tight` 34 (captions, empty-state lines),
  `--measure` 48 (the default: descriptions, summaries, side copy),
  `--measure-wide` 72 (long-form agent prose). Anything narrower than
  `--measure-tight` is a layout width, not a measure: give it px and a reason.
- **Z layers:** three tiers, all with consumers — `--z-drawer` 30 ·
  `--z-float` 120 · `--z-dialog` 300. There is deliberately no `popover` tier
  below `drawer`: the old scale had one and it was unusable by construction, a
  select opened inside a drawer rendered behind it. Anchored chrome always
  floats above the surface it opened from, so it belongs at `--z-float`. Bare
  `z-index: 1/2/3` in component CSS is correct — those order siblings inside
  an already-positioned component and must not be promoted to tokens.
- **Motion:** `--ease` `cubic-bezier(0.2, 0, 0, 1)`; `--t-fast` 120ms for
  interaction feedback, `--t-slow` 280ms for entrances. No spring, no
  overshoot. 280 rather than 320 because past ~300ms an entrance stops reading
  as responsive and starts reading as a wait, and this is an operator tool
  where the same panes open dozens of times an hour.
- **Ambient loops:** `--t-pulse` 1.6s for active work (streaming agent,
  running task, busy header) and `--t-pulse-calm` 2.6s for passive presence
  (online dot, idle node) — the same liveness reads at the same tempo
  everywhere. `--t-tick` 1s is the third, mechanical cadence: a spinner
  rotating, a caret blinking. Not a pulse (those breathe to say "an agent is
  working"); a metronome saying "this element is still alive". Never hand-pick
  a loop duration.
- **Other durations:** `--t-draw` 1.1s for content that renders itself over
  real time (a chart stroke arriving, a skeleton sweep) and `--t-stagger` 40ms
  as the base step for reveal ladders, multiplied at the call site
  (`calc(var(--t-stagger) * 3)`). Delays are expressed against `--t-stagger`,
  never as literals — `designGrid.test.ts` enforces it.
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
- Use `--action-soft` for selected rows and active navigation.
- Carry status as dots/borders/text on the grey brightness hierarchy
  (loud = bright, calm = dim); use `--info` (neutral ink) for status
  without alarm.
- Use `--live` only for work happening right now, and only where `--t-pulse`
  is used — see the scope rule under Colors.
- Pair `--live` with motion and text, never color alone.
- Apply the paired `--type-*-track` (or `--track-display`) at every
  display-role site.
- Use `--link` for anchors and `--measure*` for reading columns.
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
- Don't paint a focus ring as a `box-shadow` — it is an `outline` now, so it
  survives clipping ancestors and forced-colors mode.
- Don't hand-write a `ch` width for prose; reach for the `--measure*` tier.
- Don't add a size step within 2px of an existing one — separate by weight
  and colour instead.

## Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 72px | Collapsed left rail |
| `--sidenav-w-open` | 228px | Expanded left rail |
| `--thread-w` | 318px | Conversation list pane |
| `--header-h` | 64px | Chat panel top bar |

## Data visualization

Charts are greyscale — a brightness ramp, not a hue ramp. The admin
token-usage chart stacks a three-step ink ramp, dimmest at the base: output =
`--ink-2` (brightest — it is the product of the work), input = `--ink-3`,
cache = `--ink-4` (the bulk, but the least interesting). **No series may take
`--action`**: an action colour on a chart fill reads as "click me", and it
previously put the loudest mark on the page's least important series. Because
the ramp deliberately uses neighbouring ink steps, each segment carries a
`--surface-1` hairline stroke — adjacent steps of a monochrome ramp merge into
one flat band without it, so a boundary must be drawn rather than inferred.

Fleet-health bars double-encode: the grey ramp alone cannot separate five
values in an 8px bar (ready and unknown sit one step apart, failed and stale
both resolve to `--err`), so stale takes a `--warn` hatch. `--live` marks the
running node count and its bar segment — the first sanctioned use on an admin
surface, and the card's colour density is a utilisation readout: live-carrying
elements when work is in flight, none when idle.
