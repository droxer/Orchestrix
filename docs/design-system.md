---
version: alpha
name: Relay-design
description: A precision/technical design system for an agent-orchestration control plane, in the Linear / Vercel / Resend lineage. The canvas is warm ecru (#fdfcfa; near-black in dark mode); cobalt (#3b5bdb) is the single brand ACTION color and lifts to periwinkle (#7089ff) on the dark canvas. The action carries the hue; status is reserved for success, danger, and warning (green / amber / red), and "info" is a neutral cool slate (#5b6779) decoupled from the action — so the brand hue marks action, selection, and focus only. Type is Geist for all interface, display, and chrome text (display is weighted Geist at 600 with tight size-scaling tracking, not an editorial serif); Geist Mono is reserved for code-like content only — tool/command lines, raw logs, code blocks, and IDs (the Linear model, sans carries eyebrows/metadata/agent-labels/numbers). Base UI text is 13px. Geometry is tight: 5px on buttons and badges, 6px on inputs, 8–10px on cards; the pill is retired. Depth comes from warm hairline borders, not shadows. Motion is fast and un-bouncy. The result reads as serious engineering tooling — calm, dense, action-focused, terminal-native, in Linear's structural discipline.

colors:
  primary: "#3b5bdb"
  primary-active: "#2f4bc4"
  primary-disabled: "#c1cbf0"
  brand-soft: "#edeff8"
  ink: "#171412"
  body: "#57534e"
  body-strong: "#171412"
  muted: "#79716b"
  muted-soft: "#a8a29e"
  hairline: "#eae5dd"
  hairline-soft: "#f1ede6"
  canvas: "#fdfcfa"
  surface-soft: "#faf8f4"
  surface-card: "#fdfcfa"
  surface-strong: "#f5f2ec"
  surface-dark: "#0d0c0a"
  surface-dark-elevated: "#1a1815"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#a1a1aa"
  semantic-up: "#15803d"
  semantic-down: "#e5484d"
  accent-yellow: "#f5a623"
  info: "#5b6779"

typography:
  display-lg:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.022em
  display-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.022em
  title-lg:
    fontFamily: "'Geist', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.014em
  title-md:
    fontFamily: "'Geist', sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  title-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body-md:
    fontFamily: "'Geist', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-strong:
    fontFamily: "'Geist', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption-strong:
    fontFamily: "'Geist', sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
  label-strong:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  caption-strong-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  label-md:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  label:
    fontFamily: "'Geist', sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  micro-strong:
    fontFamily: "'Geist', sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  meta:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  eyebrow:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.05em
  number:
    fontFamily: "'Geist', sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  number-display:
    fontFamily: "'Geist', sans-serif"
    fontSize: 30px
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: -0.028em
  button:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 0
  nav-link:
    fontFamily: "'Geist', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: 0px
  xs: 3px
  sm: 5px
  md: 6px
  lg: 8px
  xl: 10px
  pill: 5px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  top-nav-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    height: 60px
  side-nav:
    backgroundColor: "{colors.canvas}"
    activeBackgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    widthCollapsed: 96px
    widthExpanded: 260px
    itemHeight: 38px
    rounded: "{rounded.sm}"
  authenticated-route-shell:
    backgroundColor: "{colors.canvas}"
    columns: "sidenav | route"
    routes: "workspace, backlog, routine, channels, admin"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    height: 36px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-primary-disabled:
    backgroundColor: "{colors.primary-disabled}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    height: 36px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  link-inline:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    decoration: underline
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    border: "1px solid {colors.hairline}"
    padding: 16px
  card-soft:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: 16px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 9px 12px
    height: 40px
  search-input:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    height: 38px
  badge:
    backgroundColor: transparent
    textColor: "{colors.body}"
    typography: "{typography.caption-strong}"
    rounded: "{rounded.sm}"
    border: "1px solid {colors.hairline}"
    padding: 3px 9px
  badge-mono:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.sm}"
    border: "1px solid {colors.hairline}"
    padding: 2px 8px
  avatar:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: 36px
  status-dot:
    rounded: "{rounded.full}"
    size: 8px
  status-up-cell:
    backgroundColor: transparent
    textColor: "{colors.semantic-up}"
    typography: "{typography.number}"
  status-down-cell:
    backgroundColor: transparent
    textColor: "{colors.semantic-down}"
    typography: "{typography.number}"
  pricing-tier-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    border: "1px solid {colors.hairline}"
    padding: 24px
  pricing-tier-featured:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: 24px
  footer-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: 64px 48px
  legal-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
---

# Relay Design

<p align="center">
  <img src="../assets/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

## Overview

Relay reads like serious engineering tooling — precise, dense, and restrained.
The system is in the **Linear / Vercel / Resend** lineage: a warm ecru canvas
(`#fdfcfa`, near-black in dark mode), **cobalt** (`#3b5bdb`) as the single brand
**action** color, warm neutral hairlines, and the remaining color reserved for
status. It follows Linear's structural discipline — tight radii, fast and
un-bouncy motion, modest display sizes, dense rows, and near-flat surfaces where
hairlines (not shadows or grain) carry the chrome.

Type is **Geist** for every line of interface, display, AND chrome text — eyebrows,
metadata, agent labels, and numbers all ride the sans (the Linear model, where the
sans does the work). **Geist Mono** is reserved for code-like content: tool /
command lines, raw logs, code blocks, and IDs. There is no editorial serif: display
moments use weighted Geist (600) with tight, size-scaling negative tracking. Base UI
text is **13px**.

Geometry is tight — 5px on buttons and badges, 6px on inputs, 8–10px on cards.
The 100px pill is retired. Depth comes from 1px hairline borders, not decorative
shadows.

**Key Characteristics:**
- Cobalt action: `{colors.primary}` (#3b5bdb) carries every primary action — buttons, links, the focus ring, and text selection — and lifts to periwinkle (`#7089ff`) on the dark canvas. `{colors.brand-soft}` (#edeff8) is the matching tint for selected/active affordances. The brand hue is the action; it never bleeds into running text, status, decoration, or neutral surfaces.
- Color = status: `{colors.semantic-up}`, `{colors.semantic-down}`, and `{colors.accent-yellow}` (green / amber / red) carry status as text, dots, and borders — never fills. "Info" is a neutral cool slate (`{colors.info}` #5b6779), decoupled from the action hue.
- Sans-carried chrome: eyebrows, metadata, agent labels (`claude · action`), timestamps, and numbers render in Geist Sans (Linear model). Mono is reserved for tool/command lines, raw logs, code, and IDs.
- Tight geometry: `{rounded.sm}` (5px) interactive, `{rounded.xl}` (10px) cards. Pills and large radii absent.
- Hairline depth: 1px `{colors.hairline}` borders over shadows; elevation is restrained.
- Weighted-sans display: Geist 600 with size-scaling negative tracking (`-0.022em` display, `-0.028em` mega) replaces the retired serif.
- Linear-fast motion: 120–160ms transitions, un-bouncy easing; no editorial overshoot as default.

## Colors

### Action, selection, and focus (cobalt brand)
- **Cobalt** (`{colors.primary}` — #3b5bdb): The single brand action color — primary buttons, links, the focus ring, and text selection. On the dark canvas it lifts to periwinkle (`#7089ff`) with deep-navy text (`#08112e`). The wordmark and agent marks stay neutral; cobalt is not a decorative brand fill.
- **Cobalt Active** (`{colors.primary-active}` — #2f4bc4): Press/hover darken on the action fill.
- **Cobalt Disabled** (`{colors.primary-disabled}` — #c1cbf0): Faded cobalt tint for disabled actions.
- **Brand Soft** (`{colors.brand-soft}` — #edeff8): The cobalt tint token (8% cobalt on canvas) for selection — selected rows, active nav, and running-state affordances. It is a selection tint, not a generic decorative wash.

### Status hues
- **Success** (`{colors.semantic-up}` — #15803d): positive status green — verdict approved, node ready. Text/dot/border only.
- **Danger** (`{colors.semantic-down}` — #e5484d): failures, reject, destructive. Text/dot/border only.
- **Warning** (`{colors.accent-yellow}` — #f5a623): attention dot only, never an action.
- **Info** (`{colors.info}` — #5b6779): a neutral cool slate, **decoupled** from the action hue. "Info" dots, `assigned`/`review` workflow accents, and info borders read in slate — not the cobalt brand and not a second blue. Text/dot/border only, never a fill.

### Surface (warm ecru / stone)
- **Canvas** (`{colors.canvas}` — #fdfcfa): The default page floor — warm ecru, not pure white.
- **Surface Soft** (`{colors.surface-soft}` — #faf8f4): Subtle warm tint — quotes, code, hover.
- **Surface Strong** (`{colors.surface-strong}` — #f5f2ec): Fills behind secondary buttons, search, avatars.
- **Surface Dark** (`{colors.surface-dark}` — #0d0c0a): The dark-mode canvas — warm near-black with a trace of amber lift off cold zinc. The featured-tier inversion fill uses the same token.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #1a1815): One step above the dark canvas for cards and floating chrome.

### Hairlines (warm)
- **Hairline** (`{colors.hairline}` — #eae5dd): Default 1px divider and card border on ecru.
- **Hairline Soft** (`{colors.hairline-soft}` — #f1ede6): Lighter divider.

### Text (warm stone)
- **Ink** (`{colors.ink}` — #171412): Display headings, primary copy, emphasis.
- **Body** (`{colors.body}` — #57534e): Default running text — warm stone.
- **Muted** (`{colors.muted}` — #79716b): Sub-titles, secondary labels.
- **Muted Soft** (`{colors.muted-soft}` — #a8a29e): Timestamps, disabled.
- **On Primary** (`{colors.on-primary}` — #ffffff): Text on the cobalt action fill — stays white in light mode; on the bright dark-mode fill it flips to deep navy (`#08112e`).
- **On Dark** (`{colors.on-dark}` — #ffffff): Text on dark surfaces.

## Typography

### Font Family
The system uses **Geist** for all interface, display, and chrome text; **Geist Mono**
is reserved for code-like content only. **Lucide icons** handle product iconography.
The editorial serif is retired. Fallback stack: `-apple-system, BlinkMacSystemFont,
"Segoe UI", Helvetica, Arial, sans-serif` for sans; `"SFMono-Regular", Consolas,
Menlo, monospace` for mono.

Display is weighted Geist (600) with tight, **size-scaling** negative tracking
(em-based, growing with size per Linear: `-0.022em` on the 20–26px display band,
`-0.028em` on 30px+ metrics) — crisp and confident rather than editorial, and modest
in size (Linear-restrained: the page title is 26px, not 34px). Chrome — eyebrows,
agent labels, timestamps, numbers — rides the sans; mono is scoped to tool/command
lines, raw logs, code blocks, and IDs.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-lg}` | 26px | 600 | 1.15 | -0.022em | Admin page title, hero headline — Geist |
| `{typography.display-sm}` | 20px | 600 | 1.2 | -0.022em | Sub-section heads, empty-state display |
| `{typography.title-lg}` | 20px | 600 | 1.2 | -0.014em | Panel headings |
| `{typography.title-md}` | 17px | 600 | 1.35 | 0 | Component titles, chat header |
| `{typography.title-sm}` | 15px | 600 | 1.3 | 0 | List labels |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0 | Message bodies, inputs |
| `{typography.body-strong}` | 16px | 600 | 1.5 | 0 | Emphasized body |
| `{typography.body-sm}` | 13px | 400 | 1.5 | 0 | Default UI chrome |
| `{typography.caption}` | 13px | 400 | 1.5 | 0 | Captions, previews |
| `{typography.caption-strong}` | 12px | 600 | 1.5 | 0 | Badge labels |
| `{typography.label-strong}` | 13px | 600 | 1.4 | 0 | Bold chrome — row names, CTA labels, tab titles |
| `{typography.caption-strong-sm}` | 13px | 600 | 1.4 | 0 | Small bold labels, copy buttons |
| `{typography.label-md}` | 13px | 500 | 1.4 | 0 | Medium chrome — meta rows, timestamps (sans) |
| `{typography.label}` | 12px | 500 | 1.4 | 0 | Small medium chrome — counts, sub-meta |
| `{typography.micro-strong}` | 11px | 600 | 1.4 | 0 | Tiny bold — tabs, pills, agent chips |
| `{typography.meta}` | 12px | 500 | 1.4 | 0 | Agent labels, metadata, timestamps — Geist Sans |
| `{typography.eyebrow}` | 11px | 500 | 1.5 | 0.05em | Section kickers (uppercase) — Geist Sans |
| `{typography.number}` | 18px | 500 | 1.4 | 0 | Inline metrics, deltas — Geist Sans (tabular) |
| `{typography.number-display}` | 30px | 500 | 1.12 | -0.028em | Admin metric values — Geist Sans (tabular) |
| _(mono)_ | 12–13px | 400–500 | 1.5 | 0 | Tool/command lines, raw logs, code, IDs — Geist Mono |
| `{typography.button}` | 13px | 600 | 1.15 | 0 | Action labels |
| `{typography.nav-link}` | 13px | 500 | 1.4 | 0 | Nav items |

### Principles
- **Display is weighted sans.** Geist 600 with size-scaling negative tracking carries display moments; there is no serif. Sizes stay modest (Linear-restrained).
- **Sans carries the chrome (Linear model).** Eyebrows, agent labels, timestamps, and numbers render in Geist Sans. Geist Mono is reserved for code-like content: tool/command lines, raw logs, code blocks, and IDs.
- **Emphasis tops out at 600.** No 700+ weights anywhere.
- **Negative tracking on display only, and it scales.** Display bands use `-0.022em` (20–26px) and `-0.028em` (30px+); body stays at 0.
- **13px is the base.** Chrome (buttons, nav, rows, labels) runs at 13px; prose and inputs stay 16px.

### Note on Fonts
Geist and Geist Mono are open Google Fonts, loaded as variable fonts by `next/font`
in `web/src/app/layout.tsx`. `latin-ext` is loaded alongside `latin` so accented
European/Vietnamese names in employee and sandbox labels render in-brand.

### International Type (CJK)
The web app ships English plus Simplified (`zh-CN`) and Traditional (`zh-TW`) Chinese.
Geist and Geist Mono carry no Han glyphs, so the Chinese locales fall through to **Noto
Sans SC / Noto Sans TC**, loaded by `next/font` with `preload: false` and downloaded
only on a Chinese locale.
- **`:lang()` switching, not duplication.** `html:lang(zh-CN)` / `html:lang(zh-TW)` in `tokens.css` reorder the `--font-sans` / `--font-mono` stacks so Geist stays first for Latin and Han characters resolve to Noto. `--font-display` aliases `--font-sans`, so retargeting sans also retargets display — no separate display stack is needed.
- **System fallbacks** cover machines without the webfont: PingFang (macOS), Microsoft YaHei / JhengHei (Windows), Source Han Sans.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 64px.
- **Card internal padding:** `{spacing.base}` (16px) for product cards; `{spacing.lg}` (24px) for marketing/pricing cards.
- **Row rhythm:** the default `--space-row-y` is `{spacing.sm}` (12px) — Linear-dense; compact surfaces drop to `{spacing.xs}` (8px) via `[data-density="compact"]`.

### Whitespace Philosophy
Calm but dense. Authenticated work surfaces are information-rich with tight rhythm;
marketing bands use the 64px section spacing. Density lives inside the product.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Most surfaces |
| Hairline border | 1px `{colors.hairline}` | Cards, rows, inputs — the default depth cue |
| Soft drop | `--shadow-soft` (`0 1px 1px rgba(0,0,0,0.03)`) | Bordered cards on hover |
| Lift | `--shadow-lift` (crisp 1px ink ring + `0 1px 3px rgba(0,0,0,0.04)` drop) | Borderless floating chrome — drawers, dialogs, composer, tooltips |

Depth is carried by hairlines first — near-flat surfaces in Linear's manner. Pick
`--shadow-soft` for a surface that already has a 1px border; pick `--shadow-lift` for
borderless floating chrome where the inner ring stands in for the edge.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Reserved |
| `{rounded.xs}` | 3px | Inline tags, tiny chips |
| `{rounded.sm}` | 5px | Buttons, badges, send button |
| `{rounded.md}` | 6px | Inputs, popovers, avatars (rounded-square) |
| `{rounded.lg}` | 8px | Mid-size cards |
| `{rounded.xl}` | 10px | Cards, drawers, pricing tiers |
| `{rounded.pill}` | 5px | **Retired** — aliases `{rounded.sm}` so legacy consumers render tight |
| `{rounded.full}` | 9999px | Status dots and pips only |

Tight corners on interactive elements, 10px on containers, full circle reserved for
status dots. The pill is gone.

## Components

### Top Navigation
**`top-nav-light`** — Default top nav on ecru. Background `{colors.canvas}`, text `{colors.ink}`, height 60px. Wordmark left, menu center, search + actions right.

### Application Navigation
**`sidenav-panel`** — Authenticated app rail. Ecru canvas, 1px hairline border, 48px square collapsed buttons, 38px labeled rows when expanded, rounded `{rounded.sm}`. Active route = quiet `{colors.brand-soft}` selection tint with ink text, no left bar or saturated plate. Route order is **Threads → Workspace → Backlog → Routine**; admins additionally see **Channels** and **Admin** after a separator.

**Retired routes** — The standalone **MCP** and **Skills** pages are removed because they are not usable workflows. Do not reserve side-nav buttons, route-shell selectors, locale keys, or preview panels for them until they are rebuilt as real product surfaces.

### Buttons
**`button-primary`** — The cobalt action. Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}` (13px/600), padding 8px × 16px, height 36px, rounded `{rounded.sm}` (5px). Lifts to periwinkle (`#7089ff`) in dark mode with deep-navy text.

**`button-primary-active`** — Press/hover. Background `{colors.primary-active}`.

**`button-primary-disabled`** — Faded cobalt. Background `{colors.primary-disabled}`.

**`button-secondary`** — Soft-neutral secondary. Background `{colors.surface-strong}`, text `{colors.ink}`, same geometry.

**`button-ghost`** — Transparent. Text `{colors.ink}`; surfaces a `{colors.surface-strong}` wash on hover.

**`link-inline`** — Inline link. Text `{colors.primary}` (cobalt) with an underline — links read in the brand hue and stay underlined.

### Cards
**`card`** — The default container. Background `{colors.surface-card}`, 1px `{colors.hairline}` border, rounded `{rounded.xl}` (10px), padding 16px. Depth from the hairline, not a shadow.

**`card-soft`** — Quiet variant on `{colors.surface-soft}` for quotes, code blocks, and grouped content.

### Operational Surfaces
**`agent-turn`** — A message turn on the transcript rail. A square monochrome rail node (glyph shape, not vendor hue) marks the gutter; a sans `{typography.meta}` eyebrow (`claude · action`) identifies the agent and mode; body in `{typography.body-md}`; tool lines in mono. One `●` marker per turn, `○` for thinking, `⏺` for tool/command lines. No surrounding card. Consecutive same-agent turns group and drop the repeated eyebrow.

**`review-card`** — Codex review result. `{colors.surface-soft}` fill, 1px hairline, mono title, verdict word colored by status (`{colors.semantic-up}` approved / `{colors.semantic-down}` rejected).

**`status-up-cell`** + **`status-down-cell`** — Inline status cells. Color-only text in `{typography.number}`, no background fill.

**`avatar`** — Employee and agent avatars. Rounded-square (`{rounded.md}`), 36px, `{colors.surface-strong}` fill, ink glyph. Agents are differentiated by their vendor glyph shape (via `AgentMark`), **not** by vendor brand color — agent identity is shape, not hue, and the cobalt brand is reserved for actions. A corner status pip (`{rounded.full}`) carries tone.

### Forms
**`text-input`** — Background `{colors.canvas}`, rounded `{rounded.md}` (6px), padding 9px × 12px, height 40px, 1px hairline. Focus adds `--ring-focus` (3px cobalt-alpha halo).

**`search-input`** — Background `{colors.surface-strong}`, rounded `{rounded.md}`, height 38px. No pill.

### Tags & Badges
**`badge`** — Outlined chip. Transparent fill, 1px `{colors.hairline}`, text `{colors.body}`, type `{typography.caption-strong}`, rounded `{rounded.sm}`.

**`badge-mono`** — Mono metadata chip (`3 agents`, counts). Transparent, hairline, `{typography.eyebrow}` mono.

### Pricing
**`pricing-tier-card`** — Background `{colors.canvas}`, rounded `{rounded.xl}`, 1px hairline, padding 24px.

**`pricing-tier-featured`** — Dark inversion. Background `{colors.surface-dark}`, text `{colors.on-dark}` — highlights via inversion, not a colored ribbon.

### Footer
**`footer-light`** — Background `{colors.canvas}`, text `{colors.body}`. **`legal-band`** — `{colors.muted}` at `{typography.caption}`.

## Do's and Don'ts

### Do
- Use `{colors.primary}` (cobalt) for actions; let it lift to periwinkle in dark mode.
- Use `{colors.brand-soft}` for selected rows, active nav, and running-state affordances.
- Reserve the other hues for status — `{colors.semantic-up}` / `{colors.semantic-down}` / `{colors.accent-yellow}`, as text/dots/borders; use the slate `{colors.info}` for neutral/info status.
- Render eyebrows, agent labels, timestamps, and numbers in Geist Sans; reserve Geist Mono for tool/command lines, raw logs, code, and IDs.
- Use tight radii: `{rounded.sm}` (5px) interactive, `{rounded.xl}` cards.
- Carry depth with 1px hairlines first; reach for shadows only on floating chrome.
- Render links in cobalt (`{colors.primary}`) with an underline.
- Keep motion fast and un-bouncy (120–160ms, `--ease-standard`); reserve overshoot for rare, deliberate moments.
- Use `--atmosphere-*` tokens sparingly on login, empty states, and admin hero tiles — controlled grain/wash (now dialed back near-flat), disabled in high-contrast mode.

### Don't
- Don't use a status color (green/amber/red) or the slate info as an action — cobalt is the only action hue.
- Don't route the cobalt brand into status or decoration — it marks action, selection, and focus only.
- Don't introduce a second brand hue or use status green/amber/red as general UI background fills.
- Don't use the pill (100px) or large radii on actions, inputs, or cards.
- Don't tint agent avatars with vendor brand colors — glyph shape carries identity.
- Don't bring back an editorial serif, 700+ display weights, or oversized (34px+) display type.
- Don't add ad-hoc decorative gradients or gloss outside the `--atmosphere-*` exception.

### Status fill exceptions
Status hues stay text/dot/border in most UI. These narrow fills are allowed:
- **Status dots and pips** — `{rounded.full}` fills on 6–10px indicators (avatar pips, mode-chip dots, row status dots).
- **Destructive stop** — the composer's cancel/send-stop control may use an outlined danger treatment (hairline + danger text) while a run is active; never a second action hue beside cobalt.
- **Success confirmation** — transient copy/feedback controls may flip to an outlined success treatment (hairline + success text), not a solid green plate.
- **Data visualization** — chart segments and stacked bars (token usage: input = cobalt, output = success green, cache = muted gray; fleet health uses the status ramp for segment fills only inside charts).

## Operational Surfaces (in-product)

The in-product chat shell is operational and dense. It inherits the primitives above
and adds a tighter scale tuned for an authenticated three-pane Slack-style canvas. The
tokens below live in `web/src/styles/` and supersede marketing typography inside
`.messenger-shell`.

### Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 96px | Collapsed left rail |
| `--sidenav-w-open` | 260px | Expanded left rail (default) |
| `--thread-w` | 296px | Conversation list (second pane) |
| `--drawer-w` | 360px | Settings/preferences drawer (right) |
| `--header-h` | 60px | Chat panel top bar |

### Operational type scale

| Token | Size | Role |
|---|---|---|
| `--text-micro` | 10px | Minimap / abbreviations |
| `--text-2xs` | 11px | Compact metadata, sans eyebrows |
| `--text-xs` | 12px | Badges, timestamps, panel kickers |
| `--text-sm` | 13px | Captions, secondary UI |
| `--text-base` | 13px | Default UI chrome (buttons, nav, rows) — Linear's base size |
| `--text-md` | 16px | Message bodies, inputs (≥16px avoids iOS zoom) |
| `--text-lg` | 18px | Chat header title, wordmark |
| `--text-xl` | 22px | Panel headings |
| `--text-2xl` | 24px | Empty-state display, mobile metric values |
| `--text-3xl` | 26px | Admin page title — **Geist 600** |
| `--text-4xl` | 30px | Admin metric values — **Geist Sans 500 (tabular)** |

`--text-base` (13px chrome) and `--text-md` (16px prose) are distinct roles. Use
`--text-base` for buttons, row labels, nav, and metadata; use `--text-md` for message
bodies, composer text, and inputs. Note `--text-sm` and `--text-base` are both 13px —
the scale is intentionally compressed (Linear leans on weight/color for hierarchy, not
size). Display moments (≥24px) reach for `var(--font-display)` — weighted Geist, not a
serif.

### Operational components

- **`messenger-shell`** — three-pane CSS grid (`sidenav | thread | chat`), with an optional fourth `drawer` column. Below 768px it collapses to one pane at a time.
- **Route shell** — top-level work pages collapse the thread pane to `sidenav | route`. Current full-page routes are `workspace`, `backlog`, `routine`, `channels`, and `admin`; route CSS should not include retired `mcp` or `skills` selectors.
- **`sidenav-panel`** — vertical rail, labeled by default. 48px square buttons (collapsed) / 38px labeled rows at `--radius-sm`; expands to 260px revealing `--type-nav-link` labels. Active route = quiet `{colors.brand-soft}` selection tint (no left bar). The visible route set is Threads, Workspace, Backlog, Routine, with Channels and Admin added for admins.
- **`thread-panel`** — conversation list grouped by state (Needs you → Running → Idle). Flat **68px** rows with name (`--text-base` / 600) and a 13px preview line. Active row = `{colors.brand-soft}` fill, **no left bar** (mirrors sidenav active). Separated by hairlines, not cards. The Needs-you section label stays muted; a leading warning dot carries the hue.
- **`chat-panel`** — message canvas. 18px ink header title; messages render on a continuous **rail** — a 1.5px hairline spine with square agent nodes and a circular ink node for the human. Block-grouped `.msg` units carry sans eyebrows. Depth from typography and the rail, not boxes.
- **`msg-user`** — the operator's voice **on the rail**. A filled circular ink node (agents stay square) plus a mono `YOU` eyebrow and timestamp; message body in 13px Geist medium, ink, no bubble and no cobalt fill. The human reads as a peer turn in the same spine as agents — attribution is node shape + eyebrow, not alignment or a messenger bubble.
- **`composer`** — bottom-pinned input. The **outer wrap** (`.composer-input-wrap`) carries `--shadow-lift`; the inner field is a flat textarea with no extra drop shadow. The send button is a **36×36px** rounded-square (`--radius-sm`) cobalt plate — flat, no gloss. The mode chip (Implement / Review) sits bottom-left with a leading status dot — `accent-yellow` for implement, slate `{colors.info}` for review — never a colored chip fill.
- **`ac-*` (Admin Console)** — metric cards. Titles use `var(--font-display)` at `--text-3xl` (26px); values use `--font-number` at `--text-4xl` (30px). Cards are `--radius-xl`, hairline-bordered, lift on hover.
- **`adm-drawer`** — right-edge sheet. Light variant is ecru canvas; dark variant fills with `--color-surface-dark` and uses `--color-hairline-on-dark` for dividers.

### Focus, motion, dark mode
- **Focus ring** — every interactive surface uses `var(--ring-focus)`, a 3px cobalt-alpha halo. No ad-hoc 1px/2px outline variants. Destructive controls on focus may use a danger-alpha halo of the same geometry.
- **Status tone driver** — `tone-good` / `tone-info` / `tone-bad` / `tone-warn` / `tone-neutral` set a single `--tone` variable consumed by dots and outlined pills. `tone-info` maps to `--color-info`, a neutral cool slate decoupled from the action hue (no longer the brand).
- **Dark mode** — one definition, `html[data-theme="dark"]`, resolved before first paint. Canvas uses warm charcoal (`#0d0c0a` / `#1a1815` elevated). The action color lifts to periwinkle (`#7089ff`) with deep-navy text (`#08112e`); info reads as a lifted slate (`#8c98ac`); status hues are lifted for legibility on the dark canvas.
- **Motion** — canonical curves/durations on a shared shelf (`--ease-standard`, `--ease-out-quint`, `--ease-spring`). Durations are Linear-fast (`--duration-fast` 120ms, `--duration-base` 160ms). Precision favors `--ease-standard`; the spring's overshoot is gentle and used sparingly.

### Atmosphere (controlled exception)
Login, transcript empty, admin KPI hero, and `.relay-atmosphere` panels may read `--atmosphere-background` — a corner radial wash plus subtle grain from `--atmosphere-grain-*` (now dialed back to a near-flat whisper, Linear-style). High-contrast themes disable grain and wash. This is the only approved decorative texture; do not invent new gradients elsewhere.

### Data visualization
The admin token-usage chart uses a fixed three-segment ramp that reuses existing tokens:
- **Input tokens** — `{colors.primary}` (cobalt)
- **Output tokens** — `{colors.semantic-up}` (green)
- **Cache tokens** — `{colors.muted-soft}` (neutral gray)

Fleet-health stacked bars and activity charts use the status tone ramp (`semantic-up` / `semantic-down` / `accent-yellow` / muted) **inside chart segments only**. Artifact kind accents (`--color-kind-*` in `tokens.css`) are a separate decorative chip palette mirrored from the TUI — not status, not action.

## Known Gaps
- Geist and Geist Mono are the default open-source font choices.
- Form validation states beyond focus are not fully specified.
