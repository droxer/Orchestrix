# Relay Web Identity Evolution — "Warm Precision"

_Date: 2026-07-05 · Scope: `web/` frontend visual identity · Status: approved design, pending implementation plan._

## Motivation

The current design language (precision/technical, Linear/Vercel lineage — white canvas, cobalt action, Geist/Geist Mono) is well-governed but was judged: too generic/samey, too cold/sterile, too dense/operational, and not premium enough. Direction chosen through visual comparison: **evolve, don't redesign** — keep the disciplined system (three-tier tokens, mono metadata signal, status-only hues, restrained motion) and shift the temperature.

Decisions locked during brainstorming (visual companion session, mockups in `.superpowers/brainstorm/88374-1783183387/content/`):

| Decision | Choice |
|---|---|
| Direction | Warm precision (vs. warm editorial, atelier dark-first) |
| Action color | Deep teal (vs. terracotta, deep indigo, forest olive) |
| Typography | Instrument Sans + Geist Mono retained (vs. keep Geist, Space Grotesk display, IBM Plex) |
| Density | Relaxed — one step up (vs. keep compact, airy) |

## 1. Concept

One identity across temperature: warm neutrals, deep teal as the single action color, humanist sans with the mono signal preserved, calmer default rhythm, softened-one-step geometry, and the existing grain/atmosphere texture warmed and extended to two more signature moments. The three-tier token architecture in `web/src/styles/tokens.css` means the change lands overwhelmingly as a **primitives swap**, not component rewrites.

## 2. Color

### Light theme (primitives)

- **Canvas & surfaces** — white/zinc → warm ecru/stone:
  - `--color-canvas: #fdfcfa`
  - `--color-surface-soft: #faf8f4`
  - `--color-surface-strong: #f5f2ec`
  - `--color-surface-card` / `--color-surface-raised`: track canvas (`#fdfcfa`)
  - `--color-hairline: #eae5dd`, `--color-hairline-soft: #f1ede6`
- **Text** — zinc → warmed stone ramp:
  - `--color-ink: #171412`
  - `--color-body: #57534e`, `--color-muted: #79716b`, `--color-muted-soft: #a8a29e`
- **Action** — cobalt → deep teal:
  - `--color-primary: #115e59` (buttons, fills)
  - `--color-primary-active: #0f766e` — also the link/active-text value
  - `--color-primary-disabled` and `--color-brand-soft`: re-derived from the teal via the existing `color-mix` recipes
- **Status** — hues stay green/amber/red; success re-tuned away from the teal action:
  - `--color-semantic-up: #15803d` (grass green, clearly distinct from teal at small sizes)
  - `--color-semantic-down`, `--color-accent-yellow`: unchanged
  - `--color-info` keeps folding into the brand (now teal)
  - Status-as-text ramps (`--color-warning-text`, `--color-danger-text`) recomputed against the ecru canvas; add a `--color-success-text` if the new green fails as small text
- **Decorative artifact-kind accents**: keep the palette but re-check each against the warm canvas; `--color-kind-plan` (cyan) must stay distinguishable from the teal action — shift it toward blue if it collides.

### Dark theme

- Warm charcoal base **stays** (`#0d0c0a` / `#1a1815`) — it now matches the light theme's temperature instead of contrasting with it.
- Action lifts to a luminous teal the way cobalt lifted to periwinkle: `--color-primary: ~#2dd4bf` family, active step lighter, on-primary flips to near-black if contrast requires (verify; white on `#2dd4bf` fails WCAG).
- Status/artifact accents keep their existing dark-lift pattern, recomputed where the new success green needs it.

### High-contrast themes

- Structure unchanged. Substitute the teal family: light-contrast primary deepens (e.g. `#0f4c47` range), dark-contrast primary brightens (e.g. `#5eead4` range), both tuned to ≥7:1. Everything else (ink hairlines, no grain, kind-accents collapse to ink) stays.

## 3. Typography

- `--font-sans` → **Instrument Sans** (Google Fonts, variable), loaded via `next/font` in `app/layout.tsx` alongside the retained Geist Mono. Geist (sans) is removed from the bundle.
- **Geist Mono stays** as the identity signal: eyebrows, metadata, agent labels, tool lines, numbers, code. `--font-mono` and `--font-number` unchanged.
- `--font-display` keeps aliasing `--font-sans`.
- Tracking re-tuned for Instrument's wider letterforms: `--letter-display: -0.4px` (from −0.6px), `--letter-display-strong: -0.35px` (from −0.5px); body/caps/eyebrow tracking unchanged unless the screenshot pass shows drift.
- The `--type-*` role tokens keep their sizes/weights; only the family resolution changes.
- CJK: zh-CN/zh-TW stacks swap the leading Latin face from Geist to Instrument Sans; Noto Sans SC/TC fallbacks unchanged.

## 4. Geometry & density

### Radii — soften one step

- `--radius-sm: 6px` (4), `--radius-md: 8px` (6), `--radius-lg: 10px` (8), `--radius-xl: 12px` (10). `--radius-xs: 2px` and `--radius-full` unchanged. Pills stay retired.

### Relaxed rhythm (new default)

- Thread rows / list items: ~+4px vertical padding (e.g. `--space-xs` consumers step to `--space-sm` where they define row padding).
- Message bodies: line-height moves to `--leading-loose` (1.65); `--leading-loose` itself bumps 1.6 → 1.65.
- Panel/pane padding: steps from xs/sm to sm/base at the shell level.
- Implemented as **token-value changes plus a small number of component-CSS padding token swaps** — not a wholesale re-spacing.

### Density escape hatch

- A `data-density="compact"` attribute (set on data-dense surfaces: admin tables, backlog board) scopes a token override block in `tokens.css` restoring today's tighter paddings/leading for that subtree. One override block; no per-component forks.

## 5. Texture & signature moments

- The atmosphere system (grain + corner wash) stays; the wash tint warms from ink-grey toward a faint warm tone (the dark theme's `#e8dcc8` wash already points the way — light gets an equivalent warm cast).
- Extend the signature treatment (grain + "R" watermark + mono status readout, today only on login) to:
  1. the **transcript empty state**, and
  2. the **admin KPI hero**.
  These were already identified in `web/DESIGN_REVIEW.md` as the highest-leverage distinctiveness sites. No new decoration anywhere else.

## 6. Migration strategy

Ordered so each step is independently verifiable:

1. **Fonts** — `app/layout.tsx` next/font swap (Instrument Sans in, Geist sans out), tracking token retune.
2. **Light primitives** — canvas/surface/hairline/text/action/status swap in `:root`.
3. **Dark + contrast themes** — the four `html[data-theme=…]` blocks.
4. **Radii + density** — radius token bump, rhythm token changes, `data-density="compact"` block + attribute on admin tables and backlog board.
5. **Signature moments** — warm the atmosphere wash; extend to transcript empty + KPI hero.
6. **Screenshot pass** — 1440 / 1024 / 390 in light, dark, and high-contrast; update `web/DESIGN_REVIEW.md`.

Component CSS changes only where hardcoded assumptions survive (the 2026-07-05 token consistency pass eliminated most). Known hardcode to check: any remaining literal cobalt/zinc values, the `--color-info` fold, and chart gradient fills in the admin dashboard.

## 7. Verification

- **Contrast**: WCAG AA re-check on every new foreground/background pair — teal fills vs. `--color-on-primary`, teal links on ecru, all status-as-text ramps, dark-mode luminous teal (likely needs dark text on fills).
- **Build + tests**: `npm run build -w web` and the web test suite green after each migration step.
- **Live pass**: authenticated screenshots across login + gated surfaces (3-pane shell, backlog, routines, admin dashboard, drawers) in all three themes; fold findings into `DESIGN_REVIEW.md`.
- **Reduced motion / a11y**: no motion changes in this design; confirm the a11y.css safety nets still hold after the token swap.

## Out of scope

- The mobile app (separate brainstorm; it will inherit this language).
- Any layout/IA changes — panes, navigation, and components keep their structure.
- Motion system changes — curves and durations are untouched.
- TUI colors — the TUI palette is not part of this pass (artifact-kind parity is web-side only: keep hues recognizably close).
