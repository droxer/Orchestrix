---
version: alpha
name: Relay-Monochrome
description: A Precision Monochrome design system (the Linear/Vercel school) for an agent-orchestration control plane. Flat near-white surfaces (white canvas by day; near-black #0a0a0a by night) carry the chrome; near-black ink (#111113) is the single ACTION color, inverting to white on the dark canvas. Hue is reserved for status alone — success, danger, and warning (green / amber / red) as dots, borders, and text, never fills or actions — and "info" is a neutral slate. One crisp grotesk (Geist) carries every text role — display, chrome, and body alike — with weight and tight display tracking doing the differentiating; Geist Mono is reserved for code. Base UI text is 13px. Geometry is tight: 5px on buttons and badges, 6px on inputs, 8–10px on cards; the pill is retired (aliases sm). Depth comes from hairline borders, not shadows. Motion is fast with no overshoot. The result reads as serious infrastructure software — a dense, calm control plane for AI agents.

colors:
  action: "#111113"
  action-active: "#2e2e33"
  action-disabled: "#d4d4d8"
  action-soft: "#ececee"
  ink: "#09090b"
  body: "#3f3f46"
  muted: "#71717a"
  muted-soft: "#a1a1aa"
  hairline: "#e4e4e7"
  hairline-soft: "#f0f0f1"
  canvas: "#ffffff"
  surface-soft: "#fafafa"
  surface-strong: "#f0f0f1"
  surface-raised: "#ffffff"
  surface-dark: "#18181b"
  surface-dark-elevated: "#232326"
  on-action: "#ffffff"
  on-dark: "#fafafa"
  on-dark-soft: "#9a9aa3"
  success: "#10b981"
  danger: "#ef4444"
  warning: "#f59e0b"
  info: "#71717a"

typography:
  display-lg:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -0.02em
  display-sm:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 25px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  title-lg:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.16
    letterSpacing: -0.02em
  title-md:
    fontFamily: "var(--font-app-sans), 'Geist', sans-serif"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: -0.02em
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
    fontFamily: "'Geist', sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  eyebrow:
    fontFamily: "'Geist', sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.05em
  number:
    fontFamily: "'Geist', sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  number-display:
    fontFamily: "'Geist', sans-serif"
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: -0.02em
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
  2xl: 12px
  3xl: 14px
  4xl: 16px
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
    height: 64px
  side-nav:
    backgroundColor: "{colors.surface-strong}"
    activeBackgroundColor: "{colors.action}"
    textColor: "{colors.body}"
    typography: "{typography.nav-link}"
    widthCollapsed: 72px
    widthExpanded: 228px
    itemSize: 46px
    rounded: "{rounded.lg}"
  authenticated-route-shell:
    backgroundColor: "{colors.canvas}"
    columns: "sidenav | thread | route"
    routes: "workspace, backlog, routine, channels, admin"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    height: "{size.control-md}"
  button-primary-active:
    backgroundColor: "{colors.action-active}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.sm}"
  button-primary-disabled:
    backgroundColor: "{colors.action-disabled}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    height: "{size.control-md}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  link-inline:
    backgroundColor: transparent
    textColor: "{colors.action}"
    decoration: underline
  card:
    backgroundColor: "{colors.surface-raised}"
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
    height: "{size.control-md}"
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
---

# Relay Design — Precision Monochrome

<p align="center">
  <img src="../assets/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

## Overview

Relay's visual language is **Precision Monochrome** — the Linear/Vercel
school of infrastructure software. Ink-on-white, near-monochrome zinc
neutrals, razor hairlines, tight geometry, and extreme restraint. There is
no brand hue: **black is the action color**, and every unit of chroma in the
interface is a unit of information.

**Ink** (`#111113`) is the single **action** color, inverting to white
(`#fafafa`) on the near-black (`#0a0a0a`) dark canvas — monochrome in both
directions. Hairlines carry structure instead of shadows. Color appears
*only* as status: green / amber / red as dots, borders, and text — never as
background fills, never as actions.

One crisp grotesk, **Geist**, carries every text role — display, chrome,
and body — with weight and tight display tracking (`-0.02em`) doing the
differentiating, never a family switch. **Geist Mono** stays reserved for
code-like content: tool/command lines, raw logs, code blocks, and IDs. Base
UI text is **13px**.

Geometry is tight: 5px on buttons and badges, 6px on inputs, 8–10px on
cards. The 100px pill stays retired (`{rounded.pill}` aliases
`{rounded.sm}`). Depth comes from 1px hairline borders first; shadows
(`--shadow-soft` / `--shadow-lift`) are reserved for floating chrome —
drawers, dialogs, the composer.

**Key characteristics:**
- Ink action: `{colors.action}` (#111113) carries every primary action — buttons, links, the focus ring, and text selection — and inverts to `#fafafa` on the dark canvas. `{colors.action-soft}` (#ececee) is the matching neutral wash for selected/active affordances. Action is achromatic; it never competes with status for attention.
- Color = status, and nothing else: success/danger/warning (green / amber / red) are carried as text, dots, and borders — never fills. "Info" is a neutral slate (`{colors.info}` #71717a). Every hue on screen means something.
- One sans, every role: Geist carries headlines, chrome, and body alike — weight (never past 600) separates emphasis, not a font-family switch. Geist Mono is reserved for tool/command lines, raw logs, code, and IDs.
- Tight geometry: `{rounded.sm}` (5px) interactive, `{rounded.xl}` (10px) cards — the precision-tool scale.
- Hairline depth: 1px `{colors.hairline}` borders over shadows; elevation is restrained.
- Fast motion, no overshoot: 120–160ms transitions on `--ease-standard`; the spring curve is retired (`--ease-spring` aliases the standard curve).
- The sidenav is themed, not pinned: it reads off the same `--color-semantic-*` surface tokens as the rest of the app and re-themes with light/dark, with the active route as a solid ink plate.

## Token architecture

Tokens live under `web/src/styles/tokens/` in four tiers, imported in order
by `web/src/styles/tokens.css` (a pure `@import` manifest — never add a
token there):

1. **`primitives.css`** — raw hex/px/rem values and nothing else. Two color
   registers (`:root` for light, `html[data-theme="dark"]` for dark) plus
   the theme-independent numeric scales (spacing, radii, type, tracking,
   leading, z-index, motion, shell dimensions). This is the *only* file
   allowed to contain a literal hex color or an `rgb()`/`hsl()` function —
   enforced by `web/.stylelintrc.json`. Named by what a color visually *is*
   (`--color-accent`, `--color-ink-900`, `--color-canvas-base`), not by
   what it's *for*.
2. **`semantic.css`** — role-based aliases consuming primitives, named by
   what they're *for*: `--color-semantic-action`, `--color-semantic-danger`,
   `--color-semantic-surface-raised`, plus composite `--type-*` typography
   shorthands, `--shadow-soft`/`--shadow-lift`, `--ring-focus`. Every
   `--color-semantic-*` token is a `var()` pointing at a primitive — never a
   raw value.
3. **`shadcn-bridge.css`** — the `@theme inline` block and the
   `--background`/`--foreground`/`--primary`/etc. variables shadcn/ui and
   Tailwind utilities (`bg-primary`, `text-muted-foreground`) consume. Every
   declaration here is a `var()` into `semantic.css` or `primitives.css`.
4. **`base.css`** — html/body reset, the `:focus-visible` contract, and the
   small set of shared utility classes (`.mono`, `.eyebrow`, `.tone-*`,
   `.kbd-hint`).

Because this whole reskin is a change of *values*, not *roles*, it lived
almost entirely in `primitives.css` (plus font loading in `app/layout.tsx`
and the pinned local palettes in `login.css` / `preferences.css`) —
`semantic.css` only renamed its accent aliases, and the ~28 component CSS
files outside `tokens/` were untouched.

**Naming rule:** component CSS only ever references a `--color-semantic-*`,
`--type-*`, `--shadow-*`, `--ring-*`, or a structural primitive (`--space-*`,
`--radius-*`, `--text-*`, `--font-*`) — never a raw hex value and never a
tier-1 primitive directly. If a value doesn't exist yet, add it to
`primitives.css` (if it's a new raw value) and/or `semantic.css` (if it's a
new role), not inline in a component file.

**Enforcement:** `web/.stylelintrc.json` bans hex/`rgb()`/`hsl()` literals
everywhere except `primitives.css`, with narrow documented overrides for
`login.css` (a pinned pre-auth dark ramp, independent of the authenticated
theme) and `preferences.css` (theme-swatch previews that must show both
themes simultaneously and can't resolve a single `var()`). Run
`npm run lint:css -w web`; it's also wired into `.pre-commit-config.yaml`.

**Documented, deliberate exceptions to "primitives.css is the only hex
source":**
- `login.css` — a local `--lg-*` token block pinning the pre-auth dark ramp, since no user theme preference is loaded yet (retuned to the monochrome dark register along with everything else).
- `preferences.css` — theme-swatch previews (`.pref-theme-swatch`).
- `artifact.css` — the frame-preview background is a literal white document page in every theme.
- `backlog.css` — the assignee avatar uses a procedurally generated per-identity `hsl(var(--avatar-hue))`, set inline by `TaskAssignee.tsx` from the assignee's name; there is no fixed primitive since the hue itself *is* the value.

## Colors

### Action, selection, and focus (ink)
- **Action** (`{colors.action}` — #111113): the single action color — primary buttons, links, the focus ring, and text selection. On the dark canvas it inverts to white (`#fafafa`) with near-black text (`#111113`).
- **Action Active** (`{colors.action-active}` — #2e2e33): press/hover lift.
- **Action Disabled** (`{colors.action-disabled}` — #d4d4d8): faded neutral for disabled actions.
- **Action Soft** (`{colors.action-soft}` — #ececee): neutral selection wash — selected rows, active nav, running-state affordances.

### Status hues
- **Success** (`{colors.success}` — #10b981): verdict approved, node ready. Text/dot/border only.
- **Danger** (`{colors.danger}` — #ef4444): failures, reject, destructive. Text/dot/border only. Text-safe counterpart `--color-semantic-danger-text` (#dc2626, ~4.5:1 on white).
- **Warning** (`{colors.warning}` — #f59e0b): attention dot only, never an action. Text-safe counterpart `--color-semantic-warning-text` (#8a5c00, ~4.8:1 on white) for status read as a word or numeral.
- **Info** (`{colors.info}` — #71717a): a neutral slate — status without alarm.

### Surface (flat near-white)
- **Canvas** (`{colors.canvas}` — #ffffff): the default page floor.
- **Surface Soft** (`{colors.surface-soft}` — #fafafa): subtle tint — quotes, code, hover.
- **Surface Strong** (`{colors.surface-strong}` — #f0f0f1): fills behind secondary buttons, search, avatars.
- **Surface Raised** (`{colors.surface-raised}` — #ffffff): modals, drawers, floating chrome — white with a hairline or lift shadow as the edge.
- **Surface Dark** (`{colors.surface-dark}` — #18181b): the always-dark register for chrome that stays dark even on the light theme (the always-dark diff viewer, some admin dark-mode chrome).

### Hairlines
- **Hairline** (`{colors.hairline}` — #e4e4e7): default 1px divider and card border.
- **Hairline Soft** (`{colors.hairline-soft}` — #f0f0f1): lighter divider.

### Text
- **Ink** (`{colors.ink}` — #09090b): headings, primary copy, emphasis.
- **Body** (`{colors.body}` — #3f3f46): default running text.
- **Muted** (`{colors.muted}` — #71717a): sub-titles, secondary labels.
- **Muted Soft** (`{colors.muted-soft}` — #a1a1aa): timestamps, disabled.
- **On Action** (`{colors.on-action}` — #ffffff): text on the ink fill in light mode; flips to near-black (#111113) in dark mode since the dark-mode fill is white.
- **On Dark** (`{colors.on-dark}` — #fafafa): text on always-dark fills in either theme.

## Typography

### Font Family
**Geist** (`--font-sans`, `--font-display` — both alias the same
`--font-app-sans` variable) carries every text role: display, chrome, and
body alike. It is a precision-drawn grotesk that stays legible from 12px
dense chrome through display headlines, so one variable font instance
covers the whole system — there is no separate editorial/chrome font
pairing. **Geist Mono** (`--font-mono`) is reserved for code-like content
only. **Lucide** icons handle product iconography. `--font-number` aliases
the same family so metric numerals read as part of the same voice, not
mono.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-lg}` | 34px | 600 | 1.05 | -0.02em | Hero headline (login, empty states) |
| `{typography.display-sm}` | 25px | 600 | 1.1 | -0.02em | Sub-section heads |
| `{typography.title-lg}` | 22px | 600 | 1.16 | -0.02em | Admin page title, chat title |
| `{typography.title-md}` | 19px | 600 | 1.24 | -0.02em | Component titles |
| `{typography.title-sm}` | 15px | 600 | 1.3 | 0 | List labels |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0 | Message bodies, inputs |
| `{typography.body-sm}` | 13px | 400 | 1.5 | 0 | Default UI chrome |
| `{typography.caption}` | 13px | 400 | 1.5 | 0 | Captions, previews |
| `{typography.caption-strong}` | 12px | 600 | 1.5 | 0 | Badge labels |
| `{typography.label-strong}` | 13px | 600 | 1.4 | 0 | Bold chrome — row names, CTA labels |
| `{typography.label-md}` | 13px | 500 | 1.4 | 0 | Medium chrome — meta rows, timestamps |
| `{typography.label}` | 12px | 500 | 1.4 | 0 | Small medium chrome |
| `{typography.micro-strong}` | 11px | 600 | 1.4 | 0 | Tiny bold — tabs, pills, agent chips |
| `{typography.meta}` | 12px | 500 | 1.4 | 0 | Agent labels, metadata, timestamps |
| `{typography.eyebrow}` | 11px | 500 | 1.5 | 0.05em | Section kickers (uppercase) |
| `{typography.number}` | 18px | 600 | 1.4 | 0 | Inline metrics, deltas (tabular) |
| `{typography.number-display}` | 30px | 600 | 1.14 | -0.02em | Admin metric values (tabular) |
| _(mono)_ | 12–13px | 400–500 | 1.5 | 0 | Tool/command lines, raw logs, code, IDs — Geist Mono |
| `{typography.button}` | 13px | 600 | 1.15 | 0 | Action labels |
| `{typography.nav-link}` | 13px | 500 | 1.4 | 0 | Nav items |

### Principles
- **One sans, every role.** Geist carries display, chrome, and body — weight is what separates emphasis, not a font-family switch.
- **Emphasis tops out at 600.** No 700+ weights anywhere.
- **13px is the base.** Chrome (buttons, nav, rows, labels) runs at 13px; prose and inputs stay 16px.
- **Display tracking is firm.** Headlines tighten to `-0.02em` — the precision look leans on tight display type; body stays neutral at 0.

### International Type (CJK)
The web app ships English plus Simplified (`zh-CN`) and Traditional (`zh-TW`)
Chinese. Geist and Geist Mono carry no Han glyphs, so the Chinese locales
fall through to system CJK fonts first (PingFang, HarmonyOS Sans/MiSans,
Microsoft YaHei/JhengHei), then **Noto Sans SC / Noto Sans TC**, loaded by
`next/font` with `preload: false`.
- **`:lang()` switching, not duplication.** `html:lang(zh-CN)` /
  `html:lang(zh-TW)` in `tokens/primitives.css` reorder the `--font-sans` /
  `--font-mono` stacks. `--font-display` aliases `--font-sans`, so
  retargeting sans also retargets display.
- CJK typographic corrections (zero tracking, looser leading) live in the
  same file; the reading-heavy `--type-body-*`/`--type-caption` overrides
  live in `tokens/semantic.css` since `html:lang()` beats `:root` on
  specificity regardless of import order.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 20px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 64px.
- **Control height:** `--size-control-md` (40px) — the standard height for inputs, dialog buttons, admin drawer fields, and dense rows.
- **Row rhythm:** the default `--space-row-y` is `{spacing.sm}` (12px) — Linear-dense; compact surfaces drop to `{spacing.xs}` (8px) via `[data-density="compact"]`.

### Whitespace Philosophy
Calm but dense. Authenticated work surfaces are information-rich with tight
rhythm.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Most surfaces |
| Hairline border | 1px `{colors.hairline}` | Cards, rows, inputs — the default depth cue |
| Soft drop | `--shadow-soft` | Bordered cards on hover |
| Lift | `--shadow-lift` | Borderless floating chrome — drawers, dialogs, composer, tooltips |

Both shadow tokens mix a neutral zinc ink tint (`--color-shadow-ink`,
`--color-shadow-ink-ring` in `primitives.css`) rather than pure black. Pick
`--shadow-soft` for a surface that already has a 1px border; pick
`--shadow-lift` for borderless floating chrome where the inner ring stands
in for the edge.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Flush joins (split panes, tree rows) |
| `{rounded.xs}` | 3px | Inline tags, tiny chips, micro accents |
| `{rounded.sm}` | 5px | Buttons, badges, send button |
| `{rounded.md}` | 6px | Inputs, popovers, search, conversation rows, avatars |
| `{rounded.lg}` | 8px | Mid-size cards, composer wrap, mobile sheets, sidenav buttons |
| `{rounded.xl}` | 10px | Cards, drawers, dialogs, empty states |
| `{rounded.2xl}`–`{rounded.4xl}` | 12–16px | Extended shadcn scale |
| `{rounded.pill}` | 5px | **Retired** — aliases `{rounded.sm}` |
| `{rounded.full}` | 9999px | Status dots, pips, circular icon buttons |

`sm`–`md` on interactive elements, `lg`–`xl` on containers. Use `50%` only
for true circles.

## Components

### Application Navigation
**`sidenav-panel`** — a themed rail (follows light/dark like every other
pane). 72px collapsed / 228px expanded, 46px square buttons, rounded
`{rounded.lg}`. Active route = a solid ink plate (white in dark mode) — the
one place the action color fills chrome.

### Buttons
**`button-primary`** — the ink action. Background `{colors.action}`, text
`{colors.on-action}`, type `{typography.button}` (13px/600), padding
8×16px, height `--size-control-md` (40px), rounded `{rounded.sm}` (5px).
Inverts to a white fill with near-black text in dark mode.

**`button-secondary`** — soft-neutral. Background `{colors.surface-strong}`,
text `{colors.ink}`, same geometry.

**`button-ghost`** — transparent, `{colors.surface-strong}` wash on hover.

**`link-inline`** — text `{colors.action}` with an underline.

### Cards
**`card`** — background `{colors.surface-raised}`, 1px `{colors.hairline}`
border, rounded `{rounded.xl}` (10px), padding 16px. Depth from the
hairline, not a shadow.

**`card-soft`** — quiet variant on `{colors.surface-soft}` for quotes, code
blocks, and grouped content.

### Operational Surfaces
**`agent-turn`** — a message turn on the transcript rail. A square
monochrome rail node marks the gutter; a sans `{typography.meta}` eyebrow
(`claude · action`) identifies the agent and mode; body in
`{typography.body-md}`; tool lines in mono. One `●` marker per turn, `○` for
thinking, `⏺` for tool/command lines.

**`avatar`** — rounded-square (`{rounded.md}`), 36px, `{colors.surface-strong}`
fill, ink glyph. Agents are differentiated by vendor glyph shape (via
`AgentMark`), never by vendor brand color.

### Forms
**`text-input`** — background `{colors.canvas}`, rounded `{rounded.md}`
(6px), padding 9×12px, height `--size-control-md` (40px), 1px hairline.
Focus adds `--ring-focus` (3px action-alpha halo).

**`search-input`** — background `{colors.surface-strong}`, rounded
`{rounded.md}`, height 38px.

### Tags & Badges
**`badge`** — outlined chip. Transparent fill, 1px `{colors.hairline}`, text
`{colors.body}`, type `{typography.caption-strong}`, rounded `{rounded.sm}`.

**`badge-mono`** — mono metadata chip (`3 agents`, counts). Transparent,
hairline, `{typography.eyebrow}`.

## Do's and Don'ts

### Do
- Use `{colors.action}` (ink) for actions; let it invert to white on the dark canvas.
- Use `{colors.action-soft}` for selected rows, active nav, and running-state affordances.
- Reserve hue for status — success/danger/warning as text/dots/borders; use the slate `{colors.info}` for neutral/info status.
- Render every text role in Geist; reserve Geist Mono for tool/command lines, raw logs, code, and IDs.
- Use token radii: `{rounded.sm}` (5px) interactive, `{rounded.xl}` (10px) cards.
- Carry depth with 1px hairlines first; reach for shadows only on floating chrome.
- Let the sidenav follow the active theme like every other pane — no permanently-dark island.
- Add new tokens to `tokens/primitives.css` (raw value) and `tokens/semantic.css` (role) — never inline a hex/`rgb()`/`hsl()` literal in a component file. `npm run lint:css -w web` enforces this.

### Don't
- Don't use a status color (green/amber/red) or the slate info as an action — ink is the only action color.
- Don't introduce a brand hue — the system is achromatic by design; every unit of chroma is a unit of information.
- Don't use status colors as general UI background fills.
- Don't use ad-hoc pixel radii — use `{rounded.*}` tokens.
- Don't tint agent avatars with vendor brand colors — glyph shape carries identity.
- Don't add overshoot/bounce to motion — `--ease-spring` is retired and aliases the standard curve.
- Don't reference a `tokens/primitives.css` value directly from component CSS — always go through a `--color-semantic-*` role in `tokens/semantic.css`.

## Operational Surfaces (in-product)

The in-product chat shell is operational and dense. Tokens live in
`web/src/styles/` and supersede marketing typography inside
`.messenger-shell`.

### Shell dimensions

| Token | Value | Use |
|---|---|---|
| `--sidenav-w` | 72px | Collapsed left rail |
| `--sidenav-w-open` | 228px | Expanded left rail |
| `--thread-w` | 318px | Conversation list (second pane) |
| `--header-h` | 64px | Chat panel top bar |

### Operational type scale

| Token | Size | Role |
|---|---|---|
| `--text-micro` | 10px | Minimap / abbreviations |
| `--text-2xs` | 11px | Compact metadata, sans eyebrows |
| `--text-xs` | 12px | Badges, timestamps, panel kickers |
| `--text-sm` | 13px | Captions, secondary UI |
| `--text-base` | 13px | Default UI chrome (buttons, nav, rows) |
| `--text-md` | 16px | Message bodies, inputs (≥16px avoids iOS zoom) |
| `--text-lg` | 18px | Chat header title, wordmark |
| `--text-xl` | 22px | Panel headings |
| `--text-2xl` | 24px | Empty-state display, mobile metric values |
| `--text-3xl` | 26px | Admin page title |
| `--text-4xl` | 30px | Admin metric values |

`--text-sm` and `--text-base` are both 13px — the scale is intentionally
compressed (Linear leans on weight/color for hierarchy, not size).

### Operational components

- **`messenger-shell`** — three-pane CSS grid (`sidenav | thread | chat`), with an optional fourth `drawer` column. Below 820px it collapses to one pane at a time.
- **`sidenav-panel`** — the themed rail (see above).
- **`thread-panel`** — conversation list, flat 70px rows. Active row = `--color-semantic-action-soft` fill.
- **`chat-panel`** — message canvas. Messages render on a continuous rail — a hairline spine with square agent nodes and a circular ink node for the human.
- **`composer`** — bottom-pinned input. The outer wrap carries `--shadow-lift`; the send button is a 36×36px rounded-square ink plate.
- **`ac-*` (Admin Console)** — metric cards. Titles use `var(--font-display)` at `--text-3xl`; values use `--font-number` at `--text-4xl`.
- **`adm-drawer`** — right-edge sheet on `--color-semantic-surface-raised`, hairline left border, optional layered stacking (`layer` prop deepens the scrim and scales underlay panels to 0.98). Slides in from the right on desktop; full-viewport takeover below 820px. Exit animation mirrors entrance (~150ms). Sticky **`adm-form-actions`** footer pins primary/cancel buttons while body scrolls.

  **Width tiers** (via `--adm-drawer-w`):

  | Width | Use |
  |---|---|
  | 420px | Simple CRUD — add employee/node, task/routine edit |
  | 520px | Complex admin — assign node, agent profile, manage agents, credentials |
  | 900px | Dual-pane viewers — artifact library |

- **`adm-drawer-section`** — inline grouped content (placements list, danger zone) with uppercase section title; distinct from the sticky footer.

### Focus, motion, dark mode
- **Focus ring** — every interactive surface uses `var(--ring-focus)`, a 3px action-alpha halo (a quiet gray ring in the monochrome system). Destructive controls use `--ring-focus-danger`.
- **Status tone driver** — `tone-good` / `tone-info` / `tone-bad` / `tone-warn` / `tone-neutral` set a single `--tone` variable consumed by dots and outlined pills.
- **Dark mode** — one definition per tier (`html[data-theme="dark"]` in `primitives.css` for raw values, in `semantic.css` for the handful of relationship changes), resolved before first paint via a pre-hydration script in `app/layout.tsx`.
- **Motion** — canonical curves/durations on a shared shelf (`--ease-standard`, `--ease-out-quint`, `--ease-emphasized`; `--ease-spring` is retired and aliases standard). Durations are Linear-fast (`--duration-fast` 120ms, `--duration-base` 160ms). Nothing overshoots.

### Data visualization
The admin token-usage chart uses a fixed three-segment ramp: input tokens =
`{colors.action}` (ink), output tokens = `{colors.success}` (green), cache
tokens = `{colors.muted-soft}` (neutral). Fleet-health stacked bars and
activity charts use the status tone ramp inside chart segments only.
Artifact kind accents (`--color-kind-*` in `tokens/primitives.css`) are a
separate decorative chip palette mirrored from the TUI — not status, not
action; unchanged by this reskin.

## Known Gaps
- Geist and Geist Mono are the current font choices; no alternates are
  configured.
- Form validation states beyond focus are not fully specified.
- `docs/design-system-preview.html` is a static preview file that predates
  this rewrite and has not been regenerated against the current token
  values — treat it as stale until refreshed in a follow-up pass.
