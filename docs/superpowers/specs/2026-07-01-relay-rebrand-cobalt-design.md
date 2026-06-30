# Relay Rebrand — Cobalt (Technical & Trustworthy)

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan
**Scope:** Primary color + branding direction for the Relay web UI

---

## 1. Summary

Relay's web UI currently runs a **monochrome precision system** (Linear/Vercel/Resend
lineage): near-black ink `#0a0a0a` is the *only* action color, and all hue is reserved
for status. This rebrand introduces a **single brand hue** as the action color while
keeping the precision identity — Geist type, tight geometry, mono-as-signal, cool-neutral
zinc structure.

**The core shift:** from *monochrome-only-action* to *single-brand-hue action*.

The signature color is **Cobalt `#2f54eb`** — deep, saturated, infrastructure-grade,
and clearly distinct from the legacy `#3b82f6` info blue.

## 2. The new color contract

The current contract is documented at the top of `web/src/styles/tokens.css`:
*"near-black ink as the single ACTION color … Color is reserved exclusively for status
… and never used for actions."* This rebrand rewrites that contract:

- **Brand cobalt is the single action color.** Applied to: primary buttons, links,
  active nav rail item, focus ring, text selection, and the "running / in-progress"
  status. It also absorbs the neutral **"info"** role (see §3).
- **Status hues narrow to three:** green (success / ready), amber (attention /
  approval / warning), red (danger). **Blue leaves the status set.**
- **Artifact kind-accents** (cyan / amber / violet / magenta / blue) remain the one
  decorative exception, unchanged.
- **Structure stays neutral.** Canvas, ink, body, muted, hairlines keep the existing
  cool-neutral zinc ramp. Cobalt never bleeds into text or surfaces except as the
  `--color-brand-soft` tint for selected/active affordances.

## 3. The brand-vs-info resolution

The legacy system used blue `#3b82f6` as the `info` status hue, which would collide
with a blue brand. Resolution: **retire blue from status and fold `info` into the
cobalt brand family.** Brand cobalt *is* the neutral-information signal. This leaves a
clean three-hue status set (green / amber / red) with no two competing blues.

- `--color-info` is re-aliased to the cobalt brand value in every theme.
- `--border-info` (already `color-mix` of `--color-primary`) follows automatically.
- The `.tone-info` driver continues to work, now resolving to cobalt.

## 4. Cobalt values per theme

| Theme | `--color-primary` (action) | `--color-brand-soft` (tint) | `--color-on-primary` | Notes |
|---|---|---|---|---|
| Light (`:root`) | `#2f54eb` | `#eef1fe` | `#ffffff` | ~5.9:1 on white — passes WCAG AA for text/UI |
| Dark | `#5b7cff` (periwinkle lift) | `rgba(91,124,255,.14)` | `#ffffff` (see §4 note) | Cobalt lifts for contrast on dark canvas, mirroring how status hues lift today |
| High-contrast (light) | `#1730a8` (deepened) | `#e6eaff` | `#ffffff` | Maximize legibility; ≥7:1 target |
| High-contrast (dark) | `#7d9bff` | `rgba(125,155,255,.18)` | `#000000` | Mirror of light contrast |

**`--color-on-primary` in dark mode:** the legacy dark theme inverts the action to a
white fill with *ink* text (`--color-on-primary: #0a0a0a`). With a cobalt brand, the
dark action fill is cobalt-periwinkle, so `--color-on-primary` should be **white**
(`#ffffff`) in dark mode too, not ink. This reverses the legacy dark-mode inversion —
intentional, because the brand now carries a hue and reads as a colored fill in both
modes rather than flipping black↔white.

`--color-active` / `--color-primary-active` (hover/pressed) derive one step darker in
light (`#1e3bb8`) and one step lighter/desaturated in dark.

## 5. Token mapping (`web/src/styles/tokens.css`)

All changes are centralized in the primitives + theme blocks.

**`:root` primitives:**
- `--color-primary: #2f54eb;` (was `#0a0a0a`)
- `--color-primary-active: #1e3bb8;` (was `#27272a`)
- `--color-primary-disabled: #c3cefb;` (cobalt-tint, for brand cohesion — replaces the
  zinc `#d4d4d8`).
- Add `--color-brand-soft: #eef1fe;`
- `--color-ink` stays `#0a0a0a` — **ink remains the text color**, decoupled from the
  action color it was previously fused with.
- `--color-info: var(--color-primary);` (re-alias; was `#3b82f6`)

**`@theme inline` bridge:** add `--color-brand-soft: var(--color-brand-soft);` so
`bg-brand-soft` is addressable as a Tailwind utility. `--color-info` mapping already
flows through.

**Dark / contrast / contrast-dark blocks:** each overrides `--color-primary`,
`--color-primary-active`, `--color-primary-disabled`, `--color-brand-soft`,
`--color-on-primary`, and `--color-info` per the §4 table.

**Derived tokens that update for free** (no edit needed — they read `--color-primary`):
- `--ring-focus` → cobalt halo
- `--border-info` → cobalt-alpha border
- `::selection` background
- `button[data-variant="default"]` CTA fill (reads `--color-primary`)
- `.tone-info` driver

## 6. Logo / mark

The rail logo tile (`R`, rounded-square, Geist 700) changes its fill from ink to
**cobalt** with white glyph. This is the only mark change in scope. Geometry, weight,
and the mono identity signal are untouched. (A fuller wordmark/logotype exploration is
out of scope for this spec.)

## 7. Blast radius & risks

Because the app reads `--color-primary`, `--ring-focus`, and `--color-info` from
tokens, the change is mostly centralized. Audit targets during implementation:

1. **Hardcoded ink-as-action.** Anywhere `#0a0a0a` / `#0a0a0a`-equivalents or
   `var(--color-ink)` were used to paint an *action* (button fill, active state, link)
   rather than *text*. These must move to `--color-primary`. Text uses of ink stay.
2. **Blue-as-info literals.** Any component painting `#3b82f6` / `var(--color-info)`
   directly to mean "info" — verify they read correctly now that info = cobalt.
3. **Dark-mode on-primary inversion.** Components assuming dark-mode action text is
   *ink* (from the legacy white-fill inversion) must tolerate white-on-cobalt.
4. **i18n / asset.** No string changes. Any favicon / static brand asset using the old
   ink mark should be regenerated to cobalt (track separately if assets exist).

Grep targets: `#0a0a0a`, `#3b82f6`, `--color-info`, `--color-primary`, `color-ink`
across `web/src/styles/*.css` and `web/src/components/**`.

## 8. Verification

- **Visual:** open the app in light, dark, and both contrast themes; confirm primary
  buttons, links, active nav, focus rings, selection, and "running" pills all read
  cobalt; confirm green/amber/red status unaffected; confirm no stray blue "info".
- **Contrast (WCAG):**
  - Cobalt `#2f54eb` on white ≈ **5.9:1** (AA for normal text, AAA for large/UI).
  - White on cobalt button fill ≈ **5.9:1** (AA).
  - Dark periwinkle `#5b7cff` on `#0b0d12` canvas — verify ≥4.5:1 for link text.
  - Contrast-theme cobalts target ≥7:1.
- **Reference previews:** `docs/superpowers/previews/branding-directions.html`
  (four directions) and `docs/superpowers/previews/branding-technical-refined.html`
  (chosen direction, light + dark, cobalt candidate A).

## 9. Out of scope

- Wordmark / logotype redesign beyond the rail tile fill.
- Typography changes (Geist stays).
- Geometry / radii changes (tight precision geometry stays).
- TUI color changes (this spec is web-only; the TUI artifact palette is referenced
  only for the kind-accent parity that already exists).
- Marketing site / external assets.
