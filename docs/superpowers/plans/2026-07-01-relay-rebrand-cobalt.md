# Relay Rebrand — Cobalt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monochrome near-black action color with a single cobalt brand hue (`#2f54eb`) across all four themes, and fold the legacy "info" status blue into the cobalt brand family.

**Architecture:** The change is centralized in design tokens. `web/src/styles/tokens.css` owns the palette primitives and the four theme blocks (`:root` light, `dark`, `contrast`, `contrast-dark`); every component reads `--color-primary`, `--ring-focus`, and `--color-info` from those tokens, so swapping the token values recolors the entire app — primary buttons, links, focus rings, text selection, active nav, "running" pills, and the `RelayMark` logo (whose primary chevron already strokes `var(--color-primary)`). The only second file is `web/src/styles/preferences.css`, which hardcodes per-theme `--preview-action` swatches for the theme-picker mockups and must track the new action color.

**Tech Stack:** CSS custom properties, Tailwind v4 `@theme inline` bridge, Next.js (`next build --webpack`), Geist type. No component logic changes.

## Global Constraints

- Signature action color (light): **Cobalt `#2f54eb`** — replaces near-black `#0a0a0a`.
- `--color-ink` stays `#0a0a0a` (ink = text, decoupled from the action color).
- Status hue set narrows to **green / amber / red**; blue leaves status. `--color-info` re-aliases to `var(--color-primary)` in every theme.
- Per-theme cobalt values (action / brand-soft tint / on-primary):
  - Light: `#2f54eb` / `#eef1fe` / `#ffffff`
  - Dark: `#5b7cff` / `rgba(91,124,255,.14)` / `#ffffff` (reverses the legacy ink-on-white dark inversion)
  - Contrast (light): `#1730a8` / `#e6eaff` / `#ffffff`
  - Contrast-dark: `#7d9bff` / `rgba(125,155,255,.18)` / `#000000`
- **No git commits** (user global rule). Each task ends at a review **Checkpoint**, not a commit.
- WCAG: cobalt-on-white and white-on-cobalt must hold ≥4.5:1; contrast-theme cobalts target ≥7:1.

---

### Task 1: Light-mode primitives + brand-soft + info re-alias (`tokens.css`)

**Files:**
- Modify: `web/src/styles/tokens.css` — `:root` primitives (lines ~118-168) and `@theme inline` bridge (lines ~48-63)

**Interfaces:**
- Produces: `--color-primary: #2f54eb`, `--color-primary-active: #1e3bb8`, `--color-primary-disabled: #c3cefb`, `--color-brand-soft: #eef1fe`, `--color-info: var(--color-primary)` in light mode; `--color-brand-soft` exposed as the Tailwind utility `bg-brand-soft` / `text-brand-soft`. Later tasks override these same names per theme.

- [ ] **Step 1: Edit the action primitives.** In the `:root` "Action" block, replace:

```css
  --color-primary: #0a0a0a;
  --color-primary-active: #27272a;
  --color-primary-disabled: #d4d4d8;
```

with:

```css
  /* Action — cobalt brand is the single action color. Hue now carries the
     action; status narrows to green/amber/red. --color-ink stays #0a0a0a
     (text), decoupled from the action color it was previously fused with. */
  --color-primary: #2f54eb;
  --color-primary-active: #1e3bb8;
  --color-primary-disabled: #c3cefb;
  --color-brand-soft: #eef1fe; /* tint — selected rows, active nav, running pills */
```

- [ ] **Step 2: Re-alias info to brand.** Replace the line:

```css
  --color-info: #3b82f6;          /* neutral "info" status — the sole surviving blue, status-only */
```

with:

```css
  --color-info: var(--color-primary);  /* info folds into the cobalt brand — no competing second blue */
```

- [ ] **Step 3: Expose brand-soft to Tailwind.** In the `@theme inline` block, immediately after the `--color-info: var(--color-info);` line, add:

```css
  --color-brand-soft: var(--color-brand-soft);
```

- [ ] **Step 4: Verify the values landed.**

Run: `cd web && grep -n "color-primary:\|color-brand-soft\|color-info:" src/styles/tokens.css | head`
Expected: `:root` shows `--color-primary: #2f54eb;`, `--color-brand-soft: #eef1fe;`, and `--color-info: var(--color-primary);` (no `#3b82f6` remaining in `:root`).

- [ ] **Step 5: Build to confirm no CSS breakage.**

Run: `cd web && npm run build`
Expected: build completes; no "undefined variable" or CSS parse errors.

- [ ] **Step 6: Checkpoint.** Stop for review. Confirm light-mode primary, links, focus ring, selection, and "info"-toned elements now read cobalt.

---

### Task 2: Dark theme block (`tokens.css`)

**Files:**
- Modify: `web/src/styles/tokens.css` — `html[data-theme="dark"]` block (the "Action — monochrome invert" section, lines ~422-435)

**Interfaces:**
- Consumes: token names from Task 1.
- Produces: dark overrides `--color-primary: #5b7cff`, `--color-primary-active: #7d97ff`, `--color-primary-disabled` (cobalt mix), `--color-on-primary: #ffffff`, `--color-brand-soft`, `--color-info: var(--color-primary)`.

- [ ] **Step 1: Replace the dark action block.** Replace:

```css
  /* Action — monochrome invert. In dark mode the action fill flips to
     near-white with ink text (the Vercel signature). Primary also drives
     links and the focus ring, so they read as white-on-dark; status hues
     stay separate via --color-info etc. */
  --color-primary: #f4f4f5;
  --color-primary-active: #e4e4e7;
  --color-primary-disabled: color-mix(in srgb, var(--color-on-dark) 24%, var(--color-surface-dark));
  --color-on-primary: #0a0a0a; /* ink text on the white action fill */
```

with:

```css
  /* Action — cobalt lifts to periwinkle on the dark canvas for contrast,
     mirroring how status hues lift in dark mode. The action now carries a
     hue in both modes (no black<->white inversion); on-primary stays white
     against the cobalt fill. Primary also drives links and the focus ring. */
  --color-primary: #5b7cff;
  --color-primary-active: #7d97ff;
  --color-primary-disabled: color-mix(in srgb, #5b7cff 30%, var(--color-surface-dark));
  --color-on-primary: #ffffff; /* white text on the cobalt action fill */
  --color-brand-soft: rgba(91, 124, 255, 0.14);
```

- [ ] **Step 2: Re-alias dark info to brand.** In the dark block's "Status" section, replace:

```css
  --color-info: #60a5fa;
```

with:

```css
  --color-info: var(--color-primary);
```

- [ ] **Step 3: Verify.**

Run: `cd web && grep -n "color-primary:\|color-on-primary:\|color-info:" src/styles/tokens.css`
Expected: the `html[data-theme="dark"]` block shows `--color-primary: #5b7cff;`, `--color-on-primary: #ffffff;`, `--color-info: var(--color-primary);`.

- [ ] **Step 4: Build.**

Run: `cd web && npm run build`
Expected: build completes cleanly.

- [ ] **Step 5: Checkpoint.** Stop for review. Confirm dark-mode action fills are cobalt-periwinkle with white text (not the old white-on-ink), and dark links/focus read cobalt.

---

### Task 3: High-contrast (light + dark) theme blocks (`tokens.css`)

**Files:**
- Modify: `web/src/styles/tokens.css` — `html[data-theme="contrast"]` block (lines ~490-501) and `html[data-theme="contrast-dark"]` block (lines ~544-555)

**Interfaces:**
- Consumes: token names from Task 1.
- Produces: contrast overrides keeping ≥7:1 legibility while adopting cobalt; `--color-info` folds to brand in both contrast themes.

- [ ] **Step 1: Edit the light contrast block.** In `html[data-theme="contrast"]`, replace:

```css
  --color-primary: #000000;
  --color-primary-active: #2e2e2e;
  --color-primary-disabled: #8a8a8a;
  --color-on-primary: #ffffff;
```

with:

```css
  --color-primary: #1730a8;
  --color-primary-active: #102179;
  --color-primary-disabled: #9aa9e8;
  --color-on-primary: #ffffff;
  --color-brand-soft: #e6eaff;
```

- [ ] **Step 2: Fold light-contrast info to brand.** Replace `--color-info: #0033cc;` with:

```css
  --color-info: var(--color-primary);
```

- [ ] **Step 3: Edit the dark contrast block.** In `html[data-theme="contrast-dark"]`, replace:

```css
  --color-primary: #ffffff;
  --color-primary-active: #d4d4d4;
  --color-primary-disabled: #6a6a6a;
  --color-on-primary: #000000;
```

with:

```css
  --color-primary: #7d9bff;
  --color-primary-active: #9db3ff;
  --color-primary-disabled: #4a5a8a;
  --color-on-primary: #000000;
  --color-brand-soft: rgba(125, 155, 255, 0.18);
```

- [ ] **Step 4: Fold dark-contrast info to brand.** Replace `--color-info: #5aa9ff;` with:

```css
  --color-info: var(--color-primary);
```

- [ ] **Step 5: Verify.**

Run: `cd web && grep -n "color-primary:\|color-brand-soft\|color-info:" src/styles/tokens.css | tail -12`
Expected: contrast block shows `#1730a8` + `--color-brand-soft: #e6eaff;`; contrast-dark shows `#7d9bff` + `--color-brand-soft: rgba(125, 155, 255, 0.18);`; both `--color-info: var(--color-primary);`.

- [ ] **Step 6: Build.**

Run: `cd web && npm run build`
Expected: build completes cleanly.

- [ ] **Step 7: Checkpoint.** Stop for review.

---

### Task 4: Theme-picker preview swatches (`preferences.css`)

**Files:**
- Modify: `web/src/styles/preferences.css` — `--preview-action` declarations at lines ~348, 363, 372, 384, 395

**Interfaces:**
- Consumes: the per-theme cobalt values (Global Constraints).
- Produces: theme-picker mockups whose action swatch matches the live action color per theme.

- [ ] **Step 1: Update each `--preview-action`.** Apply these five replacements (each is the only occurrence on its line):

| Line ~ | Theme block | From | To |
|---|---|---|---|
| 348 | `:root` (light) | `--preview-action: #0a0a0a;` | `--preview-action: #2f54eb;` |
| 363 | `[data-preview="dark"]` | `--preview-action: #f4f4f5;` | `--preview-action: #5b7cff;` |
| 372 | `[data-preview="system"]` | `--preview-action: #f4f4f5;` | `--preview-action: #2f54eb;` |
| 384 | `[data-preview="contrast"]` | `--preview-action: #000000;` | `--preview-action: #1730a8;` |
| 395 | `[data-preview="contrast-dark"]` | `--preview-action: #ffffff;` | `--preview-action: #7d9bff;` |

Edit each declaration in place; the surrounding `--preview-canvas/rail/list/card/line/ink` lines stay unchanged.

- [ ] **Step 2: Verify.**

Run: `cd web && grep -n "preview-action" src/styles/preferences.css`
Expected: five lines reading `#2f54eb`, `#5b7cff`, `#2f54eb`, `#1730a8`, `#7d9bff` (in that order); no `#0a0a0a`/`#f4f4f5`/`#000000`/`#ffffff` action values remain.

- [ ] **Step 3: Build.**

Run: `cd web && npm run build`
Expected: build completes cleanly.

- [ ] **Step 4: Checkpoint.** Stop for review. Confirm the Preferences → theme picker mockups show a cobalt action element in each swatch.

---

### Task 5: WCAG contrast verification + visual sweep

**Files:**
- No source edits. Verification only.

**Interfaces:**
- Consumes: all token values from Tasks 1–4.

- [ ] **Step 1: Compute WCAG ratios for the cobalt pairs.** Run this self-contained Node check (no files written):

```bash
node -e '
const L = h => { const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2]; };
const R = (a,b)=>{const l1=L(a),l2=L(b);return ((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toFixed(2);};
const pairs=[["#2f54eb","#ffffff","cobalt on white"],["#ffffff","#2f54eb","white on cobalt"],["#5b7cff","#0b0d12","dark periwinkle on dark canvas"],["#1730a8","#ffffff","contrast cobalt on white"],["#000000","#7d9bff","contrast-dark black on periwinkle"]];
for(const[a,b,n]of pairs)console.log(R(a,b).padStart(6),n);
'
```

Expected (approximate): cobalt-on-white ≈ **5.9**, white-on-cobalt ≈ **5.9**, dark periwinkle ≈ **6.0+**, contrast cobalt ≈ **9+**, contrast-dark ≈ **8+**. All ≥4.5; contrast themes ≥7. If any pair falls below its floor, stop and report — do not adjust silently.

- [ ] **Step 2: Confirm no stray legacy action/info literals remain.**

Run: `cd web/src && grep -rn "#0a0a0a" styles/ ; echo "---" ; grep -rn "#3b82f6" styles/ components/`
Expected: the only `#0a0a0a` hits are `--color-ink: #0a0a0a;` and `--color-on-primary: #0a0a0a;`-free (none in dark now) — i.e. ink text uses only; `#3b82f6` returns nothing.

- [ ] **Step 3: Confirm the logo recolors via token (no edit needed).**

Run: `grep -n "var(--color-primary)" web/src/components/RelayMark.tsx`
Expected: the primary chevron `<path … stroke="var(--color-primary)" />` is present — it now strokes cobalt automatically.

- [ ] **Step 4: Visual sweep.** Run the app (`make web`) and, via Preferences → Appearance, switch through Light, Dark, System, High-contrast, and High-contrast-dark. For each, confirm:
  - Primary buttons (Send), links, active nav rail item, text selection, and focus rings read cobalt (periwinkle on dark canvases).
  - "Running"/info-toned pills and backlog "assigned"/"review" lanes read cobalt; success=green, approval/attention=amber, danger=red are unchanged.
  - The `RelayMark` in the sidenav and login shows a cobalt primary chevron with a muted secondary chevron.
  - No element still shows the old `#3b82f6` info blue or near-black action fills.

- [ ] **Step 5: Final checkpoint.** Report the contrast table and visual-sweep results. Rebrand complete.

---

## Self-Review

**Spec coverage:**
- §2 single brand hue / action contract → Tasks 1–3 (all themes).
- §3 retire blue from status, fold info into cobalt → `--color-info` re-alias in Tasks 1–3; verified Task 5 Step 2.
- §4 per-theme cobalt values incl. dark on-primary reversal → Tasks 1–3 exact values; Global Constraints table.
- §5 token mapping incl. `@theme inline` brand-soft, derived tokens free → Task 1 Steps 1-3; derived `--ring-focus`/`::selection`/CTA confirmed via Task 5 visual sweep.
- §6 logo/mark → no edit required; mark already reads `--color-primary` (Task 5 Step 3 confirms).
- §7 blast radius (ink-as-action, info literals, dark on-primary) → Task 5 Step 2 grep; dark on-primary handled Task 2.
- §8 verification (visual + WCAG) → Task 5.
- §9 out of scope (type/geometry/TUI) → no tasks touch them. ✓

**Placeholder scan:** No TBD/TODO; every edit shows exact from→to CSS; every verify step has a concrete command + expected output. ✓

**Type consistency:** Token names are identical across tasks — `--color-primary`, `--color-primary-active`, `--color-primary-disabled`, `--color-on-primary`, `--color-brand-soft`, `--color-info`. Per-theme values differ by design and match the Global Constraints table. ✓
