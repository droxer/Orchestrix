---
version: alpha
name: Relay-design
description: A precision/technical design system for an agent-orchestration control plane, in the Linear / Vercel / Resend lineage. The canvas is white (near-black in dark mode); near-black ink is the single ACTION color and inverts to white-on-black in dark mode. Color is reserved exclusively for status — success, danger, warning, and a single info blue — and is never used for actions or decoration. Type is Geist for all interface and display text (display is weighted Geist at 600 with tight tracking, not an editorial serif), with Geist Mono as a deliberate identity signal carrying eyebrows, metadata, agent labels, tool lines, numbers, and code. Geometry is tight: 6px on buttons and badges, 8px on inputs, 10–12px on cards; the pill is retired. Depth comes from hairline borders, not shadows. The result reads as serious engineering tooling — calm, dense, monochrome, terminal-native.

colors:
  primary: "#0a0a0a"
  primary-active: "#27272a"
  primary-disabled: "#d4d4d8"
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
  surface-dark: "#0b0b0d"
  surface-dark-elevated: "#111114"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#a1a1aa"
  semantic-up: "#10b981"
  semantic-down: "#e5484d"
  accent-yellow: "#f5a623"
  info: "#3b82f6"

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
  xs: 3px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  pill: 6px
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
    textColor: "{colors.ink}"
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

Relay reads like serious engineering tooling — precise, dense, and almost
entirely monochrome. The system is in the **Linear / Vercel / Resend** lineage:
a white canvas (near-black in dark mode), near-black ink as the single **action**
color, cool neutral hairlines, and color reserved strictly for status.

Type is **Geist** for every line of interface and display text, with **Geist Mono**
elevated to an identity signal — it carries eyebrows, metadata, agent labels, tool
lines, numbers, and code, giving the product its terminal-native voice. There is no
editorial serif: display moments use weighted Geist (600) with tight tracking.

Geometry is tight — 6px on buttons and badges, 8px on inputs, 10–12px on cards.
The 100px pill is retired. Depth comes from 1px hairline borders, not decorative
shadows.

**Key Characteristics:**
- Monochrome action: `{colors.primary}` (#0a0a0a) carries every primary action and inverts to white-on-black (`#f4f4f5`) in dark mode. No brand hue.
- Color = status only: `{colors.semantic-up}`, `{colors.semantic-down}`, `{colors.accent-yellow}`, and `{colors.info}` are the only hues on screen — text, dots, and borders, never fills, never actions.
- Mono as signal: eyebrows, metadata, agent labels (`claude · action`), tool lines, timestamps, and numbers render in Geist Mono.
- Tight geometry: `{rounded.sm}` (6px) interactive, `{rounded.xl}` (12px) cards. Pills and large radii absent.
- Hairline depth: 1px `{colors.hairline}` borders over shadows; elevation is restrained.
- Weighted-sans display: Geist 600 with `-0.6px` tracking replaces the retired serif.

## Colors

### Action (monochrome)
- **Ink** (`{colors.primary}` — #0a0a0a): The single action color — every primary button, the strongest text. In dark mode it inverts to near-white (`#f4f4f5`) with ink text.
- **Ink Active** (`{colors.primary-active}` — #27272a): Press/hover darken on the action fill.
- **Ink Disabled** (`{colors.primary-disabled}` — #d4d4d8): Neutral gray for disabled actions.

### Status — the only hues
- **Success** (`{colors.semantic-up}` — #10b981): positive status green — verdict approved, node ready. Text/dot/border only.
- **Danger** (`{colors.semantic-down}` — #e5484d): failures, reject, destructive. Text/dot/border only.
- **Warning** (`{colors.accent-yellow}` — #f5a623): attention dot only, never an action.
- **Info** (`{colors.info}` — #3b82f6): the sole surviving blue — neutral "info" status dots and the Review mode chip. Status-only; never an action or link color.

### Surface
- **Canvas** (`{colors.canvas}` — #ffffff): The default page floor.
- **Surface Soft** (`{colors.surface-soft}` — #fafafa): Subtle cool tint — quotes, code, hover.
- **Surface Strong** (`{colors.surface-strong}` — #f4f4f5): Fills behind secondary buttons, search, avatars.
- **Surface Dark** (`{colors.surface-dark}` — #0b0b0d): The dark-mode canvas and the featured-tier inversion fill.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #111114): One step above the dark canvas for cards.

### Hairlines
- **Hairline** (`{colors.hairline}` — #e4e4e7): Default 1px divider and card border on white.
- **Hairline Soft** (`{colors.hairline-soft}` — #f0f0f0): Lighter divider.

### Text
- **Ink** (`{colors.ink}` — #0a0a0a): Display headings, primary copy, emphasis.
- **Body** (`{colors.body}` — #52525b): Default running text — cool neutral (zinc-600).
- **Muted** (`{colors.muted}` — #71717a): Sub-titles, secondary labels (zinc-500).
- **Muted Soft** (`{colors.muted-soft}` — #a1a1aa): Timestamps, disabled (zinc-400).
- **On Primary** (`{colors.on-primary}` — #ffffff): Text on the ink action fill (flips to #0a0a0a in dark mode).
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
| `{rounded.xs}` | 3px | Inline tags |
| `{rounded.sm}` | 6px | Buttons, badges, send button |
| `{rounded.md}` | 8px | Inputs, popovers, avatars (rounded-square) |
| `{rounded.lg}` | 10px | Mid-size cards |
| `{rounded.xl}` | 12px | Cards, drawers, pricing tiers |
| `{rounded.pill}` | 6px | **Retired** — aliases `{rounded.sm}` so legacy consumers render tight |
| `{rounded.full}` | 9999px | Status dots and pips only |

Tight corners on interactive elements, 12px on containers, full circle reserved for
status dots. The pill is gone.

## Components

### Top Navigation
**`top-nav-light`** — Default top nav on white. Background `{colors.canvas}`, text `{colors.ink}`, height 60px. Wordmark left, menu center, search + actions right.

### Buttons
**`button-primary`** — The ink action. Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}`, padding 8px × 16px, height 36px, rounded `{rounded.sm}` (6px). Inverts to white-on-black in dark mode.

**`button-primary-active`** — Press/hover. Background `{colors.primary-active}`.

**`button-primary-disabled`** — Neutral gray. Background `{colors.primary-disabled}`.

**`button-secondary`** — Soft-gray secondary. Background `{colors.surface-strong}`, text `{colors.ink}`, same geometry.

**`button-ghost`** — Transparent. Text `{colors.ink}`; surfaces a `{colors.surface-strong}` wash on hover.

**`link-inline`** — Inline link. Text `{colors.ink}` with an underline — links are disambiguated by underline, not hue.

### Cards
**`card`** — The default container. Background `{colors.surface-card}`, 1px `{colors.hairline}` border, rounded `{rounded.xl}` (12px), padding 16px. Depth from the hairline, not a shadow.

**`card-soft`** — Quiet variant on `{colors.surface-soft}` for quotes, code blocks, and grouped content.

### Operational Surfaces
**`agent-turn`** — A message turn. A mono `{typography.meta-mono}` eyebrow (`claude · action`) identifies the agent and mode; body in `{typography.body-md}`; tool lines in mono. One `●` marker per turn, `○` for thinking, `⏺` for tool/command lines. No surrounding card.

**`review-card`** — Codex review result. `{colors.surface-soft}` fill, 1px hairline, mono title, verdict word colored by status (`{colors.semantic-up}` approved / `{colors.semantic-down}` rejected).

**`status-up-cell`** + **`status-down-cell`** — Inline status cells. Color-only text in `{typography.number}`, no background fill.

**`avatar`** — Employee and agent avatars. Rounded-square (`{rounded.md}`), 36px, `{colors.surface-strong}` fill, ink glyph. Agents are differentiated by their vendor glyph shape (via `AgentMark`), **not** by color — the monochrome rule applies. A corner status pip (`{rounded.full}`) carries tone.

### Forms
**`text-input`** — Background `{colors.canvas}`, rounded `{rounded.md}` (8px), padding 9px × 12px, height 40px, 1px hairline. Focus adds `--ring-focus` (3px ink-alpha halo).

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
- Use `{colors.primary}` (ink) for actions; let it invert to white-on-black in dark mode.
- Reserve color for status only — `{colors.semantic-up}` / `{colors.semantic-down}` / `{colors.accent-yellow}` / `{colors.info}`, as text/dots/borders.
- Render eyebrows, agent labels, tool lines, timestamps, and numbers in Geist Mono.
- Use tight radii: `{rounded.sm}` interactive, `{rounded.xl}` cards.
- Carry depth with 1px hairlines first; reach for shadows only on floating chrome.
- Disambiguate links with an underline, not a hue.

### Don't
- Don't reintroduce a brand accent hue or use any status color as an action.
- Don't use status green/red/blue as a background fill.
- Don't use the pill (100px) or large radii on actions, inputs, or cards.
- Don't tint agent avatars with vendor brand colors — glyph shape carries identity.
- Don't bring back an editorial serif or 700+ display weights.
- Don't add decorative gradients/gloss — surfaces are flat.

## Operational Surfaces (in-product)

The in-product chat shell is operational and dense. It inherits the primitives above
and adds a tighter scale tuned for an authenticated three-pane Slack-style canvas. The
tokens below live in `web/src/styles/` and supersede marketing typography inside
`.messenger-shell`.

### Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 64px | Collapsed left rail |
| `--sidenav-w-open` | 200px | Expanded left rail |
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
- **`sidenav-panel`** — vertical icon rail. 44px square buttons at `--radius-xs`; expands to 200px on hover/focus revealing `--type-nav-link` labels.
- **`thread-panel`** — conversation list. Flat 68px rows with a rounded-square avatar, name (`--text-base` / 600), and a 13px preview line. Separated by hairlines, not cards.
- **`chat-panel`** — message canvas. 18px ink header title; messages render as block-grouped `.msg` units with mono eyebrows. Depth from typography, not boxes.
- **`composer`** — bottom-pinned input. Outer wrap uses `--shadow-lift`; inner field is a flat textarea. The send button is a 36px rounded-square (`--radius-sm`) ink plate — flat, no gloss. The mode chip (Implement / Review) sits bottom-left with a leading status dot — `accent-yellow` for implement, `info` blue for review — never a colored fill.
- **`ac-*` (Admin Console)** — metric cards. Titles use `var(--font-display)` at `--text-3xl`; values use `--font-number` at `--text-4xl`. Cards are `--radius-xl`, hairline-bordered, lift on hover.
- **`adm-drawer`** — right-edge sheet. Light variant is white canvas; dark variant fills with `--color-surface-dark` and uses `--color-hairline-on-dark` for dividers.

### Focus, motion, dark mode
- **Focus ring** — every interactive surface uses `var(--ring-focus)`, a 3px ink-alpha halo. No ad-hoc 1px/2px variants.
- **Status tone driver** — `tone-good` / `tone-info` / `tone-bad` / `tone-warn` / `tone-neutral` set a single `--tone` variable consumed by dots and outlined pills. `tone-info` maps to `--color-info` (blue), never the ink action color.
- **Dark mode** — one definition, `html[data-theme="dark"]`, resolved before first paint. The action color inverts to near-white with ink text; status hues are lifted for legibility on the dark canvas.
- **Motion** — canonical curves/durations on a shared shelf (`--ease-standard`, `--ease-out-quint`, `--ease-spring`). Precision favors `--ease-standard`; overshoot is used sparingly.

## Known Gaps
- Geist and Geist Mono are the default open-source font choices.
- Data-viz beyond the token-usage chart (input ink / output green / cache gray) is not yet specified; charts may need a small, deliberate categorical ramp that stays distinct from status hues.
- Form validation states beyond focus are not fully specified.
