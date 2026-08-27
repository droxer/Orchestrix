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

/** RGB channels, so a hue can be asserted as a RELATIONSHIP (green leads,
 *  red leads, blue trails) rather than pinned to a hex that says nothing
 *  about whether the tone still reads as its meaning. */
function channels(hex: string): [number, number, number] {
  return [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) as [number, number, number];
}

describe("Meta commerce palette tokens", () => {
  it("declares both registers: dark on :root, cream on html[data-theme=light]", () => {
    assert.match(palette, /:root\s*\{/);
    for (const name of ["--surface-0", "--ink-1", "--live", "--link-blue"]) {
      assert.match(darkRegister, new RegExp(`${name}:\\s*#[0-9a-f]{6};`), `dark register is missing ${name}`);
      assert.match(lightRegister, new RegExp(`${name}:\\s*#[0-9a-f]{6};`), `light register is missing ${name}`);
    }
  });

  it("makes --action the source system's cobalt, register-invariant down to the pressed state", () => {
    // The primary action is the same cobalt on both canvases, and so is its
    // pressed state: white clears AA on both fills, so neither register needs
    // its own. Only the soft callout tint retunes per register.
    assert.match(darkRegister, /--action:\s*#0064e0;/);
    assert.doesNotMatch(lightRegister, /--action:\s*#/, "light register must not redeclare --action — it is register-invariant");
    assert.match(darkRegister, /--on-action:\s*#ffffff;/);
    assert.doesNotMatch(lightRegister, /--on-action:\s*#/, "--on-action is register-invariant too");
    assert.match(darkRegister, /--action-hover:\s*#0457cb;/, "the pressed state is the source system's primary-deep");
    assert.doesNotMatch(lightRegister, /--action-hover:\s*#/, "the pressed state is register-invariant too");
    assert.match(lightRegister, /--action-soft:\s*color-mix\(in srgb, #[0-9a-f]{6} \d+%, transparent\);/);
  });

  it("keeps the source system's black marketing pill available as its own token", () => {
    // The source system runs two primary buttons: cobalt inside the commerce
    // flow, black on marketing surfaces. Relay is in-product, so cobalt is the
    // action — but the black pill survives as --ink-button for the pre-auth and
    // landing chrome, and it MUST be register-varying or it disappears into the
    // dark canvas.
    const darkFill = tokenIn(darkRegister, "--ink-button");
    const lightFill = tokenIn(lightRegister, "--ink-button");
    assert.notEqual(darkFill, lightFill, "a black pill on the dark canvas is invisible — invert it");
    assert.equal(lightFill, "#000000", "the light register takes the source system's ink-button verbatim");
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const ratio = contrast(tokenIn(register, "--on-ink-button"), tokenIn(register, "--ink-button"));
      assert.ok(ratio >= 4.5, `${label} --on-ink-button on --ink-button is ${ratio.toFixed(2)}:1`);
    }
  });

  it("keeps --on-action legible on the fill and its pressed state", () => {
    // The whole action triple is register-invariant (declared once, on :root),
    // so one measurement covers both canvases.
    const onAction = tokenIn(darkRegister, "--on-action");
    for (const fill of ["--action", "--action-hover"]) {
      const ratio = contrast(onAction, tokenIn(darkRegister, fill));
      assert.ok(ratio >= 4.5, `--on-action on ${fill} is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor`);
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

  it("marks live work in the Oculus purple, legible as small text in both registers", () => {
    // The source system sanctions exactly two accents beyond the neutrals: cobalt and
    // Oculus purple. Cobalt is spoken for by the primary action, so liveness
    // takes the purple and can never be mistaken for "press this". Assert the
    // hue family (blue and red lead, green trails), not an exact hex — and the
    // AA floor, because an elapsed timer set in --live is legible, not
    // decorative.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const live = tokenIn(register, "--live");
      const [r, g, b] = channels(live);
      assert.ok(b > g && r > g, `${label} --live ${live} left the purple family (b > g and r > g required)`);
      const ratio = contrast(live, tokenIn(register, "--surface-0"));
      assert.ok(ratio >= 4.5, `${label} --live on --surface-0 is ${ratio.toFixed(2)}:1 — below the 4.5:1 floor`);
    }
    // And it must not collapse into the action: two blues would put "working"
    // and "click me" in the same channel.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const live = channels(tokenIn(register, "--live"));
      assert.ok(live[0] > 96, `${label} --live has no red left in it — it has drifted into the cobalt action`);
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

  it("keeps status on the source system's semantic hues, each still reading as its meaning", () => {
    // Status here is chromatic by design — the source system publishes a green
    // success, an amber warning, and a red critical — so the guard is that
    // each tone still reads as ITS hue after the deepening that AA forced on
    // the light register. Relationships, not hexes: a green whose red channel
    // has crept past its green is no longer a green.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const [okR, okG, okB] = channels(tokenIn(register, "--ok"));
      assert.ok(okG > okR && okG > okB, `${label} --ok is no longer a green`);
      const [warnR, warnG, warnB] = channels(tokenIn(register, "--warn"));
      assert.ok(warnR > warnG && warnG > warnB, `${label} --warn is no longer an amber`);
      const [errR, errG, errB] = channels(tokenIn(register, "--err"));
      assert.ok(errR > errG && errR > errB, `${label} --err is no longer a red`);
      // The three must stay distinguishable from each other as hues, not just
      // as brightnesses — colour is the whole channel here.
      assert.notEqual(tokenIn(register, "--ok"), tokenIn(register, "--warn"));
      assert.notEqual(tokenIn(register, "--warn"), tokenIn(register, "--err"));
    }
    // Info is not a color — neutral notice text aliased to the ink ramp.
    const roles = readStyle("tokens/roles.css");
    assert.match(roles, /--info:\s*var\(--ink-3\);/);
  });

  it("no Fieldnotes-era values remain in palette.css", () => {
    const dead = [
      "#f7a501", "#ffb61a", "#dd9001", // the highlighter yellow action + hovers
      "#23251d", "#1f211a", "#262820", "#2d2f27", "#34362b", // olive canvas + surfaces
      "#eeefe9", "#fcfcfa", "#e5e7e0", // cream canvas + planes
      "#f1f1e8", "#d0d1c2", "#a8a999", "#9e9f8f", // olive ink ramp
      "#a0a192", "#c6c7b8", "#616257", "#55564d", // olive brightness-hierarchy status
      "#ffc233", // the yellow --live (its light-register twin #8a5f06 survives as --code-number)
    ];
    for (const value of dead) {
      assert.ok(!paletteCode.includes(value), `palette.css still declares ${value}`);
    }
  });
});

const login = readStyle("login.css");

describe("pre-auth login palette", () => {
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

  it("lets the register-invariant cobalt CTA reach pre-auth", () => {
    // The primary action is one cobalt in EVERY context, pre-auth included, so
    // login.css aliases :root's action tokens rather than pinning its own
    // sign-in colour. Guard the declaration so the pin cannot drift back in.
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

describe("theme-picker swatches", () => {
  it("mirrors the two registers through the pinned tokens", () => {
    // Swatches must show both registers at once, so the canvas can't use the
    // theme-varying --surface-0 — they read the pinned tokens, which stay in
    // sync with the registers by construction.
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="light"\] \{\s*background: var\(--light-canvas\);/);
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="dark"\] \{\s*background: var\(--dark-canvas\);/);
  });

  it("shows one register-invariant cobalt strip, not a per-register split", () => {
    // The action is the SAME cobalt on both canvases, so every swatch strip is
    // simply var(--action) and the per-register gradient split is gone.
    for (const tone of ["light", "dark", "system"]) {
      assert.match(
        preferences,
        new RegExp(`\\.pref-theme-swatch\\[data-tone="${tone}"\\]::after \\{[^}]*background: var\\(--action\\);`, "s"),
        `${tone} swatch strip must be the register-invariant --action cobalt`,
      );
    }
    assert.doesNotMatch(
      preferences,
      /linear-gradient\(90deg, var\(--light-ink\) 0 50%, var\(--dark-ink\) 50% 100%\)/,
      "the split-ink strip was a Phosphor artifact — one cobalt serves both registers",
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

  it("distinguishes the danger ring by colour AND shape", () => {
    // The critical red is its own hue now, so the danger ring can differ by
    // colour — but it keeps the dashed stroke it wore through the monochrome
    // era, because forced-colors mode drops the hue and the stroke style
    // survives it.
    for (const register of [darkRegister, lightRegister]) {
      assert.notEqual(
        tokenIn(register, "--err"),
        tokenIn(register, "--ink-1"),
        "--err carries the source system's critical hue; it is no longer the loud end of the ink ramp"
      );
    }
    const normal = roles.match(/--focus-outline:\s*([^;]+);/)?.[1] ?? "";
    const danger = roles.match(/--focus-outline-danger:\s*([^;]+);/)?.[1] ?? "";
    assert.notEqual(danger, normal, "the danger ring must not be a copy of the normal ring");
    assert.match(danger, /--err/, "the danger ring is drawn in the critical tone");
    assert.match(danger, /dashed/, "the stroke style is the channel that survives forced-colors mode");
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
