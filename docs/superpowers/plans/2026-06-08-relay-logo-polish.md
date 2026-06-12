# Relay Logo Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current circuit-X mark with the V3 asymmetric "inputs → forward signal" lockup defined in `docs/superpowers/specs/2026-06-08-relay-logo-polish-design.md`, updating both standalone SVGs and the inline mark in the daemon control panel.

**Architecture:** Three SVG sources (two on disk under `assets/brand/`, one inlined in `packages/relay-daemon/src/relay/daemon.ts`) must stay byte-for-byte consistent in their mark geometry. The plan rewrites them in lock-step, then verifies render quality at nav and favicon sizes via `sips` and a TypeScript typecheck.

**Tech Stack:** SVG 1.1, TypeScript template literals (no JSX in the daemon HTML), Node 22, `sips` for PNG render verification, `tsc --noEmit` for typecheck.

**Note on commits:** Project owner has a global instruction "Do NOT create git commit." Commit steps are intentionally omitted; reviewers will commit at the end.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `assets/brand/relay-mark.svg` | Standalone mark (icon-only) — favicons, small UI usages | Rewrite entire file |
| `assets/brand/relay-logo.svg` | Full lockup (mark + "Relay" wordmark) — README hero, marketing | Rewrite entire file |
| `packages/relay-daemon/src/relay/daemon.ts` | Daemon control panel HTML — inlines the mark inside the `.wordmark` span at lines ~1786–1809 | Replace inline `<svg>` block |
| `assets/brand/README.md` | Brand asset usage notes | Append "Usage" section |

No other files change. `README.md` already references `assets/brand/relay-logo.svg` by path; the rewrite propagates automatically.

---

## Task 1: Rewrite `assets/brand/relay-mark.svg`

**Files:**
- Modify: `assets/brand/relay-mark.svg` (full rewrite)

- [ ] **Step 1: Write the new mark SVG**

Replace the entire file contents with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64" role="img" aria-label="Relay" shape-rendering="geometricPrecision">
  <title>Relay</title>
  <g fill="none" stroke="#18232d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 14 H22 L32 24 H40"/>
    <path d="M10 50 H22 L32 40 H40"/>
  </g>
  <g fill="#18232d">
    <circle cx="10" cy="14" r="4"/>
    <circle cx="10" cy="50" r="4"/>
  </g>
  <g stroke="#0052ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="32" y1="32" x2="76" y2="32"/>
    <polyline points="68,24 80,32 68,40"/>
  </g>
</svg>
```

- [ ] **Step 2: Render mark to PNG at three sizes for visual verification**

```bash
mkdir -p /tmp/relay-verify
/usr/bin/sips -s format png -Z 768 assets/brand/relay-mark.svg --out /tmp/relay-verify/mark-768.png
/usr/bin/sips -s format png -Z 96  assets/brand/relay-mark.svg --out /tmp/relay-verify/mark-96.png
/usr/bin/sips -s format png -Z 32  assets/brand/relay-mark.svg --out /tmp/relay-verify/mark-32.png
```

Expected: three PNG files written with no errors. Read each one (via the Read tool) and confirm:
- 768px: two ink dots top-left and bottom-left, two converging traces, blue arrow flowing right. No right-side nodes.
- 96px: still clearly readable as two inputs → forward arrow.
- 32px: silhouette holds; strokes are crisp (no fuzz from sub-pixel AA).

---

## Task 2: Rewrite `assets/brand/relay-logo.svg`

**Files:**
- Modify: `assets/brand/relay-logo.svg` (full rewrite)

- [ ] **Step 1: Write the new lockup SVG**

Replace the entire file contents with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 64" role="img" aria-label="Relay" shape-rendering="geometricPrecision">
  <title>Relay</title>
  <g>
    <g fill="none" stroke="#18232d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 14 H22 L32 24 H40"/>
      <path d="M10 50 H22 L32 40 H40"/>
    </g>
    <g fill="#18232d">
      <circle cx="10" cy="14" r="4"/>
      <circle cx="10" cy="50" r="4"/>
    </g>
    <g stroke="#0052ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="32" y1="32" x2="76" y2="32"/>
      <polyline points="68,24 80,32 68,40"/>
    </g>
  </g>
  <text x="110" y="44"
        font-family="'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="42"
        font-weight="400"
        letter-spacing="-1"
        fill="#18232d">Relay</text>
</svg>
```

- [ ] **Step 2: Render lockup to PNG for visual verification**

```bash
/usr/bin/sips -s format png -Z 800 assets/brand/relay-logo.svg --out /tmp/relay-verify/logo-800.png
/usr/bin/sips -s format png -Z 200 assets/brand/relay-logo.svg --out /tmp/relay-verify/logo-200.png
```

Expected: both PNG files written. Read each and confirm:
- 800px: mark on the left, "Relay" wordmark in Inter weight 400 to the right, baselines visually aligned, no overlap.
- 200px (typical README render width): wordmark and mark both legible; arrow remains visible.

---

## Task 3: Replace the inline mark in `packages/relay-daemon/src/relay/daemon.ts`

**Files:**
- Modify: `packages/relay-daemon/src/relay/daemon.ts:1786-1809` (the inline `<svg>` inside the `.wordmark` span)

- [ ] **Step 1: Locate the current inline mark**

Run:
```bash
grep -n 'wordmark' packages/relay-daemon/src/relay/daemon.ts | head -5
```
Expected: matches around line 1391 (CSS) and line 1786 (HTML body). The block to replace starts with `<span class="wordmark">` and ends with `</span>` immediately before the `nav-meta` span.

- [ ] **Step 2: Replace the inline SVG inside `.wordmark`**

Find this exact block:

```html
    <span class="wordmark">
      <svg viewBox="0 0 96 64" role="img" aria-label="Relay" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" stroke="#18232d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 14 H22 L32 24 H42"/>
          <path d="M86 14 H74 L64 24 H54"/>
          <path d="M10 50 H22 L32 40 H42"/>
          <path d="M86 50 H74 L64 40 H54"/>
        </g>
        <g fill="#18232d">
          <circle cx="10" cy="14" r="4"/><circle cx="86" cy="14" r="4"/>
          <circle cx="10" cy="50" r="4"/><circle cx="86" cy="50" r="4"/>
        </g>
        <g stroke="#0052ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <line x1="20" y1="32" x2="60" y2="32"/>
          <polyline points="54,24 64,32 54,40"/>
        </g>
        <g fill="#0052ff">
          <circle cx="20" cy="32" r="4"/><circle cx="46" cy="32" r="4"/>
        </g>
      </svg>
      Relay
    </span>
```

and replace it with:

```html
    <span class="wordmark">
      <svg viewBox="0 0 96 64" role="img" aria-label="Relay" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" stroke="#18232d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 14 H22 L32 24 H40"/>
          <path d="M10 50 H22 L32 40 H40"/>
        </g>
        <g fill="#18232d">
          <circle cx="10" cy="14" r="4"/>
          <circle cx="10" cy="50" r="4"/>
        </g>
        <g stroke="#0052ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <line x1="32" y1="32" x2="76" y2="32"/>
          <polyline points="68,24 80,32 68,40"/>
        </g>
      </svg>
      Relay
    </span>
```

No other lines in the file change. CSS (`.wordmark`, `.wordmark svg`) and surrounding nav structure stay as-is.

- [ ] **Step 3: Run TypeScript typecheck**

```bash
npx tsc -p packages/relay-daemon/tsconfig.json --noEmit
```
Expected: exits 0 with no output. The HTML is inside a template string so a structural error here would surface as either a type error or a string-literal break.

- [ ] **Step 4: Sanity-check the rendered HTML**

```bash
node -e "process.env.PORT='0'; const m = require('./packages/relay-daemon/dist/relay/daemon.js'); console.log(typeof m);" 2>&1 | head -5
```
(If `dist/` is stale, first run `npm run build`.) Skip this step if the build is not currently green for unrelated reasons — the typecheck in Step 3 is the authoritative gate.

---

## Task 4: Append usage note to `assets/brand/README.md`

**Files:**
- Modify: `assets/brand/README.md` (append a new "Usage" section to the end)

- [ ] **Step 1: Append the section**

Append the following block to the end of `assets/brand/README.md` (preserve any existing content above):

```markdown

## Usage

- `relay-mark.svg` — icon-only mark. Use for favicons, small nav glyphs, anywhere the wordmark would be redundant. Default render: 48×32 px in nav bars, 24×16 px for favicons; remains legible down to 16 px wide.
- `relay-logo.svg` — full lockup (mark + "Relay" wordmark). Use for README heroes and marketing surfaces. Default render: 200×40 px or larger.
- `relay-logo-concept.png` — original concept reference. Do not embed in product surfaces; use the SVGs.

### Colors

The mark uses two colors only:

- Ink `#18232d` — input nodes, input traces, and wordmark.
- Relay Blue `#0052ff` — signal line and arrowhead.

On dark surfaces, every element currently rendered in ink swaps to `#ffffff`. Relay Blue is unchanged.

### Clear space

Reserve at least 25% of the mark width as empty canvas on all sides of the lockup. Never crop into this region.
```

- [ ] **Step 2: Verify the file parses as Markdown**

```bash
head -1 assets/brand/README.md && tail -20 assets/brand/README.md
```
Expected: original first line is preserved at the top; the new "## Usage" heading appears at the bottom; no merge artifacts.

---

## Task 5: End-to-end verification

**Files:** (no edits — verification only)

- [ ] **Step 1: Re-render all four SVG outputs at production sizes**

```bash
/usr/bin/sips -s format png -Z 96  assets/brand/relay-mark.svg --out /tmp/relay-verify/final-mark-96.png
/usr/bin/sips -s format png -Z 32  assets/brand/relay-mark.svg --out /tmp/relay-verify/final-mark-32.png
/usr/bin/sips -s format png -Z 600 assets/brand/relay-logo.svg --out /tmp/relay-verify/final-logo-600.png
```

Expected: three files written with no `sips` errors. Read each and visually confirm: clean strokes, correct colors, two-input asymmetry, no right-side terminating node.

- [ ] **Step 2: Render the daemon-inlined mark by extracting the SVG**

```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/relay-daemon/src/relay/daemon.ts', 'utf8');
const m = src.match(/<span class=\"wordmark\">\s*([\s\S]*?<\/svg>)/);
if (!m) { console.error('mark not found'); process.exit(1); }
fs.writeFileSync('/tmp/relay-verify/daemon-mark.svg', m[1]);
console.log('wrote /tmp/relay-verify/daemon-mark.svg');
"
/usr/bin/sips -s format png -Z 96 /tmp/relay-verify/daemon-mark.svg --out /tmp/relay-verify/daemon-mark-96.png
```

Expected: the extracted SVG renders identically to `final-mark-96.png` from Step 1 (byte-equivalent geometry). Diff visually via the Read tool — they should be indistinguishable.

- [ ] **Step 3: Confirm READMEs still reference the lockup**

```bash
grep -n 'relay-logo\|relay-mark' README.md
```

Expected: both files reference `assets/brand/relay-logo.svg` exactly. No changes needed; the file path is stable, the contents now resolve to the new lockup.

- [ ] **Step 4: Final typecheck**

```bash
npx tsc -p packages/relay-daemon/tsconfig.json --noEmit
```

Expected: exit 0, no output.

---

## Self-Review (already completed by the planner)

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Concept / Geometry — mark | Task 1 |
| Geometry — wordmark lockup | Task 2 |
| Color rules | Tasks 1, 2, 3 (markup); Task 4 (docs) |
| Rendering / `shape-rendering` attribute | Tasks 1, 2, 3 |
| Files affected: `assets/brand/relay-mark.svg` | Task 1 |
| Files affected: `assets/brand/relay-logo.svg` | Task 2 |
| Files affected: `packages/relay-daemon/src/relay/daemon.ts` | Task 3 |
| Files affected: `assets/brand/README.md` | Task 4 |
| Files affected: READMEs (no change) | Task 5 Step 3 |
| Verification (control panel, sips renders, typecheck) | Task 5 |

**Placeholder scan:** None. Every code block is final.

**Type consistency:** Coordinates and stroke widths match across Tasks 1, 2, and 3 (same geometry: traces end at `H40`, signal line `M32 32 H76`, arrowhead `68,24 80,32 68,40`, stroke-width 4, all integer coords). The earlier daemon inline used different coords (`H42`, signal `x1=20 x2=60`, two inner blue dots); Task 3 explicitly replaces that older block.
