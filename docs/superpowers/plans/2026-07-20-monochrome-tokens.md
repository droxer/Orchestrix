# Monochrome (Linear-style) Token Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the Relay web UI to a Linear-style black/white-only palette by remapping token values — no component or markup changes.

**Architecture:** Token-value-only edits in the three files allowed to originate colors (`web/src/styles/tokens/palette.css`, `web/src/styles/login.css`, `web/src/styles/preferences.css` — see the stylelint exceptions in `web/.stylelintrc.json`). Token names are unchanged, so every consumer (roles.css, shadcn-bridge.css, all components) re-themes automatically. A new guard test pins the monochrome values.

**Tech Stack:** CSS custom properties, stylelint, Node `node:test` (web tests in `web/tests/`, compiled to `dist/web/tests/` via `tsc -p packages/tsconfig.json`).

**Spec:** `docs/superpowers/specs/2026-07-20-monochrome-tokens-design.md`

**Review amendments (folded in):** the `--ok` grey is shifted off each register's `--ink-4` (dark `#7d848d`, light `#6b727b`) so admin dashboard bar segments stay distinguishable; the login backdrop glow uses `var(--lg-steel) 5%` (same rendered value as the literal, better traceability); and login.css adds `--lg-err: #f2f4f6` consumed by `.login-error` (the `--lg-down` remap had dropped the error banner below WCAG AA).

---

### Task 1: Guard test — palette.css values (failing)

**Files:**
- Create: `web/tests/monochromeTokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/monochromeTokens.test.ts` with exactly this content:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests run from dist/web/tests/, so the repo root is three levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readStyle = (rel: string) => readFileSync(path.join(repoRoot, "web", "src", "styles", rel), "utf8");

const palette = readStyle("tokens/palette.css");
const lightMarker = 'html[data-theme="light"]';
assert.ok(palette.includes(lightMarker), "palette.css is missing the light register marker");
const darkRegister = palette.slice(0, palette.indexOf(lightMarker));
const lightRegister = palette.slice(palette.indexOf(lightMarker));

describe("monochrome palette tokens", () => {
  it("dark register uses a white action fill with dark ink on top", () => {
    assert.match(darkRegister, /--action:\s*#f2f4f6;/);
    assert.match(darkRegister, /--action-hover:\s*#ffffff;/);
    assert.match(darkRegister, /--on-action:\s*#101214;/);
    assert.match(darkRegister, /--action-soft:\s*color-mix\(in srgb, #f2f4f6 9%, transparent\);/);
  });

  it("dark register status is a grey brightness hierarchy (loud = bright)", () => {
    assert.match(darkRegister, /--err:\s*#f2f4f6;/);
    assert.match(darkRegister, /--warn:\s*#99a0a8;/);
    assert.match(darkRegister, /--ok:\s*#7d848d;/);
  });

  it("light register inverts to a black action fill", () => {
    assert.match(lightRegister, /--action:\s*#16181b;/);
    assert.match(lightRegister, /--action-hover:\s*#000000;/);
    assert.match(lightRegister, /--on-action:\s*#ffffff;/);
    assert.match(lightRegister, /--action-soft:\s*color-mix\(in srgb, #16181b 7%, transparent\);/);
    assert.match(lightRegister, /--err:\s*#16181b;/);
    assert.match(lightRegister, /--warn:\s*#5c636b;/);
    assert.match(lightRegister, /--ok:\s*#6b727b;/);
  });

  it("no chromatic graphite-era values remain in palette.css", () => {
    const dead = [
      "#6ba1d4", "#84b3e0", "#33689e", "#2a5786", // steel blues
      "#15202c", "#e4eef7", // blue-tinted action-soft washes
      "#3fb96c", "#1e8a4c", // greens
      "#d9a13f", "#9a6b1a", // ambers
      "#e5635f", "#c93d3d", // reds
      "#0e1216", // old dark-register on-action
    ];
    for (const value of dead) {
      assert.ok(!palette.includes(value), `palette.css still contains ${value}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: FAIL — the first assertion errors with a message like `assert.match(darkRegister, /--action:\s*#f2f4f6;/)` failing, because `--action` is still `#6ba1d4`.

Do not commit yet — the test and its fix land together in Task 2.

---

### Task 2: Remap palette.css to monochrome

**Files:**
- Modify: `web/src/styles/tokens/palette.css` (header lines 1–8, dark action/status lines 25–36, light action/status lines 130–137)

- [ ] **Step 1: Update the file header comment**

Replace lines 1–4:

```css
/* Graphite palette — raw values, both registers side by side.
   True-neutral canvas, one steel-blue action color, status as
   dot/border/text only. The only file allowed to originate a color.
   Rationale: docs/superpowers/specs/2026-07-19-graphite-tokens-design.md
```

with:

```css
/* Monochrome palette — raw values, both registers side by side.
   True-neutral canvas, white/black action (Linear-style), status as a
   grey brightness hierarchy on dot/border/text only. The only file
   allowed to originate a color.
   Rationale: docs/superpowers/specs/2026-07-20-monochrome-tokens-design.md
   (supersedes the color values of 2026-07-19-graphite-tokens-design.md)
```

- [ ] **Step 2: Remap the dark-register action and status values**

Replace:

```css
  /* Action — the only chromatic action color. No disabled hex: disabled
     is opacity. Bright on dark, so on-action text is dark ink. */
  --action: #6ba1d4;
  --action-hover: #84b3e0;
  --action-soft: #15202c; /* selection wash, active nav */
  --on-action: #0e1216;

  /* Status — dot/border/text only, never fills, never actions.
     One value per hue, AA-safe as small text. */
  --ok: #3fb96c;
  --warn: #d9a13f;
  --err: #e5635f;
```

with:

```css
  /* Action — white fill on the dark canvas, dark ink on top
     (Linear-style). No disabled hex: disabled is opacity. */
  --action: #f2f4f6;
  --action-hover: #ffffff;
  --action-soft: color-mix(in srgb, #f2f4f6 9%, transparent); /* selection wash, active nav */
  --on-action: #101214;

  /* Status — a grey brightness hierarchy: loud = bright, calm = dim.
     Dot/border/text only, never fills, never actions.
     Warn/err are AA-safe as small text; ok is the decorative-calm tier. */
  --ok: #7d848d;
  --warn: #99a0a8;
  --err: #f2f4f6;
```

- [ ] **Step 3: Remap the light-register action and status values**

Replace:

```css
  --action: #33689e;
  --action-hover: #2a5786;
  --action-soft: #e4eef7;
  --on-action: #ffffff;

  --ok: #1e8a4c;
  --warn: #9a6b1a;
  --err: #c93d3d;
```

with:

```css
  --action: #16181b;
  --action-hover: #000000;
  --action-soft: color-mix(in srgb, #16181b 7%, transparent);
  --on-action: #ffffff;

  --ok: #6b727b;
  --warn: #5c636b;
  --err: #16181b;
```

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Run stylelint on the touched file**

Run: `npm run lint:css -w web`
Expected: exit 0, no warnings (palette.css is exempt from `color-no-hex` via `web/.stylelintrc.json`; the new `color-mix` calls are inside that exemption).

- [ ] **Step 6: Commit**

```bash
git add web/tests/monochromeTokens.test.ts web/src/styles/tokens/palette.css
git commit -m "feat(web): remap palette tokens to monochrome (Linear-style)"
```

---

### Task 3: Neutralize login.css's pinned pre-auth palette

**Files:**
- Modify: `web/tests/monochromeTokens.test.ts` (append a new describe block)
- Modify: `web/src/styles/login.css` (header comment lines 8–16, pinned vars lines 27–38, backdrop gradient line 45)

- [ ] **Step 1: Add the failing login assertions**

Append to `web/tests/monochromeTokens.test.ts` (after the existing describe block):

```ts
const login = readStyle("login.css");

describe("monochrome login palette", () => {
  it("pins neutral pre-auth accents", () => {
    assert.match(login, /--lg-steel:\s*#f2f4f6;/);
    assert.match(login, /--lg-steel-active:\s*#ffffff;/);
    assert.match(login, /--lg-on-steel:\s*#101214;/);
    assert.match(login, /--lg-amber:\s*#99a0a8;/);
    assert.match(login, /--lg-on-amber:\s*#101214;/);
    assert.match(login, /--lg-up:\s*#f2f4f6;/);
    assert.match(login, /--lg-down:\s*#6b727b;/);
    assert.match(login, /--lg-err:\s*#f2f4f6;/);
    assert.match(login, /\.login-error \{[^}]*var\(--lg-err\)/s);
    assert.match(login, /color-mix\(in srgb, var\(--lg-steel\) 5%, transparent\)/);
  });

  it("drops steel-blue, amber, and status hues", () => {
    const dead = ["#6ba1d4", "#84b3e0", "#d9a13f", "#2b1c02", "#3fb96c", "#e5635f", "#0e1216"];
    for (const value of dead) {
      assert.ok(!login.includes(value), `login.css still contains ${value}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: FAIL — `login.css still contains #6ba1d4` (or the first `--lg-steel` match failing).

- [ ] **Step 3: Update the login.css header comment**

Replace (lines 8–16):

```css
   Color is pinned via local --lg-* variables whose values are lifted
   verbatim from the dark (default) register in tokens/palette.css
   (graphite canvas, steel-blue action, amber attention). Spacing,
   type scale, and radii are theme-independent tokens and are used
   directly. Documented stylelint exception — see web/.stylelintrc.json.

   Bootstrap mode (data-mode="bootstrap") swings the accent from steel
   to amber: the plane is awaiting credentials, not ready.
```

with:

```css
   Color is pinned via local --lg-* variables whose values are lifted
   verbatim from the dark (default) register in tokens/palette.css
   (graphite canvas, white action, mid-grey attention). Spacing,
   type scale, and radii are theme-independent tokens and are used
   directly. Documented stylelint exception — see web/.stylelintrc.json.

   Bootstrap mode (data-mode="bootstrap") swings the accent from white
   to mid grey: the plane is awaiting credentials, not ready.
```

- [ ] **Step 4: Remap the pinned --lg-* values**

Replace (lines 27–38):

```css
  --lg-steel: #6ba1d4;
  --lg-steel-active: #84b3e0;
  --lg-on-steel: #0e1216; /* text-on-action (dark ink on the steel fill) */
  --lg-on-amber: #2b1c02; /* text-on-amber for bootstrap-mode fills */
  --lg-up: #3fb96c;
  --lg-amber: #d9a13f;
  --lg-down: #e5635f;
  /* Mode accent — steel while attaching, amber during first-run setup. */
  --lg-accent: var(--lg-steel);
  /* Pin the action color to the pre-auth dark steel so RelayMark's lead
     chevron stays graphite steel even when the operator's saved theme is light. */
  --action: var(--lg-steel);
```

with:

```css
  /* Names --lg-steel/--lg-amber are historical; the values are neutral now. */
  --lg-steel: #f2f4f6;
  --lg-steel-active: #ffffff;
  --lg-on-steel: #101214; /* text-on-action (dark ink on the white fill) */
  --lg-on-amber: #101214; /* text on the mid-grey bootstrap fill */
  --lg-up: #f2f4f6;
  --lg-amber: #99a0a8;
  --lg-down: #6b727b;
  --lg-err: #f2f4f6; /* error is the loud/bright tier — dots stay calm; consumed by .login-error */
  /* Mode accent — white while attaching, mid grey during first-run setup. */
  --lg-accent: var(--lg-steel);
  /* Pin the action color to the pre-auth white so RelayMark's lead
     chevron stays neutral white even when the operator's saved theme is light. */
  --action: var(--lg-steel);
```

- [ ] **Step 5: Dim the backdrop radial glow**

Replace (line 45):

```css
    radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, var(--lg-steel) 7%, transparent), transparent 55%),
```

with:

```css
    radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, var(--lg-steel) 5%, transparent), transparent 55%),
```

(`--lg-steel` is now `#f2f4f6`; dropping 7% → 5% keeps the white glow subtle.)

- [ ] **Step 6: Run the guard test to verify it passes**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 7: Run stylelint**

Run: `npm run lint:css -w web`
Expected: exit 0 (login.css has a documented `color-no-hex` exemption).

- [ ] **Step 8: Commit**

```bash
git add web/src/styles/login.css web/tests/monochromeTokens.test.ts
git commit -m "feat(web): neutralize login screen pinned palette"
```

---

### Task 4: Update preferences.css theme swatches

**Files:**
- Modify: `web/tests/monochromeTokens.test.ts` (append a new describe block)
- Modify: `web/src/styles/preferences.css` (swatch block lines 265–298)

- [ ] **Step 1: Add the failing swatch assertions**

Append to `web/tests/monochromeTokens.test.ts`:

```ts
const preferences = readStyle("preferences.css");

describe("monochrome theme-picker swatches", () => {
  it("mirrors the monochrome registers", () => {
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="light"\]::after \{\s*background: #16181b;/);
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="dark"\]::after \{\s*background: #f2f4f6;/);
    assert.match(preferences, /linear-gradient\(90deg, #16181b 0 50%, #f2f4f6 50% 100%\)/);
  });

  it("drops the steel-blue swatch accents", () => {
    assert.ok(!preferences.includes("#33689e"), "preferences.css still contains #33689e");
    assert.ok(!preferences.includes("#6ba1d4"), "preferences.css still contains #6ba1d4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: FAIL — `preferences.css still contains #33689e`.

- [ ] **Step 3: Update the swatch accent values and comments**

Replace (lines 276–287):

```css
.pref-theme-swatch[data-tone="light"]::after {
  background: #33689e; /* light register's deepened steel blue */
}

.pref-theme-swatch[data-tone="dark"] {
  background: #101214;
  border-color: color-mix(in srgb, #f2f4f6 14%, transparent);
}

.pref-theme-swatch[data-tone="dark"]::after {
  background: #6ba1d4; /* dark register's steel-blue action */
}
```

with:

```css
.pref-theme-swatch[data-tone="light"]::after {
  background: #16181b; /* light register's black action */
}

.pref-theme-swatch[data-tone="dark"] {
  background: #101214;
  border-color: color-mix(in srgb, #f2f4f6 14%, transparent);
}

.pref-theme-swatch[data-tone="dark"]::after {
  background: #f2f4f6; /* dark register's white action */
}
```

- [ ] **Step 4: Update the system swatch split gradient**

Replace (lines 294–298):

```css
.pref-theme-swatch[data-tone="system"]::after {
  /* The action color is register-varying (deepened on light / bright on
     dark), so the split-gradient dot shows both, half per register. */
  background: linear-gradient(90deg, #33689e 0 50%, #6ba1d4 50% 100%);
}
```

with:

```css
.pref-theme-swatch[data-tone="system"]::after {
  /* The action color is register-varying (black on light / white on
     dark), so the split-gradient dot shows both, half per register. */
  background: linear-gradient(90deg, #16181b 0 50%, #f2f4f6 50% 100%);
}
```

- [ ] **Step 5: Run the guard test to verify it passes**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/monochromeTokens.test.js`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles/preferences.css web/tests/monochromeTokens.test.ts
git commit -m "feat(web): update theme-picker swatches to monochrome accents"
```

---

### Task 5: Full verification

**Files:** none modified

- [ ] **Step 1: Stylelint across all web CSS**

Run: `npm run lint:css -w web`
Expected: exit 0, no warnings.

- [ ] **Step 2: Full web test suite**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/*.test.js`
Expected: all test files pass, 0 failures (confirms the new guard test coexists with the existing suites).

- [ ] **Step 3: Visual pass (manual, requires a browser)**

Run: `make web` and open `http://127.0.0.1:5000`. Check:

1. Login screen (attach mode): white primary button with near-black text, white readiness dots, subtle white radial glow.
2. Login screen bootstrap mode (first-run setup, `data-mode="bootstrap"`): mid-grey accent instead of amber.
3. App, dark theme: white primary buttons/CTAs with dark text, white focus rings, grey status dots (err brightest, ok dimmest), neutral selection/active-nav wash.
4. App, light theme (Preferences → theme → light): black primary buttons with white text, black focus rings, inverted status greys.
5. Preferences theme-picker swatches: light swatch shows a black accent bar, dark swatch a white one, system swatch split black/white.
6. Admin dashboard stacked bar chart: `tone-good` and `tone-muted` segments are visibly distinct greys in both themes.
7. An invalid/danger form field (e.g. a failing validation state): confirm the danger focus ring is visible — it is intentionally identical to the normal focus ring under monochrome (spec-accepted tradeoff), so verify the field state is still communicated by the error text/icon.
8. Login error banner (submit bad credentials): bright (`--lg-err`) text/border, clearly legible on the dark canvas.

- [ ] **Step 4: Commit any fixes the visual pass surfaces, or record completion**

If the visual pass finds a defect, fix it in the owning file, extend `web/tests/monochromeTokens.test.ts` if a token value was wrong, and commit with a message describing the fix. If it passes clean, there is nothing to commit — the plan is done.
