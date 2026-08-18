# Relay Design — Fieldnotes

<p align="center">
  <img src="../web/public/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

## Overview

Relay's visual language is **Fieldnotes**: an operator's field notebook,
rendered in software. It rests on one rule:

> **Relay is pencil on cream paper; the highlighter comes out for action and
> for work in flight — and for nothing else.**

A warm cream canvas, an olive ink ramp, status as a brightness hierarchy on
dot/border/text only, two registers designed side by side — and exactly one
saturated hue, highlighter yellow (`#f7a501`), shared by the primary action
and by work an agent is doing *right now*. The system adapts the source
analysis in `DESIGN.md` (cream canvas, olive ink, IBM Plex Sans, one yellow
CTA) into a dual-register application identity. It supersedes the Phosphor
identity (true-neutral monochrome + green `--live`); the migration rationale
lives in `docs/superpowers/specs/2026-08-18-fieldnotes-identity-design.md`.

- **One action color.** `--action` is highlighter yellow (`#f7a501`) and it
  is **register-invariant** — the same hex on the cream page and on the dark
  olive cover. Text on the fill is always the deep olive ink (`--on-action`
  `#23251d`, 7.6:1 on the yellow). The yellow pill carries every primary
  action: brand-adjacent CTAs, primary buttons, selection. There is no
  disabled hex — disabled is opacity. Links are **not** `--action`: they take
  `--link`, the system's second sanctioned hue (link blue), reserved for
  wayfinding — anchors in prose and the focus ring.
- **Status is dot / border / text — never fills.** `--ok` `--warn` `--err`
  are an olive brightness hierarchy — loud = bright (`--err` = `--ink-1`),
  calm = dim (`--ok` dimmest) — holding exactly one value per register each.
  **Every tone clears AA as small text** against the worst plane it can land
  on. `--info` is not a separate value: it aliases `--ink-3`. Green is gone
  from the system: "passed/ready" is calm olive, not a hue.
- **Every ink tier that can carry text clears 4.5:1.** The bar is the worst
  plane a tier can land on — `--surface-3` in dark, `--surface-2` in light —
  because meta text sits on drawers and inset wells too. This is why the
  light ramp's calm end (`--ink-3` `#5f6056`, `--ink-4` `#63645a`) is deeper
  than the source system's marketing-page values (`#6c6e63`, `#9b9c92`
  measure 4.16 and 2.23 against the recessed fill): app chrome carries real
  content at those tiers, not decoration. See the ratio table under Colors.
- **Dual-first registers.** The light register is the cream page
  (`#eeefe9` — never pure white); the dark register is the notebook's cover,
  a deep olive-charcoal (`#1f211a`) that the same ink becomes when it carries
  a whole surface. Neither is derived from the other; both live side by side
  in `palette.css`. Dark is the default register (`:root`);
  `html[data-theme="light"]` overrides it.
- **One hue, two jobs — the channel separates them.** Yellow fills a pill:
  that is an action. Yellow pulses on a dot, a ring, or an elapsed timer:
  that is `--live`, work happening right now. `--live` is the yellow *family*
  rather than the CTA hex itself — brighter on dark (`#ffc233`), deepened to
  gold on light (`#8a5f06`, the lightest yellow-family value that still
  clears AA as small text on cream). Because idle surfaces hold no yellow at
  all, a screen's yellow density still reads as a utilization gauge from
  across the room — the same trick Phosphor played with green, now folded
  into the single hue the source system allows.
- **One sans, every job.** IBM Plex Sans Variable carries reading, control,
  and display text; hierarchy is built from **weight** (400/500/600/700) and
  tracking, not face. The display tier is 700 with −0.025em tracking; body
  text is set solid at 400. JetBrains Mono survives for technical text only —
  IDs, logs, code — set 400 untracked. (DESIGN.md names JetBrains Mono a
  near-perfect substitute for Source Code Pro at body sizes, and the
  vendored variable file was already shipped.)
- **Tight geometry, hairline depth.** 4px chips, 6px controls and cards, 8px
  sheets — the source system's 4/6/8 vocabulary; the old 10/14px top rungs
  are gone. Structure comes from 1px hairlines; the two shadow tokens are
  reserved for floating chrome.
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
2. **`roles.css`** — the composites: twelve `--type-*` roles and their paired
   `--type-*-track` tokens, `--shadow-1` / `--shadow-2`, the focus contract
   (`--focus-outline` / `--focus-outline-danger` / `--focus-w` /
   `--focus-offset`), `--link` / `--link-hover`, and the `--info` alias.
3. **`shadcn-bridge.css`** — the `@theme inline` block and
   `--background` / `--primary` / etc. aliases that shadcn/ui and Tailwind
   utilities consume. Utility names (`text-ink`, `border-hairline`,
   `rounded-md`, `text-sm`) stay stable so component markup never tracks
   token renames. Note shadcn's own `--accent` / `--ring` names are its
   aliases (hover surface / outline color), which is why the action family
   is named `--action`, not `--accent`. `--ring` points at `--link`, not
   `--action`: the yellow action fill measures 1.7:1 on cream, under the 3:1
   floor for focus indicators, so focus rings are link blue.

   The file has two halves with different rules. The **additive** colour
   aliases exist only if a component asks for them — Tailwind ships no default
   for `text-ink`, so an unused entry is dead and gets deleted. The **scale
   guards** (`--radius-*`, `--text-*`, `--spacing`) override stock Tailwind
   scales, so they are kept complete whether or not each step is used:
   deleting `--radius-xl` does not remove `rounded-xl`, it hands it back to
   Tailwind's 12px default, off the 4/6/8 ramp. There is deliberately no
   named spacing scale — `p-sm` and `p-3` were the same 12px reached two ways,
   and the numeric scale is the one that maps 1:1 onto `--sp-N`.
4. **`base.css`** — html/body reset, the `:focus-visible` contract, and the
   shared utilities (`.tnum`, `.code`, `.eyebrow`, `.tone-*`).

   `.tnum` and `.code` are deliberately two names, not one. `.tnum` gives
   tabular figures in the reading face — counts, timestamps, ratios, sizes.
   `.code` gives the mono face to literal strings the operator could type,
   paste, or diff — node ids, `@handles`, emails, workspace paths,
   credentials. Because `.code` sets `font-family` alone, a companion rule
   using the `font` shorthand resets it; those sites carry an explicit
   `.<class>.code` override.

**Naming rule:** component CSS only ever references a palette token
(`--surface-*`, `--ink-*`, `--line-*`, `--action*`, `--ok/--warn/--err/--info`,
`--live`, `--link-blue*`, `--r-*`, `--sp-*`, `--measure*`, `--fs-*`,
`--track-*`, `--font-*`, `--z-*`, `--t-*`, `--ease`) or a role (`--type-*`,
`--shadow-*`, `--focus-*`, `--link*`) — never a literal hex/`rgb()`/`hsl()`.

**No exceptions.** `web/.stylelintrc.json` grants exactly one file-level
override — `palette.css`, which originates colour by definition. Every other
stylesheet consumes tokens outright. `login.css`, `preferences.css`, and
`artifact.css` are **not**
exceptions — they consume the pinned `--dark-*` / `--light-*` / `--paper`
tokens, which is exactly why those tokens exist.

## Colors

Dark register / light register:

| Token | Dark | Light | Role |
|---|---|---|---|
| `--surface-0` | `#1f211a` | `#eeefe9` | canvas (olive-charcoal / cream) |
| `--surface-1` | `#262820` | `#fcfcfa` | cards, panels |
| `--surface-2` | `#2d2f27` | `#e5e7e0` | fills, search, hover |
| `--surface-3` | `#34362b` | `#ffffff` | drawers, modals |
| `--ink-1` | `#f1f1e8` | `#23251d` | headings, emphasis |
| `--ink-2` | `#d0d1c2` | `#4d4f46` | body |
| `--ink-3` | `#a8a999` | `#5f6056` | secondary labels |
| `--ink-4` | `#9e9f8f` | `#63645a` | timestamps, meta, disabled |
| `--line-1` | `#3b3d32` | `#bfc1b7` | structural hairline |
| `--line-2` | `#2b2d24` | `#dcdfd2` | soft hairline |
| `--action` | `#f7a501` | `#f7a501` | actions, selection, brand — register-invariant |
| `--action-hover` | `#ffb61a` | `#dd9001` | hover / active |
| `--action-soft` | 24% yellow wash | 16% yellow wash | selection wash, active nav |
| `--on-action` | `#23251d` | `#23251d` | text on the action fill |
| `--link` / `--link-hover` | `#8ab0f5` / `#b9ccf7` | `#1d4ed8` / `#1740ae` | anchors in prose, focus ring |
| `--ok` | `#a0a192` | `#616257` | ready, passed, done — calm (dim) |
| `--warn` | `#c6c7b8` | `#55564d` | attention, degraded |
| `--err` | `#f1f1e8` | `#23251d` | failed, destructive — loud (= ink-1) |
| `--info` | = `--ink-3` | = `--ink-3` | neutral notice |
| `--live` | `#ffc233` | `#8a5f06` | an agent is working *right now* |
| `--scrim` | `rgba(0,0,0,.66)` | `rgba(35,37,29,.55)` | overlay scrim (one layer) |

### The surface ladder runs both ways

In **dark** the ladder is elevation: 0 < 1 < 3 in perceived lift, with 2 as
the fill tier between card and drawer. **Light cannot reproduce that**,
because white is a ceiling you cannot build above — so 0..3 there is a ladder
of *distinctness*: cream canvas `#eeefe9` → warm-white cards `#fcfcfa`
(raised) → drawers/modals `#ffffff` (top plane), with `--surface-2`
deliberately **recessed** below the canvas. A search field or hover well
recedes from white and emerges from black; that inversion is correct, and only
`--surface-2` does it. The cream canvas is the identity's most distinctive
surface choice — never substitute pure white for it, and never paint a
section band over it; the page is one continuous sheet.

### Contrast floors

Every tier that can carry text clears WCAG 1.4.3 against **the worst plane it
can land on**, not against the canvas. Ratios against that plane:

| | ink-1 | ink-2 | ink-3 | ink-4 | ok | warn | err |
|---|---|---|---|---|---|---|---|
| dark (vs `--surface-3`) | 10.82 | 7.95 | 5.15 | 4.57 | 4.69 | 7.18 | 10.82 |
| light (vs `--surface-2`) | 12.44 | 6.68 | 5.11 | 4.81 | 4.96 | 5.96 | 12.44 |

`paletteTokens.test.ts` computes these from the declared hexes rather than
pinning the hexes themselves, so a future palette move is checked for
*legibility* rather than for matching a list. The light steps are tighter than
dark and that is structural: white bounds the light ramp at one end and the
AA floor at the other.

`--action-soft` is not a hex: it is `color-mix(in srgb, #f7a501 24%, transparent)`
on dark and 16% on light, so the selection wash always tracks the action
color. Note the deliberate collision in both registers: `--err == --ink-1`,
so error text is pixel-identical to heading text and error states lean on
icon and shape (the hollow `dot-ring`) — inherent to the loud = bright/dark
hierarchy, do not "fix" it by tinting.

A **pinned group** (`--dark-canvas`, `--dark-surface`, `--dark-elevated`,
`--dark-ink`, `--dark-ink-strong`, `--dark-body`, `--dark-ink-soft`,
`--dark-line`, `--dark-line-soft`, plus `--light-canvas`, `--light-ink`)
mirrors the registers for chrome that must *not* follow the active theme: the
pre-auth login ramp, the theme-picker swatches that show both registers at
once, the diff viewer, ink-fill buttons. A test asserts each pinned token
equals its live counterpart — the pins silently drifted once already, which
is the failure they exist to prevent.

Artifact chips are **monochrome olive** — kind is carried by the icon and the
mono kind label, not by hue.

### The yellow scope rule

Yellow carries two jobs, and the channel — not the hue — tells them apart:

| filled pill (`--action`) | pulsing dot / ring / timer (`--live`) |
|---|---|
| primary CTA, subscribe, save | composer running indicator |
| selection wash, active nav | task + backlog running rows |
| brand mark accent in app icons | agent stream activity, busy header |
| | thread pulse, streaming rail node |
| | status pill on a running agent/node (TonePill `live`) |

**`--live` is legal exactly where `--t-pulse` is used, and nowhere
`--t-pulse-calm` is used.** Passive presence (online dot, idle node, login
readiness) stays olive. A static yellow surface never means "running", and a
pulsing olive surface never exists.

"One hue" is a claim about **meaning**, not pigment. The carve-outs, all
deliberate — a reader who takes the rule literally will file them as bugs:

- **Link blue is the second sanctioned hue**, and it is wayfinding, not
  decoration: anchors in prose (`--link`) and the focus ring
  (`--focus-outline`). It is never a fill, a status, or an action.
- **App icons carry the yellow.** `favicon.svg` and `relay-mark.svg` use
  `#f7a501` on their lead chevron. A tab-strip icon is not reporting a run,
  but at 16px an olive chevron on an olive square is invisible. The bare
  wordmark stays olive.
- **Identity marks are neutral.** Agents and teams render as neutral class
  glyphs (`IdentityMark.tsx`) — no procedural per-name hues. Identity is
  carried by glyph shape, never *what is happening*.
- **Login is the cover, not a page.** Pre-auth runs on the pinned dark-olive
  ramp because no theme has loaded; its primary CTA already takes the
  register-invariant yellow like every other primary action.

Any **further** source of colour is a bug.

Because every `--live` surface also pulses and is accompanied by an elapsed
timer and status copy, color is never the sole channel (WCAG 1.4.1). Motion is
part of that encoding, so `prefers-reduced-motion` needs checking whenever a
liveness surface changes.

## Typography

**IBM Plex Sans Variable** carries every role — `--font-sans` and
`--font-display` are the same family, and the display tier is a weight and
tracking decision, not a face decision. **JetBrains Mono** (`--font-mono`)
carries technical text only. Twelve roles.

The display face is chosen by **content origin, not by size**: a fixed UI noun
(Threads, Backlog, the wordmark, a drawer title) takes the display tier
(700, tight-tracked), while a string written by a person or an agent takes
its calmer content sibling. A 60-character thread name set at the display
weight reads as a headline shouting someone's words.

| Role | Spec | Paired track | Use |
|---|---|---|---|
| `--type-display` | 700 36/1.5 | `--track-0` | hero headline, admin metric values |
| `--type-title` | 700 24/1.33 | `--track-display` | page titles and other fixed UI nouns |
| `--type-heading` | 700 18/1.5 | `--track-0` | section heads, list labels, in-message h1 |
| `--type-title-content` | 600 20/1.4 | `--track-body` | titles whose text comes from a user or agent |
| `--type-body` | 400 16/1.5 | `--track-body` | prose, message bodies, inputs |
| `--type-name` | 600 16/1.5 | `--track-body-sm` | the identity of the thing a row or card is about |
| `--type-body-sm` | 400 15/1.5 | `--track-body-sm` | dense prose, captions |
| `--type-label` | 500 13/1.5 | `--track-body-sm` | chrome labels, nav, metadata |
| `--type-label-strong` | 600 13/1.5 | `--track-body-sm` | bold chrome, button labels |
| `--type-micro` | 600 12/1.33 | `--track-caps` | structural group labels (+ uppercase), badges, compact metadata |
| `--type-number` | 700 24/1.33 | `--track-display` | metrics |
| `--type-code` | 400 14/1.43 | `--track-0` | commands, logs, IDs |

**Every role ships a paired `--type-<role>-track`.** The `font:` shorthand
cannot carry `letter-spacing`, so a role applied as `font: var(--type-title)`
silently loses its tracking unless the call site remembers a second
declaration — pairing the tokens by name makes the omission greppable, and
`typographyTokens.test.ts` sweeps every stylesheet for it. Several paired
tracks resolve to 0 **by design**: the source system sets only its 24px
display tier tight (−0.6px ≈ −0.025em) and everything else solid. The tokens
stay explicit so a role's tracking is decided in `roles.css`, once.

**There is no 800.** DESIGN.md's display tier calls for weight 800, but IBM
Plex Sans Variable tops out at 700 and `base.css` disables font synthesis —
an 800 declaration would silently render as 700, so the roles say 700 and let
size and tracking carry the tier.

The size ladder is **12 / 13 / 15 / 16 / 18 / 20 / 24 / 36** (`--fs-1`,
`--fs-2`, `--fs-3`, `--fs-4`, `--fs-heading`, `--fs-title`, `--fs-5`,
`--fs-6`, all rem; root pinned to 87.5% so 1rem = 14px at the default). It is
the source system's scale with its 1px-apart pairs collapsed — heading-md
(20) absorbs heading-lg (21) — because steps a single pixel apart cost a
token and buy no visible hierarchy. The code role sits at 14px *outside* the
ladder: the mono face sizes to its own metrics, and 14 is the source
system's code-sm. The root font-size is pinned to 87.5% so the browser's
font-size preference scales the whole UI (WCAG 1.4.4).

**`--track-display` must be applied to every display-tier rule** — via the
role's paired track token or directly. Display-tier means *two* shapes, and
both are swept by the test:

1. rules using a `--type-display` / `title` / `heading` / `number` role, and
2. rules that opt into `font-family: var(--font-display)` by hand.

A second `letter-spacing` in the same rule silently overrides the first, so
the sweep requires exactly one correct declaration per display-tier rule.
The one deliberate exclusion is `.relay-bleed-mark`, a single decorative
glyph with no inter-character spacing to track.

**CJK:** `html:lang(zh-CN)` / `html:lang(zh-TW)` put a system CJK family first
for both Latin and Han glyphs, keeping mixed-script labels internally
coherent. IBM Plex Sans has no Han coverage, so every role joins that same
sans stack — and `--track-display` is pinned to 0 there, or Han titles would
be crushed together. Reading leading loosens (1.7/1.8/1.9).

The vendored WOFF2 files are fontsource's **latin** subsets
(`@fontsource-variable/ibm-plex-sans` 5.3.0, OFL-1.1, wght 100–700;
`@fontsource-variable/jetbrains-mono` 5.3.0, OFL-1.1, wght 100–800). Latin
covers U+00C0–00FF, so accented names render in-face; latin-ext glyphs fall
through to the system sans by design rather than shipping a second file.

## Geometry, elevation, motion

- **Radii:** `--r-1` 4px (chips, tags) · `--r-2` 6px (buttons, inputs, all
  controls) · `--r-3` 6px (cards, drawers, modals) · `--r-4` 8px (hero
  plates, sheets) · `--r-full` (dots, avatars, pills). The source system's
  vocabulary clusters at 4–6px and never rounds past 8px outside pills; the
  old 10/14px rungs are retired.
- **Spacing:** 4px base — `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4`
  16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-7` 32 · `--sp-8` 48 · `--sp-9` 64.
  Below the base sit exactly two micro steps, `--sp-0-5` 2 and `--sp-1-5` 6,
  for glyph-tight pairs (dot ↔ label, icon ↔ text, stacked meta lines). They
  are the only sanctioned sub-4px gaps. `--sp-row` (12px, compact 8px via
  `[data-density="compact"]`) sets row rhythm; `--control-h` (40px) is the
  standard control height.
- **Density:** `[data-density="compact"]` drops the reading tier one rung
  (`--fs-4` 16 → 15px) for genuinely dense surfaces (tables and list
  layouts). Put the attribute on the dense container, not the page. It
  overrides `--fs-4` **and restates every role built on it** (`--type-body`,
  `--type-name`), because a custom property resolves `var()` where it is
  *declared*, not where it inherits. Add a restatement whenever a new role
  uses `--fs-4`.
- **Elevation:** the system is flat — planes separate by hairline, not lift.
  `--shadow-1` is `none`; `--shadow-2` resolves to a single 1px ring so
  borderless floating chrome (drawers, dialogs, composer, tooltips) keeps a
  crisp edge without faux depth.
- **Focus:** `--focus-outline` — a 2px solid **link-blue** ring at a 2px
  offset (WCAG 1.4.11), drawn with `outline`, **not** `box-shadow`, so no
  ancestor's `overflow: hidden` can clip it and forced-colors mode preserves
  it. The ring cannot be the action yellow: `#f7a501` measures 1.7:1 on
  cream, far under the 3:1 indicator floor. Destructive controls take
  `--focus-outline-danger`, which differs by **shape** (dashed) rather than
  colour — `--err` and `--ink-1` resolve to the same value in both
  registers, so a colour-only danger ring would communicate nothing.
- **Measure:** the reading-column cap, in `ch` — `--measure-tight` 34
  (captions, empty-state lines), `--measure` 48 (the default),
  `--measure-wide` 72 (long-form agent prose). Anything narrower is a layout
  width, not a measure: give it px and a reason.
- **Z layers:** three tiers, all with consumers — `--z-drawer` 30 ·
  `--z-float` 120 · `--z-dialog` 300. There is deliberately no `popover` tier
  below `drawer`. Bare `z-index: 1/2/3` in component CSS orders siblings
  inside an already-positioned component and must not be promoted to tokens.
- **Motion:** `--ease` `cubic-bezier(0.2, 0, 0, 1)`; `--t-fast` 120ms,
  `--t-slow` 280ms. No spring, no overshoot.
- **Ambient loops:** `--t-pulse` 1.6s for active work (streaming agent,
  running task, busy header) and `--t-pulse-calm` 2.6s for passive presence
  (online dot, idle node) — the same liveness reads at the same tempo
  everywhere. `--t-tick` 1s is the mechanical cadence: a spinner rotating, a
  caret blinking. Never hand-pick a loop duration.
- **Other durations:** `--t-draw` 1.1s for content that renders itself over
  real time; `--t-stagger` 40ms as the base step for reveal ladders,
  multiplied at the call site. Delays are expressed against `--t-stagger`,
  never as literals — `designGrid.test.ts` enforces it.
- **Entrances:** one shared `rise` keyframe (`tokens/base.css`) — fade plus
  a translateY read from `--rise-from`. Two travel tiers: `--rise-sm` 4px
  for rows inside a scroller, `--rise` 8px (the default) for panes and
  views.

## Marginalia

The source system's entire decorative layer is hand-drawn mascot marginalia
scattered across the page. Relay's equivalent is the **field-notes doodle**:
the double-chevron mark sketched in the margin — pencil-weight olive linework
(`--ink-3`/`--ink-4` strokes), dashed construction lines, annotation ticks —
shipped as inline SVG components in `web/src/components/marginalia.tsx` and
anchored in empty states. The rules:

- **Olive ink only.** Marginalia never takes the yellow (action/live), never
  takes a status tone, never fills — strokes alone.
- **Never animate them.** They are set dressing in an operator tool;
  `prefers-reduced-motion` is trivially satisfied because there is no motion.
- **Absolutely positioned**, so a doodle never perturbs the layout it
  decorates, and hidden below the 820px mobile tier.
- One doodle per surface. A second one on the same screen is clutter, not
  charm.

## Do's and Don'ts

### Do
- Use `--action` for actions, and use it scarcely: primary CTA, selection,
  the brand mark. One yellow pill per fold is plenty.
- Pair the action fill with `--on-action` — deep olive ink on the yellow, in
  both registers.
- Use `--action-soft` for selected rows and active navigation.
- Carry status as dots/borders/text on the olive brightness hierarchy
  (loud = bright on dark, loud = dark on light); use `--info` for status
  without alarm.
- Use `--live` only for work happening right now, and only where `--t-pulse`
  is used — see the scope rule under Colors.
- Pair `--live` with motion and text, never color alone.
- Use `--link` for anchors and the focus ring; `--measure*` for reading
  columns.
- Apply the paired `--type-*-track` (or `--track-display`) at every
  display-role site, even where the paired track is 0 — the declaration is
  the contract.
- Disable with opacity, not a dedicated hex.
- Carry depth with hairlines first; shadows only on floating chrome.
- Add new raw values to `palette.css` and new roles to `roles.css` — never
  inline a color in a component file (`npm run lint:css -w web` enforces).

### Don't
- Don't use a status color as an action, or the action color as a status.
- Don't introduce a third chromatic color. Yellow is action/live, blue is
  wayfinding; everywhere else brightness is the only signal.
- Don't reintroduce green for "passed" or "healthy" — a finished task is
  calm olive. `--live` means *running*, not *done*.
- Don't set text or dots in the raw `#f7a501` on the light canvas — it
  measures 1.7:1 on cream. On light, yellow-family text/dots use `--live`'s
  deep gold; the raw yellow is fill-only there.
- Don't paint the canvas pure white or add shaded section bands — the cream
  sheet runs uninterrupted.
- Don't fill backgrounds with status colors.
- Don't tint agent avatars with vendor brand colors — glyph shape carries
  identity.
- Don't add overshoot or extra easing curves — there is exactly one ease.
- Don't color artifact chips by kind — olive, icon + label only.
- Don't paint a focus ring as a `box-shadow` — it is an `outline`, so it
  survives clipping ancestors and forced-colors mode.
- Don't hand-write a `ch` width for prose; reach for the `--measure*` tier.
- Don't add a size step within 2px of an existing one — separate by weight
  instead.
- Don't declare `font-weight: 800` — Plex tops out at 700 and synthesis is
  disabled; the declaration would be a lie.

## Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 72px | Collapsed left rail |
| `--sidenav-w-open` | 228px | Expanded left rail |
| `--thread-w` | 318px | Conversation list pane |
| `--header-h` | 64px | Chat panel top bar |

## Data visualization

Charts are olive-grey — a brightness ramp, not a hue ramp. The admin
token-usage chart stacks a three-step ink ramp, dimmest at the base: output =
`--ink-2` (brightest — it is the product of the work), input = `--ink-3`,
cache = `--ink-4` (the bulk, but the least interesting). **No series may take
`--action`**: a yellow chart fill reads as "click me". Because the ramp
deliberately uses neighbouring ink steps, each segment carries a
`--surface-1` hairline stroke — adjacent steps of a monochrome ramp merge
into one flat band without it.

Fleet-health bars double-encode: the grey ramp alone cannot separate five
values in an 8px bar (ready and unknown sit one step apart, failed and stale
both resolve to `--err`), so stale takes a `--warn` hatch. `--live` marks the
running node count and its bar segment — the card's yellow density is a
utilisation readout: live-carrying elements when work is in flight, none when
idle.
