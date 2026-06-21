# Relay Design Identity — Precision/Technical Rework

**Date:** 2026-06-20
**Status:** Design — approved in brainstorming, pending spec review
**Scope:** Visual identity + design tokens for the `web/` Next.js UI. Token-values rework, **not** a token-architecture rewrite.

---

## Problem

The current identity reads as a generic AI/SaaS template — electric Relay Blue (`#0052ff`) + white canvas + shadcn defaults, softened by 100px pill geometry, warm `#f7f6f1` tints, and Instrument Serif editorial display. The token system underneath is excellent (three-tier primitives → semantic → shadcn bridge, single-selector dark theme, CJK handling, motion shelf). The goal is to keep that architecture and re-skin it into a **distinctive, modern, professional precision/technical identity** in the Linear / Vercel / Resend lineage.

## Approved Direction (four pillars)

1. **Color — Monochrome ink.** Black/near-black is the action color; white-on-black inverts in dark mode (the Vercel signature). **Color is reserved exclusively for status** (success / danger / warning / info). No electric blue, no warm tints; neutrals go cool.
2. **Typography — Mono-forward.** Keep Geist (UI) + Geist Mono (the identity signal). **Retire Instrument Serif.** Geist Mono carries eyebrows, metadata, agent labels, tool lines, timestamps, numbers, code, and composer placeholders — terminal-native, fitting an agent-orchestration tool. Display headings become Geist 600 with tight tracking.
3. **Geometry — Tight (6–10px).** Retire the 100px pill as the primary radius. Buttons/badges 6px, inputs/popovers 8px, cards 10–12px. Avatars become rounded-squares, not circles.
4. **Lineage — Precision/technical.** Hairline borders over shadows, calm density, restraint over decoration.

## Non-goals (YAGNI)

- No token-architecture change. The three tiers, `@theme inline` bridge, `html[data-theme="dark"]` single selector, CJK locale blocks, and motion/spacing/type *scales* all stay.
- No spacing-scale or type-*scale* changes (px values are good). Only the *display weight/family* tokens change.
- No component-API or React-structure refactor. This is CSS-token + a small number of literal mirrors.
- No new fonts to load. Instrument Serif is removed from `next/font`; Geist + Geist Mono already loaded.

---

## Token Changes (the work)

All hex lives in `:root` / `html[data-theme="dark"]` primitives in `web/src/styles/tokens.css`. Because components consume **semantic** tokens, most of the visual change propagates from this one file.

### Color primitives — light

| Token | Old | New | Note |
|---|---|---|---|
| `--color-primary` | `#0052ff` | `#0a0a0a` | action = ink black |
| `--color-primary-active` | `#003ecc` | `#27272a` | hover/pressed |
| `--color-primary-disabled` | `#a8b8cc` | `#d4d4d8` | neutral, not blue |
| `--color-on-primary` | `#ffffff` | `#ffffff` | unchanged |
| `--color-ink` | `#18232d` | `#0a0a0a` | headings/primary |
| `--color-body` | `#5b616e` | `#52525b` | cool neutral (zinc-600) |
| `--color-muted` | `#7c828a` | `#71717a` | zinc-500 |
| `--color-muted-soft` | `#a8acb3` | `#a1a1aa` | zinc-400 |
| `--color-canvas` | `#ffffff` | `#ffffff` | unchanged |
| `--color-surface-soft` | `#f7f6f1` (warm) | `#fafafa` | cool, replaces warm tint |
| `--color-surface-strong` | `#eef0f3` | `#f4f4f5` | zinc-100 |
| `--color-surface-dark` | `#18232d` | `#0b0b0d` | true near-black |
| `--color-hairline` | `#d0d5db` | `#e4e4e7` | zinc-200 |
| `--color-hairline-soft` | `#eef0f3` | `#f0f0f0` | |

### Status colors — the ONLY hues in the system

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-success` (`semantic-up`) | `#10b981` | `#2ed391` | verdict approved, node ready |
| `--color-danger` (`semantic-down`) | `#e5484d` | `#ff6b75` | failures, reject |
| `--color-warning` (`accent-yellow`) | `#f5a623` | `#f5a623` | attention dot only |
| `--color-info` | `#3b82f6` | `#60a5fa` | **new** — neutral "info" status dot; the sole surviving blue, status-only (never an action) |

### Color primitives — dark

| Token | New |
|---|---|
| `--color-primary` (action) | `#f4f4f5` (white-on-black invert) |
| `--color-on-primary` (dark) | `#0a0a0a` |
| `--color-canvas` | `#0b0b0d` |
| `--color-surface-card` / `-soft` / `-strong` | `#111114` / `#111114` / `#15151a` |
| `--color-hairline` / `-soft` | `#2c2c32` / `#1e1e22` |
| `--color-ink` / `body` / `muted` / `muted-soft` | `#f4f4f5` / `#a1a1aa` / `#71717a` / `#52525b` |

> **Dark-mode action invert.** Today dark mode lifts the blue but keeps blue-on-dark actions. New behavior: the primary action fill becomes `--color-primary = #f4f4f5` with `--color-on-primary = #0a0a0a` in the dark block. The `button[data-variant="default"]` rules in `tokens.css` already read these tokens, so the invert is automatic — verify no component hardcodes white text on the primary button.

### Radii

| Token | Old | New |
|---|---|---|
| `--radius-sm` | 6px | 6px (buttons, badges) |
| `--radius-md` | 8px | 8px (inputs, popovers) |
| `--radius-lg` | 12px | 10px |
| `--radius-xl` | 24px | 12px (cards) |
| `--radius-pill` | 100px | **deprecated** — keep token defined (= `--radius-sm`) so 14 consumers don't break, migrate them off in Phase 2 |
| `--radius-full` | 9999px | retained for any true circles that remain |

Avatars move from `--radius-full` to `--radius-sm` (rounded-square) where they appear.

### Typography

- **Remove** `--font-instrument-serif` from `web/src/app/layout.tsx` `next/font` setup and from the `--font-display` stack. `--font-display` becomes an alias of `--font-sans` (Geist) so any lingering `font-display` consumer degrades gracefully to a sans display.
- Rewrite the display role tokens from serif-400 to sans-600 tight:
  - `--type-display-lg`: `400 36px/1.11 serif` → `600 34px/1.08 var(--font-sans)`, tracking `-1px`
  - `--type-display-sm`: `400 28px/1.11 serif` → `600 24px/1.1 var(--font-sans)`, tracking `-0.6px`
- **New/elevated mono roles** (mono as identity):
  - `--type-eyebrow` → switch to `var(--font-mono)`, `500 11px`, tracking `0.04em`, uppercase
  - `--type-meta-mono`: `500 12px/1.4 var(--font-mono)` — agent labels, tool lines, timestamps, composer placeholder
- Update `--letter-display*` for the sans display (serif-tuned `-0.3px` → `-0.6/-1px`).
- CJK blocks (`html:lang(zh-CN/zh-TW)`): drop the Instrument-Serif-first `--font-display`; it already falls back to Noto sans, so display simply uses the sans stack.

### Motion & elevation

- Precision is restrained: prefer `--ease-standard`; reduce `--ease-spring` (overshoot) to send-button only or drop it. Keep tokens defined.
- Shadows stay minimal — lean on hairlines. `--shadow-soft` unchanged (light); dark `--shadow-soft` already deepened.

---

## Open Decision — Agent color coding

Agents (`claude` / `pi` / `codex` / `kimi`) currently carry per-agent accent classes (`agent-pi`, etc. in `composer.css`, `MentionPopover.tsx`, and mirrored in `App.tsx`/`MessageBlock.tsx`). A strict monochrome system says **color is status-only**, which conflicts with hue-coded agents.

**Recommended resolution:** differentiate agents **typographically, not chromatically** — the mono `agent · mode` eyebrow (`claude · action`) becomes the identifier, plus an optional rounded-square monogram avatar. Drop agent hues. This keeps the "color = status only" rule pure and is more legible than four mid-saturation accents. If a faint agent cue is still wanted, use a neutral-gray left-border weight, not hue.

This is the one place the rework touches `App.tsx`/`MessageBlock.tsx` literals and `agent.<name>` styling (per the CLAUDE.md registry-mirroring invariant). Confirm during plan review.

---

## Implementation Phases

1. **Primitives rewrite** (`tokens.css` `:root` + dark block + `next/font` in `layout.tsx`). Highest visual yield; most surfaces update automatically via semantic tokens. Remove Instrument Serif.
2. **Literal sweep across component CSS** (~14 `radius-pill`, ~12 `surface-soft`, 2 `font-display`, 1 `Instrument`, 1 `#f7f6f1`): repoint pills → `--radius-sm`/`-md`, confirm warm-tint sites read fine cool, retire serif display sites. Audit dark primary-button text for hardcoded white.
3. **Agent de-chroming** (per Open Decision): `composer.css`, `MentionPopover.tsx`, `App.tsx`, `MessageBlock.tsx`, `agent.*` styles → mono label + monogram, drop hues.
4. **Verification:** visual pass on chat / admin dashboard / login in both themes; run `web/tests/*` (messageBlock, tokenUsage, manageAgents, status, agentStream); check a11y contrast (mono-on-canvas text steps must clear WCAG AA — `--color-muted` `#71717a` on white ≈ 4.6:1 ✓; verify dark equivalents).

## Success Criteria

- Zero electric-blue (`#0052ff`) and zero warm-tint (`#f7f6f1`) pixels remain; the only hues on screen are status colors.
- Instrument Serif is fully removed (no `next/font` load, no `--font-display` serif).
- No 100px pills on actions/inputs/cards (status badges may keep a small radius, not full pill).
- Light and dark both pass WCAG AA for body/muted text and the focus ring.
- Existing `web/` tests pass; TUI/backend untouched.

## Risks

- **Hardcoded values outside semantic tokens** (inline `style` font-sizes, the noted `#f7f6f1` literal) won't auto-update — the Phase 2 sweep must catch them.
- **Monochrome legibility:** removing hue from agents/links shifts disambiguation onto weight, mono, and underlines; verify links remain obviously clickable (underline kept).
- **Dark primary invert:** any component asserting white text on the primary button will go invisible (black-on-black) in dark — explicitly audited in Phase 2.
