---
version: alpha
name: Relay-design
description: A precision/technical design system for an agent-orchestration control plane, in the Linear / Vercel / Resend lineage. The canvas is white (near-black in dark mode); cobalt (#2f54eb) is the single brand ACTION color and lifts to periwinkle (#5b7cff) on the dark canvas. The action carries the hue; status is reserved for success, danger, and warning (green / amber / red), and the former info blue folds into the cobalt brand — no competing second blue. Type is Geist for all interface and display text (display is weighted Geist at 600 with tight tracking, not an editorial serif), with Geist Mono as a deliberate identity signal carrying eyebrows, metadata, agent labels, tool lines, numbers, and code. Geometry is tight: 4px on buttons and badges, 6px on inputs, 8–10px on cards; the pill is retired. Depth comes from hairline borders, not shadows. The result reads as serious engineering tooling — calm, dense, cobalt-accented, terminal-native.

colors:
  primary: "#2f54eb"
  primary-active: "#1e3bb8"
  primary-disabled: "#c3cefb"
  brand-soft: "#eef1fe"
  ink: "#0a0a0a"
  body: "#52525b"
  body-strong: "#0a0a0a"
  muted: "#71717a"
  muted-soft: "#a1a1aa"
  hairline: "#e4e4e7"
  hairline-soft: "#f0f0f0"
  canvas: "#ffffff"
  surface-soft: "#fafafa"
  surface-card: "#ffffff"
  surface-strong: "#f4f4f5"
  surface-dark: "#0d0c0a"
  surface-dark-elevated: "#1a1815"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#a1a1aa"
  semantic-up: "#10b981"
  semantic-down: "#e5484d"
  accent-yellow: "#f5a623"
  info: "#2f54eb"

typography:
  display-lg:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.6px
  display-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.6px
  title-lg:
    fontFamily: "'Geist', sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: -0.2px
  title-md:
    fontFamily: "'Geist', sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: 0
  title-sm:
    fontFamily: "'Geist', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
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
    fontSize: 14px
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
    fontSize: 14px
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
  meta-mono:
    fontFamily: "'Geist Mono', 'SFMono-Regular', Consolas, Menlo, monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  eyebrow:
    fontFamily: "'Geist Mono', 'SFMono-Regular', Consolas, Menlo, monospace"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.04em
  number:
    fontFamily: "'Geist Mono', 'Geist', monospace"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  number-display:
    fontFamily: "'Geist Mono', 'Geist', monospace"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.5px
  button:
    fontFamily: "'Geist', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 0
  nav-link:
    fontFamily: "'Geist', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 10px
  pill: 4px
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
  section: 96px

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
The system is in the **Linear / Vercel / Resend** lineage: a white canvas
(near-black in dark mode), **cobalt** (`#2f54eb`) as the single brand **action**
color, cool neutral hairlines, and the remaining color reserved for status.

Type is **Geist** for every line of interface and display text, with **Geist Mono**
elevated to an identity signal — it carries eyebrows, metadata, agent labels, tool
lines, numbers, and code, giving the product its terminal-native voice. There is no
editorial serif: display moments use weighted Geist (600) with tight tracking.

Geometry is tight — 4px on buttons and badges, 6px on inputs, 8–10px on cards.
The 100px pill is retired. Depth comes from 1px hairline borders, not decorative
shadows.

**Key Characteristics:**
- Cobalt action: `{colors.primary}` (#2f54eb) carries every primary action — buttons, links, the focus ring, text selection, and the brand mark — and lifts to periwinkle (`#5b7cff`) on the dark canvas. `{colors.brand-soft}` (#eef1fe) is the matching tint for selected/active affordances. The brand hue is the action; it never bleeds into running text or neutral surfaces.
- Color = status: `{colors.semantic-up}`, `{colors.semantic-down}`, and `{colors.accent-yellow}` (green / amber / red) carry status as text, dots, and borders — never fills. The former info blue folds into the cobalt brand.
- Mono as signal: eyebrows, metadata, agent labels (`claude · action`), tool lines, timestamps, and numbers render in Geist Mono.
- Tight geometry: `{rounded.sm}` (4px) interactive, `{rounded.xl}` (10px) cards. Pills and large radii absent.
- Hairline depth: 1px `{colors.hairline}` borders over shadows; elevation is restrained.
- Weighted-sans display: Geist 600 with `-0.6px` tracking replaces the retired serif.

## Colors

### Action (cobalt brand)
- **Cobalt** (`{colors.primary}` — #2f54eb): The single brand action color — every primary button, link, the focus ring, text selection, the operator's message fill, and the brand mark. On the dark canvas it lifts to periwinkle (`#5b7cff`) with white text.
- **Cobalt Active** (`{colors.primary-active}` — #1e3bb8): Press/hover darken on the action fill.
- **Cobalt Disabled** (`{colors.primary-disabled}` — #c3cefb): Faded cobalt tint for disabled actions.
- **Brand Soft** (`{colors.brand-soft}` — #eef1fe): The cobalt tint token for selected/active affordances — selected rows, active nav, "running" pills.

### Status hues
- **Success** (`{colors.semantic-up}` — #10b981): positive status green — verdict approved, node ready. Text/dot/border only.
- **Danger** (`{colors.semantic-down}` — #e5484d): failures, reject, destructive. Text/dot/border only.
- **Warning** (`{colors.accent-yellow}` — #f5a623): attention dot only, never an action.
- **Info** (`{colors.info}` — #2f54eb): folded into the cobalt brand — neutral "info" dots and the Review mode chip now read in brand cobalt rather than a separate blue. Never a background fill.

### Surface
- **Canvas** (`{colors.canvas}` — #ffffff): The default page floor.
- **Surface Soft** (`{colors.surface-soft}` — #fafafa): Subtle cool tint — quotes, code, hover.
- **Surface Strong** (`{colors.surface-strong}` — #f4f4f5): Fills behind secondary buttons, search, avatars.
- **Surface Dark** (`{colors.surface-dark}` — #0d0c0a): The dark-mode canvas — warm near-black with a trace of amber lift off cold zinc. The featured-tier inversion fill uses the same token.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #1a1815): One step above the dark canvas for cards and floating chrome.

### Hairlines
- **Hairline** (`{colors.hairline}` — #e4e4e7): Default 1px divider and card border on white.
- **Hairline Soft** (`{colors.hairline-soft}` — #f0f0f0): Lighter divider.

### Text
- **Ink** (`{colors.ink}` — #0a0a0a): Display headings, primary copy, emphasis.
- **Body** (`{colors.body}` — #52525b): Default running text — cool neutral (zinc-600).
- **Muted** (`{colors.muted}` — #71717a): Sub-titles, secondary labels (zinc-500).
- **Muted Soft** (`{colors.muted-soft}` — #a1a1aa): Timestamps, disabled (zinc-400).
- **On Primary** (`{colors.on-primary}` — #ffffff): Text on the cobalt action fill — stays white in dark mode (white-on-cobalt, no inversion).
- **On Dark** (`{colors.on-dark}` — #ffffff): Text on dark surfaces.

## Typography

### Font Family
The system uses **Geist** for all interface and display text and **Geist Mono** as a
deliberate identity signal. **Lucide icons** handle product iconography. The editorial
serif is retired. Fallback stack: `-apple-system, BlinkMacSystemFont, "Segoe UI",
Helvetica, Arial, sans-serif` for sans; `"SFMono-Regular", Consolas, Menlo, monospace`
for mono.

Display is weighted Geist (600) with tight negative tracking — crisp and confident
rather than editorial. Mono carries the terminal-native voice: eyebrows, agent labels,
tool lines, timestamps, numbers, and code.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-lg}` | 34px | 600 | 1.08 | -0.6px | Admin page title, hero headline — Geist |
| `{typography.display-sm}` | 24px | 600 | 1.1 | -0.6px | Sub-section heads, empty-state display |
| `{typography.title-lg}` | 22px | 600 | 1.13 | -0.2px | Panel headings |
| `{typography.title-md}` | 18px | 600 | 1.33 | 0 | Component titles, chat header |
| `{typography.title-sm}` | 16px | 600 | 1.25 | 0 | List labels |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0 | Message bodies, inputs |
| `{typography.body-strong}` | 16px | 600 | 1.5 | 0 | Emphasized body |
| `{typography.body-sm}` | 14px | 400 | 1.5 | 0 | Default UI chrome |
| `{typography.caption}` | 13px | 400 | 1.5 | 0 | Captions, previews |
| `{typography.caption-strong}` | 12px | 600 | 1.5 | 0 | Badge labels |
| `{typography.label-strong}` | 14px | 600 | 1.4 | 0 | Bold chrome — row names, CTA labels, tab titles |
| `{typography.caption-strong-sm}` | 13px | 600 | 1.4 | 0 | Small bold labels, copy buttons |
| `{typography.label-md}` | 13px | 500 | 1.4 | 0 | Medium chrome — meta rows, timestamps (sans) |
| `{typography.label}` | 12px | 500 | 1.4 | 0 | Small medium chrome — counts, sub-meta |
| `{typography.micro-strong}` | 11px | 600 | 1.4 | 0 | Tiny bold — tabs, pills, agent chips |
| `{typography.meta-mono}` | 12px | 500 | 1.4 | 0 | Agent labels, tool lines, timestamps — Geist Mono |
| `{typography.eyebrow}` | 11px | 500 | 1.5 | 0.04em | Section kickers — Geist Mono |
| `{typography.number}` | 18px | 500 | 1.4 | 0 | Inline metrics, deltas — Geist Mono |
| `{typography.number-display}` | 36px | 500 | 1.1 | -0.5px | Admin metric values — Geist Mono |
| `{typography.button}` | 16px | 600 | 1.15 | 0 | Action labels |
| `{typography.nav-link}` | 14px | 500 | 1.4 | 0 | Nav items |

### Principles
- **Display is weighted sans.** Geist 600 with `-0.6px` tracking carries display moments; there is no serif.
- **Mono is the identity signal.** Eyebrows, agent labels, tool lines, timestamps, and numbers render in Geist Mono — the terminal-native voice.
- **Emphasis tops out at 600.** No 700+ weights anywhere.
- **Negative tracking on display only.** Display uses -0.5/-0.6px; body stays at 0.

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
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- **Card internal padding:** `{spacing.base}` (16px) for product cards; `{spacing.lg}` (24px) for marketing/pricing cards.

### Whitespace Philosophy
Calm but dense. Authenticated work surfaces are information-rich with tight rhythm;
marketing bands use the 96px section spacing. Density lives inside the product.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Most surfaces |
| Hairline border | 1px `{colors.hairline}` | Cards, rows, inputs — the default depth cue |
| Soft drop | `--shadow-soft` (`0 1px 2px rgba(0,0,0,0.04)`) | Bordered cards on hover |
| Lift | `--shadow-lift` (welded ring + drop) | Borderless floating chrome — drawers, dialogs, composer, tooltips |

Depth is carried by hairlines first. Pick `--shadow-soft` for a surface that already
has a 1px border; pick `--shadow-lift` for borderless floating chrome where the inner
ring stands in for the edge.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Reserved |
| `{rounded.xs}` | 2px | Inline tags |
| `{rounded.sm}` | 4px | Buttons, badges, send button |
| `{rounded.md}` | 6px | Inputs, popovers, avatars (rounded-square) |
| `{rounded.lg}` | 8px | Mid-size cards |
| `{rounded.xl}` | 10px | Cards, drawers, pricing tiers |
| `{rounded.pill}` | 4px | **Retired** — aliases `{rounded.sm}` so legacy consumers render tight |
| `{rounded.full}` | 9999px | Status dots and pips only |

Tight corners on interactive elements, 10px on containers, full circle reserved for
status dots. The pill is gone.

## Components

### Top Navigation
**`top-nav-light`** — Default top nav on white. Background `{colors.canvas}`, text `{colors.ink}`, height 60px. Wordmark left, menu center, search + actions right.

### Application Navigation
**`sidenav-panel`** — Authenticated app rail. White canvas, 1px hairline border, 48px square collapsed buttons, 38px labeled rows when expanded, rounded `{rounded.sm}`. Active route = quiet `{colors.surface-strong}` fill with ink text, no left bar or colored plate. Route order is **Threads → Workspace → Backlog → Routine**; admins additionally see **Channels** and **Admin** after a separator.

**Retired routes** — The standalone **MCP** and **Skills** pages are removed because they are not usable workflows. Do not reserve side-nav buttons, route-shell selectors, locale keys, or preview panels for them until they are rebuilt as real product surfaces.

### Buttons
**`button-primary`** — The cobalt action. Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}`, padding 8px × 16px, height 36px, rounded `{rounded.sm}` (4px). Lifts to periwinkle (`#5b7cff`) in dark mode, keeping white text.

**`button-primary-active`** — Press/hover. Background `{colors.primary-active}`.

**`button-primary-disabled`** — Neutral gray. Background `{colors.primary-disabled}`.

**`button-secondary`** — Soft-gray secondary. Background `{colors.surface-strong}`, text `{colors.ink}`, same geometry.

**`button-ghost`** — Transparent. Text `{colors.ink}`; surfaces a `{colors.surface-strong}` wash on hover.

**`link-inline`** — Inline link. Text `{colors.primary}` (cobalt) with an underline — links now read in the brand hue and stay underlined.

### Cards
**`card`** — The default container. Background `{colors.surface-card}`, 1px `{colors.hairline}` border, rounded `{rounded.xl}` (10px), padding 16px. Depth from the hairline, not a shadow.

**`card-soft`** — Quiet variant on `{colors.surface-soft}` for quotes, code blocks, and grouped content.

### Operational Surfaces
**`agent-turn`** — A message turn on the transcript rail. A square monochrome rail node (glyph shape, not vendor hue) marks the gutter; a mono `{typography.meta-mono}` eyebrow (`claude · action`) identifies the agent and mode; body in `{typography.body-md}`; tool lines in mono. One `●` marker per turn, `○` for thinking, `⏺` for tool/command lines. No surrounding card. Consecutive same-agent turns group and drop the repeated eyebrow.

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
- Reserve the other hues for status — `{colors.semantic-up}` / `{colors.semantic-down}` / `{colors.accent-yellow}`, as text/dots/borders.
- Render eyebrows, agent labels, tool lines, timestamps, and numbers in Geist Mono.
- Use tight radii: `{rounded.sm}` interactive, `{rounded.xl}` cards.
- Carry depth with 1px hairlines first; reach for shadows only on floating chrome.
- Render links in cobalt (`{colors.primary}`) with an underline.
- Use `--atmosphere-*` tokens sparingly on login, empty states, and admin hero tiles — controlled grain/wash, disabled in high-contrast mode.

### Don't
- Don't use a status color (green/amber/red) as an action — cobalt is the only action hue.
- Don't introduce a second brand hue or use status green/amber/red as general UI background fills.
- Don't use the pill (100px) or large radii on actions, inputs, or cards.
- Don't tint agent avatars with vendor brand colors — glyph shape carries identity.
- Don't bring back an editorial serif or 700+ display weights.
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
| `--text-2xs` | 11px | Compact metadata, mono eyebrows |
| `--text-xs` | 12px | Badges, timestamps, panel kickers |
| `--text-sm` | 13px | Captions, secondary UI |
| `--text-base` | 14px | Default UI chrome (buttons, nav, rows) |
| `--text-md` | 16px | Message bodies, inputs (≥16px avoids iOS zoom) |
| `--text-lg` | 18px | Chat header title, brand mark |
| `--text-xl` | 22px | Panel headings |
| `--text-2xl` | 28px | Empty-state display, mobile metric values |
| `--text-3xl` | 32px | Admin page title — **Geist 600** |
| `--text-4xl` | 36px | Admin metric values — **Geist Mono 500** |

The split between `--text-base` (14px chrome) and `--text-md` (16px prose) is
intentional. Use `--text-base` for buttons, row labels, nav, and metadata; use
`--text-md` for message bodies, composer text, and inputs. Display moments (≥28px)
reach for `var(--font-display)` — now weighted Geist, not a serif.

### Operational components

- **`messenger-shell`** — three-pane CSS grid (`sidenav | thread | chat`), with an optional fourth `drawer` column. Below 768px it collapses to one pane at a time.
- **Route shell** — top-level work pages collapse the thread pane to `sidenav | route`. Current full-page routes are `workspace`, `backlog`, `routine`, `channels`, and `admin`; route CSS should not include retired `mcp` or `skills` selectors.
- **`sidenav-panel`** — vertical rail, labeled by default. 48px square buttons (collapsed) / 38px labeled rows at `--radius-sm`; expands to 260px revealing `--type-nav-link` labels. Active route = a quiet neutral `{colors.surface-strong}` fill (no left bar). The visible route set is Threads, Workspace, Backlog, Routine, with Channels and Admin added for admins.
- **`thread-panel`** — conversation list grouped by state (Needs you → Running → Idle). Flat **68px** rows with name (`--text-base` / 600) and a 13px preview line. Active row = `{colors.brand-soft}` fill, **no left bar** (mirrors sidenav active). Separated by hairlines, not cards. The Needs-you section label stays muted; a leading warning dot carries the hue.
- **`chat-panel`** — message canvas. 18px ink header title; messages render on a continuous **rail** — a 1.5px hairline spine with square agent nodes and a circular ink node for the human. Block-grouped `.msg` units carry mono eyebrows. Depth from typography and the rail, not boxes.
- **`msg-user`** — the operator's voice **on the rail**. A filled circular ink node (agents stay square) plus a mono `YOU` eyebrow and timestamp; message body in 14px Geist medium, ink, no bubble and no cobalt fill. The human reads as a peer turn in the same spine as agents — attribution is node shape + eyebrow, not alignment or a messenger bubble.
- **`composer`** — bottom-pinned input. The **outer wrap** (`.composer-input-wrap`) carries `--shadow-lift`; the inner field is a flat textarea with no extra drop shadow. The send button is a **36×36px** rounded-square (`--radius-sm`) cobalt plate — flat, no gloss. The mode chip (Implement / Review) sits bottom-left with a leading status dot — `accent-yellow` for implement, brand cobalt (`info`) for review — never a colored chip fill.
- **`ac-*` (Admin Console)** — metric cards. Titles use `var(--font-display)` at `--text-3xl`; values use `--font-number` at `--text-4xl`. Cards are `--radius-xl`, hairline-bordered, lift on hover.
- **`adm-drawer`** — right-edge sheet. Light variant is white canvas; dark variant fills with `--color-surface-dark` and uses `--color-hairline-on-dark` for dividers.

### Focus, motion, dark mode
- **Focus ring** — every interactive surface uses `var(--ring-focus)`, a 3px cobalt-alpha halo. No ad-hoc 1px/2px outline variants. Destructive controls on focus may use a danger-alpha halo of the same geometry.
- **Status tone driver** — `tone-good` / `tone-info` / `tone-bad` / `tone-warn` / `tone-neutral` set a single `--tone` variable consumed by dots and outlined pills. `tone-info` maps to `--color-info`, which now resolves to the cobalt brand (info folded into brand).
- **Dark mode** — one definition, `html[data-theme="dark"]`, resolved before first paint. Canvas uses warm charcoal (`#0d0c0a` / `#1a1815` elevated). The action color lifts to periwinkle (`#5b7cff`) with white text; status hues are lifted for legibility on the dark canvas.
- **Motion** — canonical curves/durations on a shared shelf (`--ease-standard`, `--ease-out-quint`, `--ease-spring`). Precision favors `--ease-standard`; overshoot is used sparingly.

### Atmosphere (controlled exception)
Login, transcript empty, admin KPI hero, and `.relay-atmosphere` panels may read `--atmosphere-background` — a corner radial wash plus subtle grain from `--atmosphere-grain-*`. High-contrast themes disable grain and wash. This is the only approved decorative texture; do not invent new gradients elsewhere.

### Data visualization
The admin token-usage chart uses a fixed three-segment ramp that reuses existing tokens:
- **Input tokens** — `{colors.primary}` (cobalt)
- **Output tokens** — `{colors.semantic-up}` (green)
- **Cache tokens** — `{colors.muted-soft}` (neutral gray)

Fleet-health stacked bars and activity charts use the status tone ramp (`semantic-up` / `semantic-down` / `accent-yellow` / muted) **inside chart segments only**. Artifact kind accents (`--color-kind-*` in `tokens.css`) are a separate decorative chip palette mirrored from the TUI — not status, not action.

## Known Gaps
- Geist and Geist Mono are the default open-source font choices.
- Form validation states beyond focus are not fully specified.
