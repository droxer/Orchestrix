# Web Sleek Forest Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap Relay web's dark/light color primitives from Graphite Steel (cool charcoal + steel blue) to Sleek Forest (warm near-black + forest green), and restructure Backlog/Routine's shared KPI-tile-row + centered-empty-state template into a quieter, left-aligned Inline Stat Bar pattern.

**Architecture:** This is almost entirely a Tier-1 primitives swap (`web/src/styles/tokens/primitives.css`) — semantic.css only ever aliases primitives, so most components repaint automatically with zero component-CSS edits. Two structural JSX/CSS changes ride along: dropping the serif `display` title variant on Backlog/Routine (typography stays Neutral Grotesk per spec), and replacing `BoardEmpty` + the `BacklogStats`/`RoutineStats` KPI grid with a left-aligned inline pattern.

**Tech Stack:** Next.js/React (web/), CSS custom properties (three-tier token architecture), stylelint (`color-no-hex` gate), `next build` as the TS/JSX check (no component-rendering test infra exists in `web/tests/` — see Global Constraints).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-web-sleek-forest-identity-design.md` — every task below implements one numbered section of it.
- Every hex value may only originate in `web/src/styles/tokens/primitives.css` (and the two documented exceptions: `login.css`, `preferences.css`) — enforced by `web/.stylelintrc.json`'s `color-no-hex` rule. Never add a hex value anywhere else; add a primitive and reference it with `var()`.
- No new fonts, no serif/mono promotion — typography stays Neutral Grotesk (spec §3). The only typography change in scope is removing the existing serif `--type-display-lg` usage from Backlog/Routine page titles (spec §5's mockups render those titles in sans); do not touch `admin-v2-drawers.css`'s `--type-display-sm` usage or `login.css`'s hero serif — both are out of scope (spec §6).
- The "quiet dot + caption" agent-status language in spec §4 already matches the app's `t("thread.no_agents")` inline text and `ChatHeader`'s busy-pip (which already uses `--color-semantic-info`, not a status-green, so it doesn't collide with the new green accent). Do **not** invent a new "team roster" component, elapsed-time tracking, or clock-in/idle timestamps — no such data exists in the app today, and inventing it is out of scope for a visual-identity pass. Section 4 is satisfied entirely by the primitives swap in Task 1.
- The Backlog/Routine "inline quick-add" in spec §5 keeps today's behavior (`onCreate` opens the existing `TaskDrawer`/routine form) — it is a restyled affordance, not a new single-field task-creation flow. Do not add a text `<input>` that creates tasks directly.
- `web/tests/` contains only `node:test` unit tests against pure `src/lib/*.ts` functions — there is no React-component-rendering test harness (no jsdom/RTL dependency). Do not invent component tests where none of the existing suite has a pattern for them. Verification for CSS/token tasks is `cd web && npm run lint:css`; verification for JSX/TSX tasks is `npm run build -w web` (Next's type-check). The final task is a manual visual QA pass using the project's existing login-mocked Playwright screenshot harness.
- Every task must leave `cd web && npm run lint:css` and `npm run build -w web` passing — run both at the end of every task, not just once at the end of the plan.

---

### Task 1: Dark-theme primitive swap (Sleek Forest)

**Files:**
- Modify: `web/src/styles/tokens/primitives.css:1-137` (manifest comment + `:root` dark color block)

**Interfaces:**
- Consumes: nothing (this is the root of the token tree).
- Produces: every `--color-accent*`, `--color-ink-*`, `--color-canvas-*`, `--color-hairline-*`, `--color-green/red/yellow/slate/yellow-deep/red-deep`, and `--color-kind-review` primitive that `semantic.css` aliases and every component consumes by `var()`. Later tasks (2, 3) mirror these exact hex values into the light theme and `login.css`.

- [ ] **Step 1: Update the manifest header comment to describe the new palette**

In `web/src/styles/tokens/primitives.css`, replace the file's opening doc comment (lines 1–34) — it currently describes "Graphite Steel". Replace the `Palette direction:` paragraph (lines 12–28) with:

```
   Palette direction: Sleek Forest — a warm near-black canvas (#141311)
   with a four-step warm surface ladder, warm off-white ink, and a
   restrained forest green (#4f9d6e) as the single chromatic accent, used
   ONLY for the brand mark, primary actions, and focus. Forest green sits
   in the same hue family as the success status color, so success
   (--color-green) is deliberately tuned brighter/more saturated
   (#2fb355) than the muted accent so the two don't read as
   interchangeable at small sizes (dots, badges). Dark is the primary,
   default register; light is a derived secondary theme that deepens the
   same forest family into #2f7a50 for AA contrast on a warm off-white
   canvas. Status hues (green/red/amber) remain the only other chroma in
   the system — dots, borders, and text, never fills or actions. One
   crisp grotesk carries every text role; mono is reserved for code-like
   content. Geometry is tight (5–6px controls), hairlines draw all
   structure, and motion is fast with no overshoot. Because semantic.css
   only ever aliases these names, this whole reskin lives entirely in
   this file; no component CSS changed except where noted in
   docs/superpowers/plans/2026-07-14-web-sleek-forest-identity.md.
```

- [ ] **Step 2: Swap the dark accent block**

Replace:

```css
  /* Accent — Graphite Steel is the single chromatic action color: brand
     mark, primary CTA, focus ring, link emphasis. A restrained steel
     blue reads as enterprise calm (Stripe/Notion school) without the
     neon flash of Signal Cyan or the lavender-on-dark convergence of
     most dev-tool SaaS. Rest state is mid-bright, so on-accent text
     goes DARK here — see --color-on-accent below. Disabled fades to a
     desaturated steel-gray so dark-on-accent text stays legible. */
  --color-accent: #5b87d6;
  --color-accent-active: #7aa0e0;
  --color-accent-disabled: #6a7a94;
  --color-accent-tint: #152033; /* selection wash — a dark steel-tinted surface, not a pastel */
```

with:

```css
  /* Accent — Forest Green is the single chromatic action color: brand
     mark, primary CTA, focus ring, link emphasis. A muted forest reads
     distinct from the blue/teal SaaS convergence without the neon flash
     of a signal color. Rest state is mid-bright, so on-accent text goes
     DARK here — see --color-on-accent below. Disabled fades toward the
     canvas so dark-on-accent text stays legible. */
  --color-accent: #4f9d6e;
  --color-accent-active: #63b482;
  --color-accent-disabled: #3d5c4b;
  --color-accent-tint: #16241c; /* selection wash — a dark forest-tinted surface, not a pastel */
```

- [ ] **Step 3: Swap the dark ink ramp**

Replace:

```css
  /* Ink — cool light-gray text ramp, darkest(brightest)-first. */
  --color-ink-900: #f3f5f7;
  --color-ink-700: #c5ccd6;
  --color-ink-500: #8b93a0;
  --color-ink-300: #636b78;
  --color-ink-200: #4a5160; /* rail/decorative border step between hairline and ink-300 */
```

with:

```css
  /* Ink — warm off-white text ramp, darkest(brightest)-first. */
  --color-ink-900: #f5f3ec;
  --color-ink-700: #d8d4c8;
  --color-ink-500: #b8b4a8;
  --color-ink-300: #8a8578;
  --color-ink-200: #67645b; /* rail/decorative border step between hairline and ink-300 */
```

- [ ] **Step 4: Swap on-accent/on-fill text**

Replace:

```css
  --color-on-accent: #0a1220;
  --color-porcelain: #f3f5f7;  /* text on ink/dark fills that appear in both themes */
```

with:

```css
  --color-on-accent: #0d1410;
  --color-porcelain: #f5f3ec;  /* text on ink/dark fills that appear in both themes */
```

- [ ] **Step 5: Swap the dark canvas ladder**

Replace:

```css
  /* Canvas — cool four-step charcoal surface ladder on a near-black
     (#0b0d10) canvas. Structure comes from hairlines, not shadows. */
  --color-canvas-base: #0b0d10;
  --color-canvas-soft: #14171c;    /* surface-1 — default cards, product panels */
  --color-canvas-strong: #1a1e25;  /* surface-2 — fills, search, hovered cards */
  --color-canvas-raised: #1f242c;  /* surface-3 — modals, drawers, floating chrome */
```

with:

```css
  /* Canvas — warm four-step near-black surface ladder on a warm
     near-black (#141311) canvas. Structure comes from hairlines, not shadows. */
  --color-canvas-base: #141311;
  --color-canvas-soft: #1b1a16;    /* surface-1 — default cards, product panels */
  --color-canvas-strong: #211f1a;  /* surface-2 — fills, search, hovered cards */
  --color-canvas-raised: #262420;  /* surface-3 — modals, drawers, floating chrome */
```

- [ ] **Step 6: Swap the dark hairline ramp**

Replace:

```css
  /* Hairline ramp. */
  --color-hairline-300: #262b33;
  --color-hairline-200: #1a1e25;
```

with:

```css
  /* Hairline ramp. */
  --color-hairline-300: #2c2a24;
  --color-hairline-200: #211f1a;
```

- [ ] **Step 7: Retune status hues so success doesn't collide with the new green accent**

Replace:

```css
  /* Status hues — the only other chroma in the system besides the
     Graphite Steel accent. Text, dots, and borders only; never
     background fills, never actions. Success matches Linear's
     semantic-success directly; red/amber/slate carry forward this
     app's dark-tuned values. */
  --color-green: #27a644;    /* success — Linear semantic-success */
  --color-red: #f87171;      /* danger */
  --color-yellow: #fbbf24;   /* warning (dot-only contrast) */
  --color-slate: #9aa1ab;    /* info — neutral, decoupled from the accent */
  --color-yellow-deep: #fbbf24; /* warning as text — ~7:1 on the cool charcoal canvas */
  --color-red-deep: #f87171;    /* danger as text */
  --color-rust: #f0a868;        /* syntax-highlight numerals — orthogonal to the reskin */
```

with:

```css
  /* Status hues — the only other chroma in the system besides the
     Forest Green accent. Text, dots, and borders only; never
     background fills, never actions. Success is intentionally a
     brighter, more saturated green than the muted forest accent so a
     "ready"/"done" dot and a primary button don't read as the same
     color at a glance; red/amber/slate carry forward this app's
     dark-tuned values. */
  --color-green: #2fb355;    /* success — brighter/more saturated than the #4f9d6e accent */
  --color-red: #ef6f6f;      /* danger */
  --color-yellow: #e0a857;   /* warning (dot-only contrast) */
  --color-slate: #8a8578;    /* info — neutral, decoupled from the accent */
  --color-yellow-deep: #e0a857; /* warning as text — verify ~7:1 on the warm near-black canvas */
  --color-red-deep: #ef6f6f;    /* danger as text */
  --color-rust: #f0a868;        /* syntax-highlight numerals — orthogonal to the reskin, unchanged */
```

- [ ] **Step 8: Retune the decorative "review" kind-accent so it doesn't collide with the accent**

The accent is green for the first time in this app's history, and `--color-kind-review` (the artifact-chip "review passed" decorative tag) was already a green, chosen back when the accent was blue specifically because it *wasn't* the accent color. Shift it to a teal so it stays visually distinct from the new green accent while still reading "positive/passed". Replace:

```css
  --color-kind-plan: #22b8d4;     /* cyan */
  --color-kind-diff: #e0913a;     /* amber */
  --color-kind-test: #a78bfa;     /* violet */
  --color-kind-log: #e879f9;      /* magenta */
  --color-kind-summary: #60a5fa;  /* blue */
  --color-kind-review: #34d399;   /* green — named separately as a decorative alias */
  --color-diff-hunk: #5eb3f5;
```

with:

```css
  --color-kind-plan: #22b8d4;     /* cyan */
  --color-kind-diff: #e0913a;     /* amber */
  --color-kind-test: #a78bfa;     /* violet */
  --color-kind-log: #e879f9;      /* magenta */
  --color-kind-summary: #60a5fa;  /* blue */
  --color-kind-review: #2dd4bf;   /* teal — shifted off green so it doesn't read as the accent color */
  --color-diff-hunk: #5eb3f5;
```

- [ ] **Step 9: Verify**

Run:

```bash
cd web && npm run lint:css
```

Expected: no errors (every value above is still only in `primitives.css`).

Run:

```bash
npm run build -w web
```

Expected: build succeeds (no TS/JSX touched in this task, this just confirms nothing else broke).

- [ ] **Step 10: Commit**

```bash
git add web/src/styles/tokens/primitives.css
git commit -m "style(web): swap dark theme to Sleek Forest palette"
```

---

### Task 2: Light-theme primitive swap (Sleek Forest)

**Files:**
- Modify: `web/src/styles/tokens/primitives.css:281-321` (`html[data-theme="light"]` block)

**Interfaces:**
- Consumes: the deepening pattern established in Task 1 (accent deepened for AA contrast on a pale canvas, same ratio the old Graphite Steel light theme used: `#5b87d6` → `#2f5fad`).
- Produces: the light-register values of the same primitive names — no new names.

- [ ] **Step 1: Update the block's leading comment**

Replace:

```css
html[data-theme="light"] {
  /* Dark steel is bright enough on charcoal but too light to carry
     white text on a pale canvas, so the light register deepens
     rest/hover into #2f5fad (verified ~4.5:1+ white-text contrast).
     Disabled fades to a mid steel-gray so white on-accent stays legible. */
  --color-accent: #2f5fad;
  --color-accent-active: #274f91;
  --color-accent-disabled: #7a8aa3;
  --color-accent-tint: #dce6f5;   /* selection wash — a lifted pale steel tint, not a pastel */
  --color-on-accent: #ffffff; /* white text on the deepened steel fill */
```

with:

```css
html[data-theme="light"] {
  /* Dark forest is bright enough on near-black but too light to carry
     white text on a pale canvas, so the light register deepens
     rest/hover into #2f7a50 (verified ~4.5:1+ white-text contrast).
     Disabled fades to a mid forest-gray so white on-accent stays legible. */
  --color-accent: #2f7a50;
  --color-accent-active: #266342;
  --color-accent-disabled: #7a9a89;
  --color-accent-tint: #dcefe3;   /* selection wash — a lifted pale forest tint, not a pastel */
  --color-on-accent: #ffffff; /* white text on the deepened forest fill */
```

- [ ] **Step 2: Swap the light ink ramp and canvas/hairline ladder**

Replace:

```css
  --color-ink-900: #12141a;
  --color-ink-700: #3f4550;
  --color-ink-500: #6b7280;
  --color-ink-300: #9aa1ab;
  --color-ink-200: #d1d5db;

  --color-canvas-base: #f7f8fa;
  --color-canvas-soft: #ffffff;
  --color-canvas-strong: #eef0f3;
  --color-canvas-raised: #ffffff;

  --color-hairline-300: #e2e5ea;
  --color-hairline-200: #eef0f3;
```

with:

```css
  --color-ink-900: #1c1a15;
  --color-ink-700: #4a463c;
  --color-ink-500: #746f61;
  --color-ink-300: #a39c8c;
  --color-ink-200: #ddd6c4;

  --color-canvas-base: #faf8f4;
  --color-canvas-soft: #ffffff;
  --color-canvas-strong: #f1ece0;
  --color-canvas-raised: #ffffff;

  --color-hairline-300: #ece6d8;
  --color-hairline-200: #f1ece0;
```

- [ ] **Step 3: Retune light status hues (mirrors Task 1 Step 7's reasoning)**

Replace:

```css
  --color-green: #10b981;
  --color-red: #ef4444;
  --color-slate: #6b7280;
  --color-rust: #b45309;
  --color-yellow: #f59e0b;
  --color-yellow-deep: #8a5c00; /* ~4.8:1 on cool gray-white */
  --color-red-deep: #dc2626;    /* ~4.5:1 on cool gray-white */
```

with:

```css
  --color-green: #1f9d4a;
  --color-red: #dc4c4c;
  --color-slate: #746f61;
  --color-rust: #b45309;
  --color-yellow: #c98a2e;
  --color-yellow-deep: #8a5c00; /* ~4.8:1 on warm off-white, unchanged value still verified */
  --color-red-deep: #dc2626;    /* ~4.5:1 on warm off-white, unchanged value still verified */
```

- [ ] **Step 4: Retune the light "review" kind-accent to match Task 1 Step 8**

Replace:

```css
  /* Artifact kind accents — desaturated for the pale canvas. */
  --color-kind-plan: #0891b2;
  --color-kind-diff: #b45309;
  --color-kind-test: #7c3aed;
  --color-kind-log: #c026d3;
  --color-kind-summary: #2563eb;
  --color-kind-review: #10b981;
}
```

with:

```css
  /* Artifact kind accents — desaturated for the pale canvas. */
  --color-kind-plan: #0891b2;
  --color-kind-diff: #b45309;
  --color-kind-test: #7c3aed;
  --color-kind-log: #c026d3;
  --color-kind-summary: #2563eb;
  --color-kind-review: #0d9488; /* teal — shifted off green, mirrors the dark theme's #2dd4bf */
}
```

- [ ] **Step 5: Verify**

```bash
cd web && npm run lint:css
npm run build -w web
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles/tokens/primitives.css
git commit -m "style(web): swap light theme to Sleek Forest palette"
```

---

### Task 3: Mirror the palette into `login.css`'s pre-auth dark ramp

**Files:**
- Modify: `web/src/styles/login.css:23-35`

**Interfaces:**
- Consumes: the exact hex values from Task 1 (dark theme). `login.css` is a documented stylelint exception (its own `--lg-*` ramp, "mirrors tokens/primitives.css's dark register verbatim") — this task keeps that documented invariant true.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the current block to confirm line numbers before editing**

Run:

```bash
sed -n '1,40p' web/src/styles/login.css
```

Confirm the `--lg-*` block matches what's shown below before editing (the file may have drifted since this plan was written).

- [ ] **Step 2: Swap the `--lg-*` values**

Replace:

```css
  --lg-canvas: #0b0d10;
  --lg-elevated: #1f242c;
  --lg-ink: #f3f5f7;
  --lg-body: #c5ccd6;
  --lg-muted: #8b93a0;
  --lg-hairline: color-mix(in srgb, #f3f5f7 14%, #0b0d10);
  --lg-hairline-soft: color-mix(in srgb, #f3f5f7 8%, #0b0d10);
  --lg-steel: #5b87d6;
  --lg-steel-active: #7aa0e0;
  --lg-on-steel: #0a1220; /* text-on-accent (dark ink on the steel fill) */
  --lg-up: #34d399;
  --lg-amber: #fbbf24;
  --lg-down: #f87171;
```

with:

```css
  --lg-canvas: #141311;
  --lg-elevated: #262420;
  --lg-ink: #f5f3ec;
  --lg-body: #d8d4c8;
  --lg-muted: #8a8578;
  --lg-hairline: color-mix(in srgb, #f5f3ec 14%, #141311);
  --lg-hairline-soft: color-mix(in srgb, #f5f3ec 8%, #141311);
  --lg-steel: #4f9d6e;
  --lg-steel-active: #63b482;
  --lg-on-steel: #0d1410; /* text-on-accent (dark ink on the forest fill) */
  --lg-up: #2fb355;
  --lg-amber: #e0a857;
  --lg-down: #ef6f6f;
```

Keep the variable names (`--lg-steel`, `--lg-on-steel`, etc.) unchanged — they're internal to this one file and renaming them would touch every reference below in the same file for no behavioral benefit.

- [ ] **Step 3: Verify**

```bash
cd web && npm run lint:css
npm run build -w web
```

Expected: both pass (`login.css` is a documented `color-no-hex` exception, so the hex literals above are allowed here).

- [ ] **Step 4: Commit**

```bash
git add web/src/styles/login.css
git commit -m "style(web): mirror Sleek Forest palette into login screen"
```

---

### Task 4: Drop the serif display title on Backlog and Routine

**Files:**
- Modify: `web/src/components/BacklogPage.tsx:582-594`
- Modify: `web/src/components/RoutinePage.tsx` (the `<PageHeader ... titleVariant="display" ...>` call, same shape as Backlog's)

**Interfaces:**
- Consumes: `PageHeader`'s existing `titleVariant?: "default" | "display"` prop (`web/src/components/PageHeader.tsx`) — no change to `PageHeader` itself, just which variant these two callers pass.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm current usage**

```bash
grep -n "titleVariant" web/src/components/BacklogPage.tsx web/src/components/RoutinePage.tsx
```

Expected output includes `titleVariant="display"` in both files.

- [ ] **Step 2: Remove `titleVariant="display"` from BacklogPage**

In `web/src/components/BacklogPage.tsx`, find:

```tsx
      <PageHeader
        kicker={t("nav.backlog")}
        title={t("backlog.title")}
        count={t("backlog.sub", { count: tasks.length })}
        titleVariant="display"
        actions={
```

Replace with:

```tsx
      <PageHeader
        kicker={t("nav.backlog")}
        title={t("backlog.title")}
        count={t("backlog.sub", { count: tasks.length })}
        actions={
```

(Omitting `titleVariant` falls back to `PageHeader`'s default, which renders `text-lg font-semibold` — the neutral grotesk sans, not the serif.)

- [ ] **Step 3: Remove `titleVariant="display"` from RoutinePage**

Apply the same removal to RoutinePage's `<PageHeader>` call — locate it first:

```bash
grep -n -B4 'titleVariant="display"' web/src/components/RoutinePage.tsx
```

Delete the `titleVariant="display"` line from that call, following the same pattern as Step 2.

- [ ] **Step 4: Verify**

```bash
npm run build -w web
```

Expected: build succeeds. Then start the dev server (`make web` or `npm run dev -w web`) and visually confirm both "Backlog" and "Routine" page titles render in the sans body font, not the serif — compare against `web/src/styles/tokens/semantic.css`'s `--type-title-md`/`text-lg` styles vs `--type-display-lg`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BacklogPage.tsx web/src/components/RoutinePage.tsx
git commit -m "style(web): drop serif display title from Backlog/Routine headers"
```

---

### Task 5: Left-align `BoardEmpty` (Backlog + Routine shared empty state)

**Files:**
- Modify: `web/src/components/BoardEmpty.tsx`
- Modify: `web/src/styles/backlog.css` (the `/* ── Empty board ── */` block, currently around line 797)

**Interfaces:**
- Consumes: `RelayTask`-derived `title`/`body`/`createLabel`/`onCreate` props — signature is unchanged, so `BacklogPage.tsx`'s and `RoutinePage.tsx`'s existing call sites (`<BoardEmpty title={...} body={...} createLabel={...} onCreate={...} />`) need no edits.
- Produces: `.backlog-board-empty` CSS class (renamed usage — was a modifier class on `RelayEmptyState`'s `.relay-empty`, is now the component's own root class), consumed only by this component.

- [ ] **Step 1: Confirm the current implementation**

```bash
cat web/src/components/BoardEmpty.tsx
```

Confirm it matches the version quoted in the design spec's exploration (imports `RelayEmptyState`, `Button`, `ActionCompose`, `ICON_STROKE_LARGE`, and renders a centered SVG illustration).

- [ ] **Step 2: Replace `BoardEmpty.tsx`**

Replace the entire file contents with:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { ActionCompose } from "./icons";

// Shared empty-state for task boards (Backlog + Routine). Left-aligned,
// inline with the page's normal content column — no centered icon block.
export function BoardEmpty({
  title,
  body,
  createLabel,
  onCreate,
}: {
  title: string;
  body: string;
  createLabel?: string;
  onCreate?: () => void;
}) {
  return (
    <div className="backlog-board-empty" role="status">
      <p className="backlog-board-empty-title">{title}</p>
      <p className="backlog-board-empty-body">{body}</p>
      {onCreate && createLabel ? (
        <Button size="sm" onClick={onCreate}>
          <ActionCompose size={14} />
          {createLabel}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Replace the empty-board CSS block**

In `web/src/styles/backlog.css`, find:

```css
/* ── Empty board — uses RelayEmptyState (empty-state.css) ─────────── */

.backlog-board-empty {
  flex: 1;
  width: 100%;
}
```

Replace with:

```css
/* ── Empty board — left-aligned inline empty state (own markup, no
   RelayEmptyState) ──────────────────────────────────────────────── */

.backlog-board-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xxs);
  width: 100%;
  padding: var(--space-xl);
}

.backlog-board-empty-title {
  margin: 0;
  font: var(--type-title-md);
  color: var(--color-semantic-ink);
}

.backlog-board-empty-body {
  margin: 0 0 var(--space-sm);
  max-width: 46ch;
  font: var(--type-body-sm);
  color: var(--color-semantic-body);
}
```

- [ ] **Step 4: Verify `--type-title-md` and `--type-body-sm` exist**

```bash
grep -n -- "--type-title-md:\|--type-body-sm:" web/src/styles/tokens/semantic.css
```

Expected: both are defined (they're already used by `empty-state.css`'s `.relay-empty-title`/`.relay-empty-body`, which this task's markup replaces for this one component).

- [ ] **Step 5: Verify build and lint**

```bash
cd web && npm run lint:css
npm run build -w web
```

Expected: both pass. `RelayEmptyState`, `ICON_STROKE_LARGE`, and the removed `BoardEmptyIllustration` SVG are no longer imported/defined anywhere in `BoardEmpty.tsx` — confirm no unused-import build warnings.

- [ ] **Step 6: Manual check**

Start the dev server, navigate to Backlog and Routine with zero tasks/routines (or use the project's mocked-`/auth/me` Playwright screenshot harness — see project memory `relay-visual-review-harness`), and confirm both show left-aligned title + body text + a small button, with no centered icon.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/BoardEmpty.tsx web/src/styles/backlog.css
git commit -m "style(web): left-align Backlog/Routine empty state"
```

---

### Task 6: Inline Stat Bar for `BacklogStats` and `RoutineStats`

**Files:**
- Modify: `web/src/components/BacklogPage.tsx` (the `BacklogStats` function, around line 79)
- Modify: `web/src/components/RoutinePage.tsx` (the `RoutineStats` function, around line 81)
- Modify: `web/src/styles/backlog.css:22-61` (the `/* ── KPI strip ── */` block) and the two mobile-only stat rules around lines 809 and 834–840

**Interfaces:**
- Consumes: same `tasks: RelayTask[]` prop each function already takes — only the returned JSX tag types and CSS change, not the computed `stats` values or class names (`backlog-stat-value`, `tone-active`, `tone-blocked`, `tone-overdue` stay identical so the existing color-tone logic keeps working).
- Produces: nothing new consumed elsewhere — `.backlog-stats`/`.backlog-stat`/`.backlog-stat-eyebrow`/`.backlog-stat-value` keep their names, only their CSS display mode changes from grid-of-tiles to an inline row.

- [ ] **Step 1: Change `BacklogStats`'s root tags from block `div`s to inline `p`/`span`s**

In `web/src/components/BacklogPage.tsx`, find:

```tsx
  return (
    <div className="backlog-stats" aria-label={t("backlog.metrics")}>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_active")}</span>
        <span className="backlog-stat-value tone-active">{stats.active}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_blocked")}</span>
        <span className={cn("backlog-stat-value", stats.blocked > 0 && "tone-blocked")}>{stats.blocked}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_overdue")}</span>
        <span className={cn("backlog-stat-value", stats.overdue > 0 && "tone-overdue")}>{stats.overdue}</span>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
  return (
    <p className="backlog-stats" aria-label={t("backlog.metrics")}>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_active")}</span>
        <span className="backlog-stat-value tone-active">{stats.active}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_blocked")}</span>
        <span className={cn("backlog-stat-value", stats.blocked > 0 && "tone-blocked")}>{stats.blocked}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_overdue")}</span>
        <span className={cn("backlog-stat-value", stats.overdue > 0 && "tone-overdue")}>{stats.overdue}</span>
      </span>
    </p>
  );
}
```

- [ ] **Step 2: Apply the identical tag change to `RoutineStats`**

In `web/src/components/RoutinePage.tsx`, find the analogous block (root `<div className="backlog-stats" ...>` containing four `<div className="backlog-stat">` children with `routine.metric_total`/`metric_enabled`/`metric_due`/`metric_running` keys) and apply the same `div`→`p`/`span` tag swap as Step 1, keeping every class name, translation key, and tone-class expression exactly as they are today.

- [ ] **Step 3: Replace the KPI-strip CSS with an inline stat-bar**

In `web/src/styles/backlog.css`, find:

```css
/* ── KPI strip ─────────────────────────────────────────────────────── */

.backlog-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--color-semantic-hairline);
  background: color-mix(in srgb, var(--color-semantic-canvas) 92%, var(--color-semantic-surface-soft));
}

.backlog-stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
  padding: var(--space-sm) var(--space-base);
  border-right: 1px solid var(--color-semantic-hairline-soft);
  min-width: 0;
}

.backlog-stat:last-child {
  border-right: 0;
}

.backlog-stat-eyebrow {
  font: var(--type-eyebrow);
  letter-spacing: var(--letter-eyebrow);
  text-transform: uppercase;
  color: var(--color-semantic-muted);
}

.backlog-stat-value {
  font-family: var(--font-number);
  font-size: clamp(1.25rem, 2vw, 1.625rem);
  font-weight: 500;
  line-height: 1;
  letter-spacing: var(--letter-number-fluid);
  font-variant-numeric: tabular-nums;
  color: var(--color-semantic-ink);
}

.backlog-stat-value.tone-active { color: var(--color-semantic-ink); }
.backlog-stat-value.tone-blocked { color: var(--color-semantic-danger-text); }
.backlog-stat-value.tone-overdue { color: var(--color-semantic-danger-text); }
```

Replace with:

```css
/* ── Inline stat bar ──────────────────────────────────────────────── */

.backlog-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0;
  padding: var(--space-sm) var(--space-xl);
  border-bottom: 1px solid var(--color-semantic-hairline);
  background: var(--color-semantic-canvas);
}

.backlog-stat {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-xxs);
}

.backlog-stat:not(:last-child)::after {
  content: "·";
  margin: 0 var(--space-sm);
  color: var(--color-semantic-muted);
}

.backlog-stat-eyebrow {
  font: var(--type-eyebrow);
  letter-spacing: var(--letter-eyebrow);
  text-transform: uppercase;
  color: var(--color-semantic-muted);
}

.backlog-stat-value {
  font-family: var(--font-number);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1;
  letter-spacing: var(--letter-number-fluid);
  font-variant-numeric: tabular-nums;
  color: var(--color-semantic-ink);
}

.backlog-stat-value.tone-active { color: var(--color-semantic-ink); }
.backlog-stat-value.tone-blocked { color: var(--color-semantic-danger-text); }
.backlog-stat-value.tone-overdue { color: var(--color-semantic-danger-text); }
```

- [ ] **Step 4: Remove the now-obsolete mobile grid rules**

The old KPI strip had responsive rules that only make sense for a bordered 4-column grid. Find (still in `web/src/styles/backlog.css`, inside the `@media (max-width: 820px)` block):

```css
  .backlog-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
```

Delete this rule entirely (the flex-wrap on `.backlog-stats` already reflows naturally at narrow widths — no replacement needed).

Then find, further down in the same media block:

```css
  .backlog-stat:nth-child(2) {
    border-right: 0;
  }

  .backlog-stat:nth-child(3),
  .backlog-stat:nth-child(4) {
    border-top: 1px solid var(--color-semantic-hairline-soft);
  }
```

Delete this rule entirely as well (there are no more borders between stats to manage).

- [ ] **Step 5: Verify**

```bash
cd web && npm run lint:css
npm run build -w web
```

Expected: both pass.

- [ ] **Step 6: Manual check**

Start the dev server and confirm Backlog and Routine both render their four metrics as one quiet inline line under the page title (`Total 0 · Active 0 · Blocked 0 · Overdue 0` style), not four bordered boxes, at both desktop and mobile widths.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/BacklogPage.tsx web/src/components/RoutinePage.tsx web/src/styles/backlog.css
git commit -m "style(web): collapse Backlog/Routine KPI tiles into an inline stat bar"
```

---

### Task 7: Full visual QA pass across themes and routes

**Files:** none (verification-only task; no code changes expected unless QA finds a regression, in which case fix it in the relevant file from Tasks 1–6 and re-run this task).

**Interfaces:**
- Consumes: the completed Tasks 1–6.
- Produces: nothing — this is the plan's closing gate.

- [ ] **Step 1: Start the web dev server**

```bash
make web
```

(or `npm run dev -w web` — confirm it's serving on `http://127.0.0.1:5000`, not port 3000; the app is login-gated, so screenshot it via the mocked-`/auth/me` Playwright approach documented in project memory `relay-visual-review-harness`, not by typing real credentials.)

- [ ] **Step 2: Screenshot every route in both themes**

Using the mocked-backend Playwright harness, capture: `#/chat/<id>`, `#/backlog`, `#/routine`, `#/workspace`, `#/admin`, each with `document.documentElement.setAttribute('data-theme', 'dark')` and again with `'light'`.

- [ ] **Step 3: Confirm the checklist**

For each screenshot, confirm:
- No leftover cool-charcoal/steel-blue coloring anywhere (the whole app should read warm near-black/warm off-white + forest green, not a mix of old and new).
- Backlog/Routine page titles render in the sans body font, not serif.
- Backlog/Routine's metrics render as one inline line, not four boxed tiles.
- Backlog/Routine's empty states (view with zero tasks/routines) are left-aligned, not centered.
- Any visible "ready"/"success" green dot or badge and any visible primary button are distinguishably different shades of green, not identical. Specifically check `AgentStateBadge`'s ready pip (Backlog task rows) and `RoutinePage`'s "enabled" badge (`StatusPill`/`Badge variant="success"`) against any nearby primary button — both consume `--color-semantic-success` → `--color-green`, already retuned in Task 1 Step 7, but confirm visually since these are the exact spots spec §6 flagged as needing an audit.
- The artifact library's "review" kind-accent chip (if reachable in the mocked fixture) reads teal, not green.

- [ ] **Step 4: Fix any regressions found**

If any check fails, fix it in the relevant file from Tasks 1–6, re-run `cd web && npm run lint:css && npm run build -w web`, and re-screenshot the affected route before proceeding.

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix(web): address Sleek Forest QA findings"
```

If Step 4 required no fixes, skip this step — there is nothing to commit.
