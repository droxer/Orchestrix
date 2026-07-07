# Linear-ward Primary Color & Restraint — Design Spec

**Date:** 2026-07-07
**Status:** Approved (pending spec review)
**Scope:** Web UI design tokens only (`web/src/styles/`). No component-logic changes.

## Goal

Rebrand the single action color from deep teal to **Deep Cobalt**, and apply
**Linear's color discipline**: the brand hue marks *action, selection, and focus
only* — everything else is neutral ink, warm hairlines, and cool-slate status.

This adopts Linear's *approach* to color (one restrained cool accent, hue =
action, status independent), not Linear's literal indigo — the identity stays
ours.

## Context

- Colors are defined in one place: `web/src/styles/tokens.css` (three tiers —
  primitives, semantic aliases, shadcn bridge — across four themes: light,
  dark, high-contrast light, high-contrast dark).
- The brand hue threads through `--color-primary` (+ `-active`, `-disabled`),
  `--color-on-primary`, `--color-brand-soft`, `--color-info`, `--ring-focus`,
  and `::selection`.
- Structural design tokens (radii, motion, density, type scale, flattened
  grain/shadows) were already retuned Linear-ward in a prior pass and are **out
  of scope** here.
- Two component files hardcode the brand hex (theme-preview swatches in
  `preferences.css`); everything else references `var(--color-*)`.

## The core problem this fixes

`--color-info` currently **aliases `--color-primary`**. When the brand was teal,
this avoided introducing a competing second blue. Now that the brand *is* blue,
the alias makes ~20 **status/decorative** spots paint in the exact action color
— backlog `assigned`/`review` lanes, admin node/dashboard tones, avatar and
system-label dots, chat and dialog info accents, the thread live-pulse. The
accent reads as *status everywhere*, which defeats "the accent means action."

**Fix:** decouple `--color-info` into its own neutral cool-slate tone. The
`.tone-info` driver and all consumers follow automatically — no per-component
edits.

## Design

### 1. Deep Cobalt ramp (`tokens.css`, all four themes)

Follows the existing philosophy: light = deep fill + white text; dark = bright
fill + deep-navy text. All values clear WCAG AA (light ~6.5:1; contrast themes
~8–9:1).

| Token | Light | Dark | Contrast | Contrast-dark |
|---|---|---|---|---|
| `--color-primary` | `#3B5BDB` | `#7089FF` | `#1E3A8A` | `#8AA5FF` |
| `--color-primary-active` | `#2F4BC4` | `#8FA3FF` | `#16306E` | `#B3C7FF` |
| `--color-primary-disabled` | `#C1CBF0` | `color-mix(#7089FF 68%, surface-dark)` | `#A6B3E0` | `#2C3A70` |
| `--color-on-primary` | `#FFFFFF` (unchanged) | `#08112E` | `#FFFFFF` (unchanged) | `#000000` (unchanged) |
| `--color-brand-soft` | auto (mix 8%) | auto (mix 14%) | `#E5EAFB` | `rgba(138,165,255,.18)` |

`--color-brand-soft` stays derived from `--color-primary` in light/dark, so
selection tints follow automatically.

### 2. `--color-info` decoupled to a neutral cool slate

Stop aliasing `--color-primary`; give info its own tone per theme. Cool
blue-grey, clearly not the action hue, text-safe (AA) because several consumers
render it as text (`.tone-info` color, dashboard stats, chat).

| Token | Light | Dark | Contrast | Contrast-dark |
|---|---|---|---|---|
| `--color-info` | `#5B6779` | `#8C98AC` | `#2F3846` | `#C8D2E0` |

Auto-following consumers (no edits): `.tone-info` driver; `backlog.css`
`assigned`/`review` lane/row/status accents; `admin-v2-*` node/rail/dashboard/
pulse tones; `inputs.css` avatar `tone-info`; `agent-stream.css` system-label
dot; `thread.css` live pulse; `chat.css`; `dialog.css` info border.

### 3. Hardcoded swatches (`preferences.css`)

Theme-preview swatches hardcode the brand hex — update to cobalt:

- `.pref-theme-swatch[data-tone="light"]::after` → `#3B5BDB`
- `.pref-theme-swatch[data-tone="dark"]::after` → `#7089FF`
- `.pref-theme-swatch[data-tone="system"]::after` gradient → `#3B5BDB` / `#7089FF`

### 4. Doc-comment honesty (`tokens.css`)

Note: the working tree currently holds an interim **Iris Blue** draft
(`#4C6EF5`) from a prior quick pick; this spec supersedes it with Deep Cobalt.
Any "iris"/"periwinkle" wording introduced by that draft must be reconciled.

- File header "Visual language" paragraph: name the action color **cobalt blue**
  (replacing both the old "deep teal" and the interim "iris blue"); update the
  "info folds into the brand" line to state **info is a neutral cool slate,
  decoupled** so the brand hue marks action/selection/focus only.
- The `--color-info` definition comment: note it is a standalone slate status
  tone, no longer an alias of the action color.

## The restraint contract (acceptance criteria)

After this change, the cobalt brand hue appears **only** in:

1. **Action** — the one primary button/CTA per view (`--color-primary` fills).
2. **Selection** — selected rows/nav/running pills (`--color-brand-soft`,
   selected bars), and `::selection`.
3. **Focus** — `--ring-focus`.

Everywhere else: neutral ink text, warm hairlines, and **cool-slate** status
indicators. No status/decorative element paints in the action hue.

## Out of scope (YAGNI)

- Redesigning workflow-state status colors into a full Linear-style state
  palette (backlog/todo/in-progress/done). `assigned`/`review` simply go
  cool-slate here.
- Any change to green/amber/red status semantics, artifact "kind" decorative
  accents, or structural tokens (radii, motion, type, density, shadows).
- Component logic / TSX. Charts and marks already read `var(--color-primary)`.

## Verification plan

1. `grep` confirms **zero** residual non-cobalt brand hexes in
   `web/src/styles/` — both the original teal (`#115e59`, `#2dd4bf`, …) and the
   interim iris (`#4C6EF5`, `#7C9BFF`, …) drafts are gone.
2. `grep` confirms `--color-info` no longer resolves to `--color-primary` in any
   of the four theme blocks.
3. Dev server (`localhost:3000`) returns HTTP 200 with no CSS errors after HMR.
4. Manual visual check across the four themes: primary CTA, a selected row, a
   focus ring (all cobalt) vs. an `assigned`/`review` lane and an info dot (all
   slate).
5. Spot-check AA contrast for `on-primary` fills and `--color-info`-as-text.

## Risk / reversibility

Token-level only; every value lives in `tokens.css` (plus 3 swatch lines in
`preferences.css`). Fully reversible by restoring the prior hexes. No structural
or logic risk.
