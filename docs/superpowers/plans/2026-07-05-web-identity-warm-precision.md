# Relay Web "Warm Precision" Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Relay web UI's visual identity from cold precision (white/zinc/cobalt/Geist) to Warm Precision (ecru/stone/deep-teal/Instrument Sans) per `docs/superpowers/specs/2026-07-05-web-identity-warm-precision-design.md`.

**Architecture:** Almost everything lands in `web/src/styles/tokens.css` (three-tier token system: primitives → semantic → shadcn bridge) plus the font loader in `web/src/app/layout.tsx`. Component CSS changes only for the density rhythm, the theme-preview swatches, and the two new signature moments. Each task ends with a green build and existing tests.

**Tech Stack:** Next.js 16 (static export), Tailwind 4 via `@theme inline` bridge, `next/font/google`, plain CSS token files.

## Global Constraints

- **Do NOT create git commits.** The user commits manually (global user rule). Every "commit" checkpoint below is a *pause point*: report the diff summary and let the user commit.
- Build: `npm run build -w web` (run from repo root). Must pass after every task.
- Tests: `make web-test` (run from repo root). Must pass after every task.
- Node ≥ 22.19 required.
- Hex values live **only** in `tokens.css` primitives (and the deliberate theme-preview swatches in `preferences.css`). Never introduce new literal colors in component CSS.
- Geist Mono is retained everywhere; only the sans family changes.
- The dev server for visual checks is `make web` (http://127.0.0.1:3000, proxies API to the backend). Screenshots are the acceptance evidence for visual steps.

---

### Task 1: Font swap — Instrument Sans in, Geist sans out

**Files:**
- Modify: `web/src/app/layout.tsx` (font imports, lines ~1–35)
- Modify: `web/src/styles/tokens.css` (`--font-sans` stack line ~252, tracking tokens lines ~267–268, zh-CN/zh-TW blocks lines ~413–421)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: CSS variable `--font-app-sans` (replaces `--font-geist`); `--font-geist-mono` unchanged. All later tasks assume `--font-sans` resolves to Instrument Sans.

- [ ] **Step 1: Swap the font import in `layout.tsx`**

Replace the `Geist` import and instance (keep `Geist_Mono`, `Noto_Sans_SC`, `Noto_Sans_TC` exactly as they are):

```tsx
import {
  Geist_Mono,
  Instrument_Sans,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from "next/font/google";
```

```tsx
// Warm precision system — Instrument Sans carries UI and display text
// with humanist warmth; Geist Mono stays as the identity signal for
// eyebrows, metadata, agent labels, numbers, and code. latin-ext widens
// coverage to accented European/Vietnamese names in employee and
// sandbox labels.
const appSans = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-app-sans",
  display: "swap",
  weight: "variable",
});
```

Update the `<html>` className: `` className={`${appSans.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`} ``.

- [ ] **Step 2: Update the font stacks and tracking in `tokens.css`**

In `:root` (~line 252):

```css
--font-sans: var(--font-app-sans), "Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
```

(`--font-display` already aliases `--font-sans`; `--font-mono` unchanged.)

Tracking retune for Instrument's wider letterforms (~lines 267–268):

```css
--letter-display: -0.4px;        /* was -0.6px */
--letter-display-strong: -0.35px; /* was -0.5px */
```

In the `html:lang(zh-CN)` and `html:lang(zh-TW)` blocks, replace `var(--font-geist)` with `var(--font-app-sans)` in the `--font-sans` lines (the `--font-mono` lines keep `var(--font-geist-mono)`).

- [ ] **Step 3: Verify no `--font-geist` (sans) references remain**

Run: `grep -rn "font-geist\b" web/src --include="*.css" --include="*.tsx" | grep -v "font-geist-mono"`
Expected: no output.

- [ ] **Step 4: Build + tests**

Run: `npm run build -w web && make web-test`
Expected: both pass.

- [ ] **Step 5: Visual check + pause for user commit**

Load the login page in the dev server; headings and body must render in Instrument Sans (visibly rounder a/g than Geist), mono metadata unchanged. Report the diff; user commits (`feat: swap web sans to Instrument Sans`).

---

### Task 2: Light-theme primitives — warm neutrals + deep teal

**Files:**
- Modify: `web/src/styles/tokens.css` (`:root` primitives, lines ~120–180)
- Modify: `web/src/styles/preferences.css` (theme-preview swatches, lines ~344–372)

**Interfaces:**
- Consumes: nothing.
- Produces: the new light palette. Tasks 3–5 assume these exact hex values.

- [ ] **Step 1: Swap the `:root` primitives in `tokens.css`**

Action colors (replace the cobalt block):

```css
--color-primary: #115e59;
--color-primary-active: #0d4a45;
--color-primary-disabled: #b5d6d1;
```

(`--color-brand-soft` is a `color-mix` recipe off `--color-primary` — leave it; it re-derives automatically.)

Text ramp (zinc → warm stone):

```css
--color-ink: #171412;
--color-body: #57534e;
--color-muted: #79716b;
--color-muted-soft: #a8a29e;
```

Surfaces:

```css
--color-canvas: #fdfcfa;
--color-surface-card: #fdfcfa;
--color-surface-soft: #faf8f4;
--color-surface-strong: #f5f2ec;
--color-surface-raised: #fdfcfa;
```

Hairlines:

```css
--color-hairline: #eae5dd;
--color-hairline-soft: #f1ede6;
```

Status — retune success away from the teal action; amber/red unchanged:

```css
--color-semantic-up: #15803d;
```

Leave `--color-semantic-down`, `--color-accent-yellow`, `--color-warning-text`, `--color-danger-text`, and the `--color-kind-*` accents as-is (the ecru canvas is near-white; existing contrast ratios hold — re-verified in Task 6). `--color-info` already aliases `--color-primary` and folds into teal automatically.

- [ ] **Step 2: Update the theme-preview swatches in `preferences.css`**

These are deliberate literal swatches for the theme-picker preview cards. Update the light values (~lines 344–348): `--preview-list: #faf8f4`, `--preview-card: #f5f2ec`, `--preview-line: #eae5dd`, `--preview-action: #115e59`. Dark preview (~line 363): `--preview-action: #2dd4bf`. System preview (~lines 368–372): swap the same four light-side literals inside the gradients/mixes (`#fafafa → #faf8f4`, `#f4f4f5 → #f5f2ec`, `#e4e4e7 → #eae5dd`, `#0a0a0a → #171412`, `#2f54eb → #115e59`).

- [ ] **Step 3: Verify no stray cobalt/zinc literals**

Run: `grep -rn "2f54eb\|1e3bb8\|c3cefb\|#e4e4e7\|#f4f4f5\|#fafafa" web/src --include="*.css"`
Expected: no output.

- [ ] **Step 4: Build + tests**

Run: `npm run build -w web && make web-test`
Expected: both pass.

- [ ] **Step 5: Visual check + pause for user commit**

Login page, light theme: ecru canvas, teal primary button, warm hairlines. Confirm the disabled sign-in button reads as tinted teal, not grey. User commits (`feat: warm-precision light palette`).

---

### Task 3: Dark + high-contrast themes

**Files:**
- Modify: `web/src/styles/tokens.css` (`html[data-theme="dark"]` ~lines 427–501, `html[data-theme="contrast"]` ~506–556, `html[data-theme="contrast-dark"]` ~563–613)

**Interfaces:**
- Consumes: light palette from Task 2 (dark surfaces already share its warm temperature).
- Produces: complete four-theme teal palette.

- [ ] **Step 1: Dark theme action block**

Replace the periwinkle block in `html[data-theme="dark"]`:

```css
/* Action — deep teal lifts to luminous teal on the dark canvas. The fill
   is bright, so on-primary flips to near-black (white fails WCAG on
   #2dd4bf); the ::selection and CTA rules inherit this automatically. */
--color-primary: #2dd4bf;
--color-primary-active: #5eead4;
--color-primary-disabled: color-mix(in srgb, #2dd4bf 30%, var(--color-surface-dark));
--color-on-primary: #04201c;
```

Retune dark success to track the new grass-green: `--color-semantic-up: #34d399;` and `--color-kind-review: #34d399;`. Leave the warm charcoal surfaces, text ramp, hairlines, shadows, scrim, and atmosphere exactly as they are — they already match the warm temperature.

- [ ] **Step 2: High-contrast (light) action block**

In `html[data-theme="contrast"]`:

```css
--color-primary: #0f4c47;
--color-primary-active: #0a3733;
--color-primary-disabled: #9ec7c2;
--color-on-primary: #ffffff;
--color-brand-soft: #e0f2ef;
```

- [ ] **Step 3: High-contrast (dark) action block**

In `html[data-theme="contrast-dark"]`:

```css
--color-primary: #5eead4;
--color-primary-active: #99f6e4;
--color-primary-disabled: #2d5a54;
--color-on-primary: #000000;
--color-brand-soft: rgba(94, 234, 212, 0.18);
```

- [ ] **Step 4: Contrast spot-check**

Verify ratios (e.g. https://webaim.org/resources/contrastchecker/ or a local script): `#04201c` on `#2dd4bf` ≥ 4.5, `#ffffff` on `#115e59` ≥ 4.5, `#ffffff` on `#0f4c47` ≥ 7, `#000000` on `#5eead4` ≥ 7.
Expected: all pass (they do by design; record the numbers).

- [ ] **Step 5: Build + tests + visual check + pause for user commit**

Run: `npm run build -w web && make web-test`. Toggle dark and both contrast themes on the login page: teal CTA with dark text on dark theme, no washed-out disabled states. User commits (`feat: warm-precision dark + contrast themes`).

---

### Task 4: Geometry + relaxed density

**Files:**
- Modify: `web/src/styles/tokens.css` (radii ~lines 209–215, `--leading-loose` ~line 262, new `--space-row-y` token + compact override block)
- Modify: `web/src/styles/thread.css` (`.conversation-row-inner` padding, line ~123)
- Modify: `web/src/styles/chat.css` (`.msg-user .user-text` line-height, line ~423)
- Modify: `web/src/styles/agent-stream.css` (prose line-heights)
- Modify: `web/src/components/BacklogPage.tsx`, `web/src/components/AdminConsole.tsx` (compact density attribute)

**Interfaces:**
- Consumes: nothing.
- Produces: `--space-row-y` token (relaxed 16px / compact 12px) and the `[data-density="compact"]` contract for any future dense surface.

- [ ] **Step 1: Radii bump in `tokens.css`**

```css
--radius-xs: 2px;   /* unchanged */
--radius-sm: 6px;   /* was 4px */
--radius-md: 8px;   /* was 6px */
--radius-lg: 10px;  /* was 8px */
--radius-xl: 12px;  /* was 10px */
```

- [ ] **Step 2: Rhythm tokens + compact escape hatch in `tokens.css`**

Change `--leading-loose: 1.6` → `1.65`. Next to the spacing scale add:

```css
/* Row rhythm — relaxed default; dense surfaces opt back down via
   [data-density="compact"] on their subtree root. */
--space-row-y: var(--space-base); /* 16px relaxed row vertical padding */
```

After the `:root` block (before the zh-CN rule) add:

```css
/* Density escape hatch — data-dense surfaces (admin tables, backlog
   board) restore the compact rhythm for their subtree. One override
   block; never fork per component. */
[data-density="compact"] {
  --leading-loose: 1.5;
  --space-row-y: var(--space-sm); /* 12px */
}
```

- [ ] **Step 3: Consume the row token in `thread.css`**

`.conversation-row-inner` (line ~123): `padding: var(--space-sm) var(--space-base);` → `padding: var(--space-row-y) var(--space-base);`.

- [ ] **Step 4: Message prose moves to `--leading-loose`**

- `chat.css` `.msg-user .user-text` (~line 423): `line-height: 1.5;` → `line-height: var(--leading-loose);`
- `agent-stream.css`: at lines 17, 88, 172, 208, 217, 315 the rules carry `line-height: 1.5`/`1.55`. For each, if the rule styles agent message/prose text (paragraphs, streamed text), replace with `line-height: var(--leading-loose);`. Leave line 57 (`1.3`, compact chrome) and any rule styling single-line labels/tool chips untouched. Criterion: multi-line reading text gets the token; single-line chrome does not.

- [ ] **Step 5: Mark the dense surfaces compact**

- `BacklogPage.tsx`: add `data-density="compact"` to the page's root element (the outermost wrapper the component returns).
- `AdminConsole.tsx`: add `data-density="compact"` to the admin shell root element.
Locate the roots with: `grep -n "return (" web/src/components/BacklogPage.tsx web/src/components/AdminConsole.tsx | head -4` and confirm the first JSX element of each.

- [ ] **Step 6: Build + tests + visual check + pause for user commit**

Run: `npm run build -w web && make web-test`. Dev-server check: thread rows visibly taller, chat prose airier, backlog board and admin tables unchanged (compact). Corners read slightly softer everywhere. User commits (`feat: relaxed rhythm + softened radii with compact escape hatch`).

---

### Task 5: Signature moments — warm wash + bled mark on transcript empty and KPI hero

**Files:**
- Modify: `web/src/styles/tokens.css` (`--atmosphere-wash` light value, ~line 317)
- Modify: `web/src/styles/empty-state.css` (new `.relay-bleed-mark` rule)
- Modify: `web/src/components/RelayEmptyState.tsx` (optional `mark` prop)
- Modify: `web/src/components/TranscriptEmpty.tsx` (pass `mark`)
- Modify: `web/src/components/admin/dashboard/DashboardView.tsx` (mark span in KPI band, ~line 42)

**Interfaces:**
- Consumes: warm palette (Task 2).
- Produces: `.relay-bleed-mark` class and `RelayEmptyState`'s `mark?: boolean` prop.

- [ ] **Step 1: Warm the light atmosphere wash in `tokens.css`**

```css
--atmosphere-wash: radial-gradient(
  ellipse 90% 70% at 100% 0%,
  color-mix(in srgb, #b0995f 7%, transparent),
  transparent 65%
);
```

(The dark theme already overrides with its own warm `#e8dcc8` wash — leave it.)

- [ ] **Step 2: Shared bled-mark rule in `empty-state.css`**

The login watermark lives on `.login-atmosphere::before`; `.relay-atmosphere::before` is taken by grain and `.adm-dash-kpis::after` by the hairline grid, so the shared mark is a real element:

```css
/* Bled "R" mark — the login signature extended to other atmosphere
   surfaces. Rendered as an element (not a pseudo) because both
   pseudo-elements of .relay-atmosphere hosts are already in use. */
.relay-bleed-mark {
  position: absolute;
  right: -0.12em;
  bottom: -0.28em;
  z-index: -1;
  font-family: var(--font-display);
  font-size: clamp(160px, 24vw, 320px);
  font-weight: 400;
  line-height: 1;
  color: color-mix(in srgb, var(--color-ink) 5%, transparent);
  pointer-events: none;
  user-select: none;
}

html[data-theme="dark"] .relay-bleed-mark {
  color: color-mix(in srgb, var(--color-ink) 3%, transparent);
}

html[data-theme="contrast"] .relay-bleed-mark,
html[data-theme="contrast-dark"] .relay-bleed-mark {
  display: none;
}
```

- [ ] **Step 3: `RelayEmptyState` grows a `mark` prop**

Add `mark?: boolean` (default `false`) to `RelayEmptyStateProps` and, as the first child of the `<section>`:

```tsx
{mark ? (
  <span className="relay-bleed-mark" aria-hidden="true">R</span>
) : null}
```

`TranscriptEmpty.tsx`: add `mark` alongside the existing `atmosphere` prop.

- [ ] **Step 4: KPI hero mark in `DashboardView.tsx`**

Inside the `<section className="adm-dash-kpis relay-atmosphere" …>` add the same span as its first child:

```tsx
<span className="relay-bleed-mark" aria-hidden="true">R</span>
```

(`.adm-dash-kpis` already has `position: relative; isolation: isolate;` so the negative z-index stays inside the band; tiles sit at `z-index: 1`.)

- [ ] **Step 5: Build + tests + visual check + pause for user commit**

Run: `npm run build -w web && make web-test`. Dev check: transcript empty state and admin KPI band each show the whispered "R" bleeding from the corner in light + dark; high-contrast shows none; the mark never overlaps legible text. User commits (`feat: extend signature atmosphere moments`).

---

### Task 6: Verification pass + DESIGN_REVIEW update

**Files:**
- Modify: `web/DESIGN_REVIEW.md` (append a dated section)

**Interfaces:**
- Consumes: everything above.
- Produces: recorded evidence; no code.

- [ ] **Step 1: Full build + test sweep**

Run: `npm run build -w web && make web-test && npm test`
Expected: all green (the root `npm test` also runs the Python backend suite; unrelated failures there should be reported, not fixed here).

- [ ] **Step 2: Screenshot matrix**

With `make backend` + `make web` running, capture login plus (if a session is available) chat shell, backlog, and admin dashboard at 1440 / 1024 / 390 px in light, dark, and high-contrast. Save to the scratchpad and review each for: teal/success distinguishability, kind-plan cyan vs teal action, warm hairline visibility, disabled-state legibility, watermark placement.

- [ ] **Step 3: Contrast audit record**

Record the measured ratios for: teal fills vs on-primary (all four themes), teal links on ecru, `#15803d` success text on `#fdfcfa`, `--color-warning-text`/`--color-danger-text` on the new canvas. Any failure gets fixed in `tokens.css` before proceeding.

- [ ] **Step 4: Update `web/DESIGN_REVIEW.md`**

Append a `## Warm Precision identity pass (2026-07-05)` section: what shipped (palette, fonts, radii, rhythm, signature moments), the contrast numbers, screenshot findings, and any deferred nits. Mark the old "authenticated visual pass" open item resolved or carried forward.

- [ ] **Step 5: Pause for user commit**

Report the full diff summary; user commits (`docs: record warm-precision identity pass`).
