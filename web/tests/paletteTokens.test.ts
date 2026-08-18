import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_DIR = path.join("web", "src", "styles");
const MARKER = path.join(STYLES_DIR, "tokens", "palette.css");

// This file runs both from the source tree (web/tests/) and from the built
// output (dist/web/tests/), so the repo root sits at different depths. Walk up
// from wherever this module lives until the styles we read come into view.
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`unable to locate ${MARKER} above ${path.dirname(fileURLToPath(import.meta.url))}`);
    dir = parent;
  }
}

const repoRoot = findRepoRoot();
const readStyle = (rel: string) => readFileSync(path.join(repoRoot, STYLES_DIR, rel), "utf8");
const readWebSource = (rel: string) => readFileSync(path.join(repoRoot, "web", "src", rel), "utf8");

const palette = readStyle("tokens/palette.css");
const lightMarker = 'html[data-theme="light"]';
assert.ok(palette.includes(lightMarker), "palette.css is missing the light register marker");
const darkRegister = palette.slice(0, palette.indexOf(lightMarker));
const lightRegister = palette.slice(palette.indexOf(lightMarker));
// Declarations only — palette.css documents rejected values in prose on
// purpose, and a substring check would read its own explanations as code.
const paletteCode = palette.replace(/\/\*[\s\S]*?\*\//g, "");

/** WCAG 2.x relative luminance / contrast, so the ramp is checked as a
 *  property rather than pinned as a list of hexes that says nothing about
 *  whether the result is readable. */
function contrast(a: string, b: string): number {
  const channel = (hex: string, i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) =>
    0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokenIn = (register: string, name: string): string => {
  const value = register.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`))?.[1];
  assert.ok(value, `${name} is not declared as a literal hex in its register`);
  return value;
};

/** Max RGB channel spread — the near-neutrality measure for the olive
 *  greys. An olive tone keeps r ≈ g ≥ b within a tight band; a chromed
 *  status (a green ok, a red err) blows the spread open. */
function channelSpread(hex: string): number {
  const channels = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

describe("Fieldnotes palette tokens", () => {
  it("declares both registers: dark on :root, cream on html[data-theme=light]", () => {
    assert.match(palette, /:root\s*\{/);
    for (const name of ["--surface-0", "--ink-1", "--live", "--link-blue"]) {
      assert.match(darkRegister, new RegExp(`${name}:\\s*#[0-9a-f]{6};`), `dark register is missing ${name}`);
      assert.match(lightRegister, new RegExp(`${name}:\\s*#[0-9a-f]{6};`), `light register is missing ${name}`);
    }
  });

  it("makes --action register-invariant highlighter yellow", () => {
    // The one saturated hue in the system is the SAME value on both canvases;
    // the light register retunes only the hover and the wash.
    assert.match(darkRegister, /--action:\s*#f7a501;/);
    assert.doesNotMatch(lightRegister, /--action:\s*#/, "light register must not redeclare --action — it is register-invariant");
    assert.match(darkRegister, /--on-action:\s*#23251d;/);
    assert.doesNotMatch(lightRegister, /--on-action:\s*#/, "--on-action is register-invariant too");
    assert.match(lightRegister, /--action-hover:\s*#[0-9a-f]{6};/, "light register retunes the hover toward the ink");
    assert.match(lightRegister, /--action-soft:\s*color-mix\(in srgb, #f7a501 \d+%, transparent\);/);
  });

  it("keeps --on-action legible on the fill and its hover in both registers", () => {
    // --action and --on-action are register-invariant (declared once, on
    // :root); only the hover retunes per register.
    const onAction = tokenIn(darkRegister, "--on-action");
    const action = tokenIn(darkRegister, "--action");
    assert.ok(contrast(onAction, action) >= 4.5, `--on-action on --action is ${contrast(onAction, action).toFixed(2)}:1`);
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const ratio = contrast(onAction, tokenIn(register, "--action-hover"));
      assert.ok(ratio >= 4.5, `${label} --on-action on --action-hover is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor`);
    }
  });

  it("pins both registers as tokens so nothing hand-copies a hex", () => {
    // Surfaces that must not follow the active theme (pre-auth login, theme
    // swatches, diff chrome) read these instead of re-declaring literals.
    for (const name of [
      "--dark-canvas", "--dark-surface", "--dark-elevated",
      "--dark-ink", "--dark-ink-strong", "--dark-body", "--dark-ink-soft",
      "--light-canvas", "--light-ink",
    ]) {
      assert.match(darkRegister, new RegExp(`${name}:\\s*#[0-9a-f]{6};`), `${name} is not pinned`);
    }
  });

  it("keeps the pinned registers in step with the live ones", () => {
    // The --dark-*/--light-* tokens exist so theme-independent chrome (pre-auth
    // login, theme swatches) never hand-copies a hex. That only holds if they
    // track the register they mirror — they silently drifted apart the moment
    // the canvas moved, which is exactly the failure they were meant to stop.
    const declared = (register: string, name: string) =>
      register.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`))?.[1];
    assert.equal(declared(darkRegister, "--dark-canvas"), declared(darkRegister, "--surface-0"));
    assert.equal(declared(darkRegister, "--dark-surface"), declared(darkRegister, "--surface-1"));
    assert.equal(declared(darkRegister, "--dark-elevated"), declared(darkRegister, "--surface-3"));
    assert.equal(declared(darkRegister, "--dark-ink"), declared(darkRegister, "--ink-1"));
    assert.equal(declared(darkRegister, "--dark-body"), declared(darkRegister, "--ink-2"));
    assert.equal(declared(darkRegister, "--dark-ink-soft"), declared(darkRegister, "--ink-3"));
    assert.equal(declared(darkRegister, "--light-canvas"), declared(lightRegister, "--surface-0"));
    assert.equal(declared(darkRegister, "--light-ink"), declared(lightRegister, "--ink-1"));
  });

  it("marks live work in the highlighter family, legible as small text in both registers", () => {
    // Fieldnotes merges Phosphor's two chromatic roles into one hue: the yellow
    // that fills the primary CTA also marks live work, separated by channel
    // (filled pill = action, pulsing dot/ring/timer = live). Assert the hue
    // family (r > g > b), not an exact hex — and the AA floor, because an
    // elapsed timer set in --live is legible, not decorative.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const live = tokenIn(register, "--live");
      const [r, g, b] = [0, 1, 2].map((i) => parseInt(live.slice(1 + i * 2, 3 + i * 2), 16));
      assert.ok(r > g && g > b, `${label} --live ${live} left the yellow/gold family (r > g > b required)`);
      const ratio = contrast(live, tokenIn(register, "--surface-0"));
      assert.ok(ratio >= 4.5, `${label} --live on --surface-0 is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor`);
    }
  });

  it("offers no --live fill token", () => {
    // The palette's own rule is "dot/border/text only, never fills". A
    // --live-wash existed for exactly zero call sites and contradicted that
    // rule by handing out a translucent fill; tint a ring (pulse-ring) or an
    // ink instead. Guard the declaration so it cannot drift back in.
    assert.doesNotMatch(paletteCode, /--live-wash\s*:/, "--live is never a fill; do not reintroduce a wash token");
  });

  it("originates --live only in palette.css", () => {
    // The scope rule is enforced, not merely documented: no other token file may
    // declare the accent, and stylelint already blocks raw hex outside palette.
    for (const file of ["tokens/roles.css", "tokens/base.css", "tokens/shadcn-bridge.css"]) {
      const source = readStyle(file);
      assert.doesNotMatch(source, /--live\s*:/, `${file} must not declare --live`);
    }
  });

  it("keeps the link blue above the AA floor on every plane in both registers", () => {
    // Blue is the system's second sanctioned hue, reserved for wayfinding:
    // anchors in prose and the focus ring. It must read as text wherever it
    // lands, so the bar is every plane, not just the canvas.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      for (const plane of ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]) {
        const ratio = contrast(tokenIn(register, "--link-blue"), tokenIn(register, plane));
        assert.ok(ratio >= 4.5, `${label} --link-blue on ${plane} is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor`);
      }
    }
  });

  it("keeps status tones near-neutral olive greys, so no one re-chromes status", () => {
    // The old guard asserted the WHOLE palette was grey; Fieldnotes legalises
    // exactly two hues (highlighter yellow, link blue) by design. The inverse
    // guard still holds where it matters: ok/warn/err are a brightness
    // hierarchy of olive greys (loud = bright in dark, loud = dark in light),
    // never a green/red/amber traffic light. The spread bar is 24 — the
    // declared tones measure ≤15; a chromed status measures 60+.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      for (const tone of ["--ok", "--warn", "--err"]) {
        const value = tokenIn(register, tone);
        const spread = channelSpread(value);
        assert.ok(spread <= 24, `${label} ${tone} ${value} has channel spread ${spread} — status was re-chromed`);
      }
    }
    // Info is not a color — neutral notice text aliased to the ink ramp.
    const roles = readStyle("tokens/roles.css");
    assert.match(roles, /--info:\s*var\(--ink-3\);/);
  });

  it("no Phosphor-era values remain in palette.css", () => {
    const dead = [
      "#0b0d0f", "#22262b", // old dark canvas / elevated
      "#f2f4f6", "#c9ced4", "#a6adb5", // old dark ink ramp + white action
      "#f1f3f5", "#16181b", "#101214", // old light canvas, black action, on-action
      "#8f96a0", "#b2b9c1", "#484f57", "#5a6169", // old grey status tones
      "#3ee08a", "#0b7a45", "#0f8a4e", // the greens — --live is yellow now
    ];
    for (const value of dead) {
      assert.ok(!paletteCode.includes(value), `palette.css still declares ${value}`);
    }
  });
});

const login = readStyle("login.css");

describe("Fieldnotes login palette", () => {
  it("pins the pre-auth ramp via the always-dark register tokens", () => {
    // The --lg-* names alias palette.css's pinned register rather than
    // re-declaring its hexes, so the two can never drift apart.
    assert.match(login, /--lg-canvas:\s*var\(--dark-canvas\);/);
    assert.match(login, /--lg-elevated:\s*var\(--dark-elevated\);/);
    assert.match(login, /--lg-ink:\s*var\(--dark-ink\);/);
    assert.match(login, /--lg-body:\s*var\(--dark-body\);/);
    assert.match(login, /--lg-muted:\s*var\(--dark-ink-soft\);/);
    assert.match(login, /--lg-err:\s*var\(--dark-ink\);/);
    assert.match(login, /\.login-error \{[^}]*var\(--lg-err\)/s);
  });

  it("lets the register-invariant yellow CTA reach pre-auth", () => {
    // Phosphor pinned --action to the pre-auth white on .login-screen so the
    // sign-in button stayed neutral. Fieldnotes' CTA is the highlighter yellow
    // in EVERY context — it is the brand's single hue — so the override is
    // gone and the login CTA aliases :root's action tokens like everything
    // else. Guard the declaration so the pin cannot drift back in.
    const loginCode = login.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(loginCode, /--action\s*:/, "login.css must not override --action; the yellow CTA reaches pre-auth");
    assert.match(login, /--lg-steel:\s*var\(--action\);/);
    assert.match(login, /--lg-steel-active:\s*var\(--action-hover\);/);
    assert.match(login, /--lg-on-steel:\s*var\(--on-action\);/);
  });

  it("originates no color of its own", () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(login), "login.css must not contain a raw hex color");
  });

  it("drops steel-blue, amber, and status hues", () => {
    const dead = ["#6ba1d4", "#84b3e0", "#d9a13f", "#2b1c02", "#3fb96c", "#e5635f", "#0e1216"];
    for (const value of dead) {
      assert.ok(!login.includes(value), `login.css still contains ${value}`);
    }
  });
});

const preferences = readStyle("preferences.css");

describe("Fieldnotes theme-picker swatches", () => {
  it("mirrors the two registers through the pinned tokens", () => {
    // Swatches must show both registers at once, so the canvas can't use the
    // theme-varying --surface-0 — they read the pinned tokens, which stay in
    // sync with the registers by construction.
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="light"\] \{\s*background: var\(--light-canvas\);/);
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="dark"\] \{\s*background: var\(--dark-canvas\);/);
  });

  it("shows one register-invariant yellow strip, not a per-register split", () => {
    // Phosphor's action color was register-varying (white on dark, black on
    // light), so the swatch strip split a gradient half per register. The
    // Fieldnotes action is the SAME highlighter yellow on both canvases, so
    // every swatch strip is simply var(--action) and the split is gone.
    for (const tone of ["light", "dark", "system"]) {
      assert.match(
        preferences,
        new RegExp(`\\.pref-theme-swatch\\[data-tone="${tone}"\\]::after \\{[^}]*background: var\\(--action\\);`, "s"),
        `${tone} swatch strip must be the register-invariant --action yellow`,
      );
    }
    assert.doesNotMatch(
      preferences,
      /linear-gradient\(90deg, var\(--light-ink\) 0 50%, var\(--dark-ink\) 50% 100%\)/,
      "the split-ink strip was a Phosphor artifact — one yellow serves both registers",
    );
  });

  it("originates no color of its own", () => {
    assert.ok(
      !/#[0-9a-fA-F]{3,8}\b/.test(preferences),
      "preferences.css must not contain a raw hex color",
    );
  });

  it("drops the steel-blue swatch accents", () => {
    assert.ok(!preferences.includes("#33689e"), "preferences.css still contains #33689e");
    assert.ok(!preferences.includes("#6ba1d4"), "preferences.css still contains #6ba1d4");
  });
});

describe("theme color ownership", () => {
  const appStorage = readWebSource("lib/appStorage.ts");
  const layout = readWebSource("app/layout.tsx");

  it("derives browser chrome from the active canvas token", () => {
    assert.match(appStorage, /getPropertyValue\(["']--surface-0["']\)/);
    assert.match(layout, /getPropertyValue\(["']--surface-0["']\)/);
  });

  it("does not duplicate palette hexes in theme runtime code", () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(appStorage), "appStorage.ts must not contain raw theme colors");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(layout), "layout.tsx must not contain raw theme colors");
    assert.doesNotMatch(layout, /themeColor\s*:/);
  });
});

describe("ink ramp legibility", () => {
  // The bar is the WORST plane a tier can land on, not the canvas: meta text
  // sits on drawers and inset wells too, and those are the planes closest to
  // the ink (dark: --surface-3, the lightest plane; light: --surface-2, the
  // recessed fill that moves TOWARD the ink). Sweeping every plane subsumes
  // the worst one.
  for (const [label, register, planes] of [
    ["dark", darkRegister, ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]],
    ["light", lightRegister, ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]],
  ] as const) {
    it(`keeps every ${label} ink tier above the AA floor on every plane`, () => {
      for (const ink of ["--ink-1", "--ink-2", "--ink-3", "--ink-4"]) {
        for (const plane of planes) {
          const ratio = contrast(tokenIn(register, ink), tokenIn(register, plane));
          assert.ok(
            ratio >= 4.5,
            `${label} ${ink} on ${plane} is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor for text`
          );
        }
      }
    });

    it(`keeps the ${label} ink tiers distinguishable from each other`, () => {
      // A ramp that passes AA by collapsing into one olive is not a ramp. The
      // floor is 1.05 rather than something prouder because the light register
      // is squeezed between white and the 4.5:1 floor and genuinely has less
      // room than dark — the calm-end steps measure 1.13 dark / 1.06 light
      // (palette.css documents the squeeze). 1.05 still rejects a collapse.
      const tiers = ["--ink-1", "--ink-2", "--ink-3", "--ink-4"].map((n) => tokenIn(register, n));
      for (let i = 0; i < tiers.length - 1; i += 1) {
        const step = contrast(tiers[i], tiers[i + 1]);
        assert.ok(step >= 1.05, `${label} ink-${i + 1} → ink-${i + 2} is only ${step.toFixed(2)}:1 apart`);
      }
    });
  }

  it("keeps status tones legible as text on every plane", () => {
    // The tones render as text (counts, inline state labels), not only as dots.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      for (const tone of ["--ok", "--warn", "--err"]) {
        for (const plane of ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]) {
          const ratio = contrast(tokenIn(register, tone), tokenIn(register, plane));
          assert.ok(ratio >= 4.5, `${label} ${tone} on ${plane} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });
});

describe("surface ladder", () => {
  it("gives the canvas → card step room to read without a drop shadow", () => {
    // Elevation is flat, so this step plus a hairline is ALL that separates a
    // card from the page. Measured on the Fieldnotes ramps: 1.09 dark
    // (olive-charcoal → card), 1.13 light (cream → warm white).
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const step = contrast(tokenIn(register, "--surface-0"), tokenIn(register, "--surface-1"));
      assert.ok(step >= 1.07, `${label} canvas → card is only ${step.toFixed(3)}:1`);
    }
  });

  it("never lets the floating plane collapse into the card plane", () => {
    // In the light register the ladder is one of DISTINCTNESS, not lightness:
    // --surface-3 is pure white ABOVE the near-white card, while --surface-2
    // recedes below the canvas. A dialog must never read as the card it floats
    // over.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const card = tokenIn(register, "--surface-1");
      const float = tokenIn(register, "--surface-3");
      assert.notEqual(float, card, `${label} --surface-3 is identical to --surface-1`);
      const spread = contrast(tokenIn(register, "--surface-0"), float);
      assert.ok(spread >= 1.1, `${label} canvas → floating plane is only ${spread.toFixed(3)}:1`);
    }
  });
});

describe("focus contract", () => {
  const roles = readStyle("tokens/roles.css");

  it("draws the ring with outline in link blue, which no ancestor's overflow can clip", () => {
    // A box-shadow ring is painted inside the nearest overflow:hidden ancestor
    // and gets sliced off by it. This app is built out of scrollers and clipped
    // rows, so the ring silently lost an edge against container boundaries.
    // The ring is LINK BLUE, not the action yellow: #f7a501 measures 1.7:1 on
    // the cream canvas, far under the 3:1 floor for focus indicators.
    assert.match(roles, /--focus-outline:\s*var\(--focus-w\) solid var\(--link\);/);
    assert.match(roles, /--focus-offset:\s*\d+px;/);
    assert.doesNotMatch(roles, /--focus-ring\s*:/, "the box-shadow ring contract was replaced by outline");

    const shadowRings = [...surfaceSheetNames()].filter((name) =>
      /box-shadow:[^;]*--focus-(ring|outline)/.test(readStyle(name))
    );
    assert.deepEqual(shadowRings, [], "focus rings are outlines now — do not paint one as a box-shadow");
  });

  it("distinguishes the danger ring by shape, because it cannot differ by colour", () => {
    // --err and --ink-1 resolve to the SAME value in both registers (the bad
    // tone is the loud end of the brightness hierarchy), so a colour-only
    // danger ring would be pixel-identical to error-tone text. Colour is
    // unavailable; shape is not.
    for (const register of [darkRegister, lightRegister]) {
      assert.equal(
        tokenIn(register, "--err"),
        tokenIn(register, "--ink-1"),
        "if these ever diverge, the shape encoding below can be revisited"
      );
    }
    const normal = roles.match(/--focus-outline:\s*([^;]+);/)?.[1] ?? "";
    const danger = roles.match(/--focus-outline-danger:\s*([^;]+);/)?.[1] ?? "";
    assert.notEqual(danger, normal, "the danger ring must not be a copy of the normal ring");
    assert.match(danger, /dashed/, "the danger ring differs by stroke style, not colour");
  });
});

function surfaceSheetNames(): string[] {
  const dir = path.join(repoRoot, STYLES_DIR);
  return readdirSync(dir).filter((f) => f.endsWith(".css"));
}

describe("workspace status colors", () => {
  const workspace = readStyle("workspace.css");

  it("uses the neutral info token instead of the action token", () => {
    assert.match(workspace, /\.workspace-status-pip\.tone-info\s*\{\s*color:\s*var\(--info\);\s*\}/);
  });

  it("keeps every workspace status tone free of a tinted fill", () => {
    // The contract — a status tone colours ink, never a fill — is asserted for
    // whatever tones exist.
    assert.doesNotMatch(
      workspace,
      /\.workspace-status-pill\b/,
      "the status pill is gone; status lives in the RecordBand",
    );
    const tones = ["good", "info", "warn", "bad", "neutral"];
    for (const tone of tones) {
      const rule = workspace.match(new RegExp(`\\.workspace-status-pip\\.tone-${tone}\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `missing ${tone} workspace status rule`);
      assert.ok(!rule[1].includes("background"), `${tone} workspace status must not use a tinted fill`);
    }
  });
});
