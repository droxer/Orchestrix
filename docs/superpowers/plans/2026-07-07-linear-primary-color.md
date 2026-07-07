# Linear-ward Primary Color & Restraint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the single action color to Deep Cobalt across all four themes and decouple `--color-info` into a neutral cool slate, so the brand hue marks only action / selection / focus (Linear's restraint).

**Architecture:** Token-level only. All values live in `web/src/styles/tokens.css` (four theme blocks) plus three hardcoded theme-preview swatches in `web/src/styles/preferences.css`. Every other consumer references `var(--color-*)` and follows automatically. Verification is `grep` on token values + dev-server HMR/HTTP check (no CSS unit-test harness exists; no visual test is asserted programmatically).

**Tech Stack:** Plain CSS custom properties (three-tier token system), Next.js dev server with HMR at `localhost:3000`.

## Global Constraints

- **Do NOT create git commits** (user global rule). Each task ends with a grep + HMR verification instead of a commit.
- Colors are defined ONLY in `web/src/styles/tokens.css` primitives; the two `preferences.css` swatch exceptions are theme previews.
- The working tree currently holds an interim **Iris Blue** draft (`#4C6EF5` light / `#7C9BFF` dark); this plan replaces it with Deep Cobalt.
- Do not touch structural tokens (radii, motion, type, density, shadows), green/amber/red status semantics, or artifact "kind" accents.
- Deep Cobalt base = `#3B5BDB`. All `on-primary` fills must remain WCAG AA (already satisfied by the values below).
- Dev server is already running at `localhost:3000` (PID 69444); CSS edits hot-reload — no rebuild.

---

### Task 1: Light theme — cobalt ramp + info decouple

**Files:**
- Modify: `web/src/styles/tokens.css` (light `:root` action block, ~L135–139; `--color-info` line ~L193)

**Interfaces:**
- Produces: light `--color-primary: #3b5bdb`, `--color-primary-active: #2f4bc4`, `--color-primary-disabled: #c1cbf0`, `--color-info: #5b6779` (standalone slate, no longer aliasing primary). Later tasks and all `var(--color-primary)` / `.tone-info` consumers rely on these.

- [ ] **Step 1: Replace the light action ramp**

Find (interim Iris draft):

```css
  /* Action — iris blue is the single action color. Hue carries the
     action; status narrows to green/amber/red and remains distinct. */
  --color-primary: #4c6ef5;
  --color-primary-active: #3b5bdb;
  --color-primary-disabled: #c1cbf7;
```

Replace with:

```css
  /* Action — cobalt blue is the single action color. Hue carries the
     action; status narrows to green/amber/red and remains distinct. */
  --color-primary: #3b5bdb;
  --color-primary-active: #2f4bc4;
  --color-primary-disabled: #c1cbf0;
```

- [ ] **Step 2: Decouple `--color-info` (light)**

Find:

```css
  --color-info: var(--color-primary);  /* info folds into the brand action — no separate info hue */
```

Replace with:

```css
  --color-info: #5b6779;  /* neutral cool slate — decoupled from the action hue so brand marks action/selection/focus only */
```

- [ ] **Step 3: Verify the light values are present and Iris is gone**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  grep -nE "color-primary: #3b5bdb|color-primary-active: #2f4bc4|color-primary-disabled: #c1cbf0|color-info: #5b6779" tokens.css && \
  echo "--- iris residue in light (must be empty) ---" && \
  ! grep -n "#4c6ef5" tokens.css && echo "OK: no #4c6ef5"
```

Expected: the four cobalt/slate lines print; `OK: no #4c6ef5` prints.

- [ ] **Step 4: Verify HMR is healthy**

Run:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ --max-time 10
```

Expected: `HTTP 200`.

---

### Task 2: Dark theme — cobalt ramp + info decouple

**Files:**
- Modify: `web/src/styles/tokens.css` (dark `html[data-theme="dark"]` action block; its `--color-info` line)

**Interfaces:**
- Consumes: nothing from Task 1 (independent theme block).
- Produces: dark `--color-primary: #7089ff`, `--color-primary-active: #8fa3ff`, `--color-on-primary: #08112e`, `--color-info: #8c98ac`.

- [ ] **Step 1: Replace the dark action ramp**

Find (interim Iris draft):

```css
  /* Action — iris blue lifts to a luminous periwinkle on the dark canvas.
     The fill is bright, so on-primary flips to deep navy; selection and CTA
     rules inherit this automatically. */
  --color-primary: #7c9bff;
  --color-primary-active: #9cb4ff;
  --color-primary-disabled: color-mix(in srgb, #7c9bff 68%, var(--color-surface-dark));
  --color-on-primary: #081231;
```

Replace with:

```css
  /* Action — cobalt blue lifts to a luminous periwinkle on the dark canvas.
     The fill is bright, so on-primary flips to deep navy; selection and CTA
     rules inherit this automatically. */
  --color-primary: #7089ff;
  --color-primary-active: #8fa3ff;
  --color-primary-disabled: color-mix(in srgb, #7089ff 68%, var(--color-surface-dark));
  --color-on-primary: #08112e;
```

- [ ] **Step 2: Decouple `--color-info` (dark)**

In the dark block, find the line (it currently reads `--color-info: var(--color-primary);` and sits just after `--color-primary-disabled` / near `--color-code-number`):

```css
  --color-info: var(--color-primary);
```

Replace **the occurrence inside `html[data-theme="dark"]`** with:

```css
  --color-info: #8c98ac;
```

Note: `--color-info: var(--color-primary);` appears in multiple theme blocks. Anchor the edit to the dark block (between `--color-primary: #7089ff;` above and `--color-semantic-up: #34d399;` below). Later tasks handle the other blocks.

- [ ] **Step 3: Verify dark values present, iris gone**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  grep -nE "color-primary: #7089ff|color-on-primary: #08112e|color-info: #8c98ac" tokens.css && \
  echo "--- iris residue #7c9bff / #081231 (must be empty) ---" && \
  ! grep -nE "#7c9bff|#081231" tokens.css && echo "OK: no dark iris residue"
```

Expected: the three dark lines print; `OK: no dark iris residue` prints.

- [ ] **Step 4: Verify HMR healthy**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ --max-time 10`
Expected: `HTTP 200`.

---

### Task 3: High-contrast themes — cobalt ramp + info decouple

**Files:**
- Modify: `web/src/styles/tokens.css` (`html[data-theme="contrast"]` and `html[data-theme="contrast-dark"]` blocks)

**Interfaces:**
- Produces: contrast `--color-primary: #1e3a8a` (+ ramp, `--color-brand-soft: #e5eafb`, `--color-info: #2f3846`); contrast-dark `--color-primary: #8aa5ff` (+ ramp, `--color-brand-soft: rgba(138,165,255,.18)`, `--color-info: #c8d2e0`).

- [ ] **Step 1: Replace the contrast (light HC) ramp**

Find:

```css
  --color-primary: #1e40af;
  --color-primary-active: #17339a;
  --color-primary-disabled: #a9b8e8;
  --color-on-primary: #ffffff;
  --color-brand-soft: #e6ebfd;
```

Replace with:

```css
  --color-primary: #1e3a8a;
  --color-primary-active: #16306e;
  --color-primary-disabled: #a6b3e0;
  --color-on-primary: #ffffff;
  --color-brand-soft: #e5eafb;
```

- [ ] **Step 2: Decouple `--color-info` (contrast)**

Inside `html[data-theme="contrast"]`, find `--color-info: var(--color-primary);` (it sits just below `--color-semantic-down: #b00020;`) and replace with:

```css
  --color-info: #2f3846;
```

- [ ] **Step 3: Replace the contrast-dark ramp**

Find:

```css
  --color-primary: #93b0ff;
  --color-primary-active: #b7cbff;
  --color-primary-disabled: #2f3d78;
  --color-on-primary: #000000;
  --color-brand-soft: rgba(147, 176, 255, 0.18);
```

Replace with:

```css
  --color-primary: #8aa5ff;
  --color-primary-active: #b3c7ff;
  --color-primary-disabled: #2c3a70;
  --color-on-primary: #000000;
  --color-brand-soft: rgba(138, 165, 255, 0.18);
```

- [ ] **Step 4: Decouple `--color-info` (contrast-dark)**

Inside `html[data-theme="contrast-dark"]`, find `--color-info: var(--color-primary);` (below `--color-semantic-down: #ff6b75;`) and replace with:

```css
  --color-info: #c8d2e0;
```

- [ ] **Step 5: Verify contrast values present, iris gone; and NO `--color-info` still aliases primary**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  grep -nE "color-primary: #1e3a8a|color-brand-soft: #e5eafb|color-info: #2f3846|color-primary: #8aa5ff|color-info: #c8d2e0" tokens.css && \
  echo "--- old contrast iris #1e40af / #93b0ff (must be empty) ---" && \
  ! grep -nE "#1e40af|#93b0ff|#e6ebfd|rgba\(147, 176, 255" tokens.css && echo "OK: no contrast iris residue" && \
  echo "--- info must no longer alias primary anywhere ---" && \
  ! grep -n "color-info: var(--color-primary)" tokens.css && echo "OK: info fully decoupled"
```

Expected: the five lines print; `OK: no contrast iris residue`; `OK: info fully decoupled`.

- [ ] **Step 6: Verify HMR healthy**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ --max-time 10`
Expected: `HTTP 200`.

---

### Task 4: Swatches + doc-comment honesty

**Files:**
- Modify: `web/src/styles/preferences.css` (three `.pref-theme-swatch` rules, ~L355–375)
- Modify: `web/src/styles/tokens.css` (file-header "Visual language" paragraph, ~L13–17)

**Interfaces:**
- Consumes: cobalt hexes from Tasks 1–2.
- Produces: no tokens; brings hardcoded previews + docs in line with cobalt.

- [ ] **Step 1: Update the light swatch**

Find:

```css
.pref-theme-swatch[data-tone="light"]::after {
  background: #4c6ef5;
}
```

Replace `#4c6ef5` with `#3b5bdb`.

- [ ] **Step 2: Update the dark swatch**

Find:

```css
.pref-theme-swatch[data-tone="dark"]::after {
  background: #7c9bff;
}
```

Replace `#7c9bff` with `#7089ff`.

- [ ] **Step 3: Update the system (split) swatch gradient**

Find:

```css
  background: linear-gradient(90deg, #4c6ef5 0 50%, #7c9bff 50% 100%);
```

Replace with:

```css
  background: linear-gradient(90deg, #3b5bdb 0 50%, #7089ff 50% 100%);
```

- [ ] **Step 4: Update the file-header visual-language paragraph**

Find:

```css
   zinc, iris blue is the single brand ACTION color (lifting to luminous
   periwinkle on the dark canvas), and warm hairlines soften the product
   chrome. The action carries the hue; status narrows to success /
   danger / warning (green / amber / red) and "info" folds into the brand
   action — no separate info hue.
```

Replace with:

```css
   zinc, cobalt blue is the single brand ACTION color (lifting to luminous
   periwinkle on the dark canvas), and warm hairlines soften the product
   chrome. The action carries the hue; status narrows to success /
   danger / warning (green / amber / red); "info" is a neutral cool slate,
   decoupled — the brand hue marks action, selection, and focus only.
```

- [ ] **Step 5: Verify swatches + comment updated, no iris left in either file**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  grep -nE "#3b5bdb|#7089ff" preferences.css && \
  echo "--- iris residue across BOTH files (must be empty) ---" && \
  ! grep -rnE "#4c6ef5|#7c9bff|iris blue" preferences.css tokens.css && echo "OK: no iris residue anywhere"
```

Expected: the two swatch lines print; `OK: no iris residue anywhere` prints.

- [ ] **Step 6: Verify HMR healthy**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ --max-time 10`
Expected: `HTTP 200`.

---

### Task 5: Final restraint verification

**Files:** none (read-only verification).

**Interfaces:**
- Consumes: all tokens from Tasks 1–4.

- [ ] **Step 1: Confirm zero residual teal OR iris brand hexes in all stylesheets**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  ! grep -rniE "#115e59|#0f766e|#2dd4bf|#5eead4|#04201c|#0f4c47|#4c6ef5|#7c9bff|#081231|#1e40af|#93b0ff" . && \
  echo "OK: no teal/iris brand hexes remain"
```

Expected: `OK: no teal/iris brand hexes remain`.

- [ ] **Step 2: Confirm the restraint contract — info is standalone slate, brand-soft still derives from primary**

Run:

```bash
cd /Users/feihe/Workspace/Relay/web/src/styles && \
  echo "info definitions (should be 4 slate hexes, 0 aliases):" && \
  grep -nE "^\s*--color-info:" tokens.css && \
  echo "brand-soft light/dark still derive from primary:" && \
  grep -nE "color-brand-soft: color-mix\(in srgb, var\(--color-primary\)" tokens.css
```

Expected: four `--color-info:` lines with hex values (`#5b6779`, `#8c98ac`, `#2f3846`, `#c8d2e0`) and none reading `var(--color-primary)`; the light `--color-brand-soft` color-mix on primary prints.

- [ ] **Step 3: Confirm no CSS errors after HMR**

Run:

```bash
LOG=$(ls -t /Users/feihe/Workspace/Relay/web/.next/dev/logs/*.log 2>/dev/null | head -1); \
  tail -8 "$LOG" | grep -iE "error|fail" || echo "no CSS errors in dev log"
```

Expected: `no CSS errors in dev log`.

- [ ] **Step 4: Manual visual pass (human check, four themes)**

Open `localhost:3000`, switch through light / dark / high-contrast / high-contrast-dark (Preferences → Appearance) and confirm:
- Primary CTA, a selected row, and a focus ring render **cobalt**.
- A backlog `assigned`/`review` lane and an info dot render **cool slate**, not cobalt.
- Green/amber/red status indicators are unchanged.

---

## Self-Review

**Spec coverage:**
- Deep Cobalt ramp, 4 themes → Tasks 1, 2, 3. ✓
- `--color-info` decouple to slate, 4 themes → Tasks 1 (light), 2 (dark), 3 (both contrast). ✓
- 3 preference swatches → Task 4 Steps 1–3. ✓
- Doc-comment honesty (header + info) → Task 1 Step 2 (info comment) + Task 4 Step 4 (header). ✓
- Restraint contract acceptance → Task 5. ✓
- Verification plan (grep zero residue, info not aliasing primary, HTTP 200, no CSS errors, visual) → Task 5 Steps 1–4. ✓

**Placeholder scan:** No TBD/TODO; every edit shows exact find/replace CSS. ✓

**Type/value consistency:** Cobalt hexes are identical everywhere they appear (`#3b5bdb`, `#2f4bc4`, `#c1cbf0`, `#7089ff`, `#8fa3ff`, `#08112e`, `#1e3a8a`, `#16306e`, `#a6b3e0`, `#e5eafb`, `#8aa5ff`, `#b3c7ff`, `#2c3a70`; slate `#5b6779`, `#8c98ac`, `#2f3846`, `#c8d2e0`). Swatch cobalt matches the light/dark primaries. ✓

Note on the `--color-on-primary` unchanged values: light and contrast stay `#ffffff`, contrast-dark stays `#000000` (defined outside the edited ramps); only dark changes `#081231 → #08112e`. Covered in Task 2.
