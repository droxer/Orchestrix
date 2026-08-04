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

describe("monochrome palette tokens", () => {
  it("dark register uses a white action fill with dark ink on top", () => {
    assert.match(darkRegister, /--action:\s*#f2f4f6;/);
    assert.match(darkRegister, /--action-hover:\s*#ffffff;/);
    assert.match(darkRegister, /--on-action:\s*#101214;/);
    assert.match(darkRegister, /--action-soft:\s*color-mix\(in srgb, #f2f4f6 9%, transparent\);/);
  });

  it("dark register status is a grey brightness hierarchy (loud = bright)", () => {
    assert.match(darkRegister, /--err:\s*#f2f4f6;/);
    assert.match(darkRegister, /--warn:\s*#b2b9c1;/);
    assert.match(darkRegister, /--ok:\s*#8f96a0;/);
  });

  it("light register inverts to a black action fill", () => {
    assert.match(lightRegister, /--action:\s*#16181b;/);
    assert.match(lightRegister, /--action-hover:\s*#000000;/);
    assert.match(lightRegister, /--on-action:\s*#ffffff;/);
    assert.match(lightRegister, /--action-soft:\s*color-mix\(in srgb, #16181b 7%, transparent\);/);
    assert.match(lightRegister, /--err:\s*#16181b;/);
    assert.match(lightRegister, /--warn:\s*#484f57;/);
    assert.match(lightRegister, /--ok:\s*#5a6169;/);
  });

  it("pins both registers as tokens so nothing hand-copies a hex", () => {
    // Surfaces that must not follow the active theme (pre-auth login, theme
    // swatches, diff chrome) read these instead of re-declaring literals.
    assert.match(darkRegister, /--dark-canvas:\s*#0b0d0f;/);
    assert.match(darkRegister, /--dark-elevated:\s*#22262b;/);
    assert.match(darkRegister, /--dark-ink:\s*#f2f4f6;/);
    assert.match(darkRegister, /--dark-ink-strong:\s*#ffffff;/);
    assert.match(darkRegister, /--dark-body:\s*#c9ced4;/);
    assert.match(darkRegister, /--dark-ink-soft:\s*#a6adb5;/);
    assert.match(darkRegister, /--light-canvas:\s*#f1f3f5;/);
    assert.match(darkRegister, /--light-ink:\s*#16181b;/);
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
    assert.equal(declared(darkRegister, "--dark-ink"), declared(darkRegister, "--ink-1"));
    assert.equal(declared(darkRegister, "--dark-body"), declared(darkRegister, "--ink-2"));
    assert.equal(declared(darkRegister, "--dark-ink-soft"), declared(darkRegister, "--ink-3"));
    assert.equal(declared(darkRegister, "--light-canvas"), declared(lightRegister, "--surface-0"));
    assert.equal(declared(darkRegister, "--light-surface"), declared(lightRegister, "--surface-1"));
    assert.equal(declared(darkRegister, "--light-ink"), declared(lightRegister, "--ink-1"));
  });

  it("reserves exactly one chromatic role, --live, in both registers", () => {
    // Phosphor: the ramp stays monochrome and colour means one thing — an agent
    // is working right now. Both registers clear WCAG AA for small text
    // (10.94:1 dark, 5.08:1 light) so an elapsed timer in --live is legible.
    assert.match(darkRegister, /--live:\s*#3ee08a;/);
    assert.match(lightRegister, /--live:\s*#0b7a45;/);
  });

  it("offers no --live fill token", () => {
    // The palette's own rule is "dot/border/text only, never fills". A
    // --live-wash existed for exactly zero call sites and contradicted that
    // rule by handing out a translucent fill; tint a ring (pulse-ring) or an
    // ink instead. Guard the declaration so it cannot drift back in.
    assert.doesNotMatch(palette, /--live-wash\s*:/, "--live is never a fill; do not reintroduce a wash token");
  });

  it("originates --live only in palette.css", () => {
    // The scope rule is enforced, not merely documented: no other token file may
    // declare the accent, and stylelint already blocks raw hex outside palette.
    for (const file of ["tokens/roles.css", "tokens/base.css", "tokens/shadcn-bridge.css"]) {
      const source = readStyle(file);
      assert.doesNotMatch(source, /--live\s*:/, `${file} must not declare --live`);
    }
  });

  it("keeps the light-register green above the AA floor", () => {
    // #0f8a4e is the obvious "brighter, friendlier" green and measures 4.14:1 —
    // below AA. Guard the *declaration* only: palette.css documents the rejected
    // value in a comment on purpose, so a substring check would fight the docs.
    assert.doesNotMatch(palette, /--live:\s*#0f8a4e/, "light --live must not regress to the sub-AA #0f8a4e");
    const declared = [...palette.matchAll(/--live:\s*(#[0-9a-fA-F]{6});/g)].map((m) => m[1]);
    assert.deepEqual(declared, ["#3ee08a", "#0b7a45"], "only the two approved --live values may be declared");
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

const login = readStyle("login.css");

describe("monochrome login palette", () => {
  it("pins neutral pre-auth accents via the always-dark register tokens", () => {
    // The --lg-* names alias palette.css's pinned register rather than
    // re-declaring its hexes, so the two can never drift apart.
    assert.match(login, /--lg-steel:\s*var\(--dark-ink\);/);
    assert.match(login, /--lg-steel-active:\s*var\(--dark-ink-strong\);/);
    assert.match(login, /--lg-on-steel:\s*var\(--dark-canvas\);/);
    assert.match(login, /--lg-err:\s*var\(--dark-ink\);/);
    assert.match(login, /\.login-error \{[^}]*var\(--lg-err\)/s);
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

describe("monochrome theme-picker swatches", () => {
  it("mirrors the monochrome registers through the pinned tokens", () => {
    // Swatches must show both registers at once, so they can't use the
    // theme-varying --action/--surface-0 — they read the pinned tokens,
    // which stay in sync with the registers by construction.
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="light"\]::after \{\s*background: var\(--light-ink\);/);
    assert.match(preferences, /\.pref-theme-swatch\[data-tone="dark"\]::after \{\s*background: var\(--dark-ink\);/);
    assert.match(
      preferences,
      /linear-gradient\(90deg, var\(--light-ink\) 0 50%, var\(--dark-ink\) 50% 100%\)/,
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

describe("ink ramp legibility", () => {
  // --ink-4 carried timestamps, token counts, and feed meta at 3.86:1 dark /
  // 3.55:1 light — real content, under the 4.5:1 floor of WCAG 1.4.3. The bug
  // was invisible to a hex-pinning test, so pin the ratio instead. The bar is
  // the WORST plane a tier can land on, not the canvas: meta text sits on
  // drawers and inset wells too, and those are the planes closest to the ink.
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
      // A ramp that passes AA by collapsing into one grey is not a ramp. The
      // bar is 1.2 rather than something prouder because the light register is
      // squeezed between white and the 4.5:1 floor and genuinely has less room
      // than dark — see the note in palette.css. 1.2 still rejects a collapse.
      const tiers = ["--ink-1", "--ink-2", "--ink-3", "--ink-4"].map((n) => tokenIn(register, n));
      for (let i = 0; i < tiers.length - 1; i += 1) {
        const step = contrast(tiers[i], tiers[i + 1]);
        assert.ok(step >= 1.2, `${label} ink-${i + 1} → ink-${i + 2} is only ${step.toFixed(2)}:1 apart`);
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
    // card from the page. An evenly spaced ramp left it at 1.06:1, below the
    // point where a borderless card reads as raised at all.
    for (const [label, register] of [["dark", darkRegister], ["light", lightRegister]] as const) {
      const step = contrast(tokenIn(register, "--surface-0"), tokenIn(register, "--surface-1"));
      assert.ok(step >= 1.07, `${label} canvas → card is only ${step.toFixed(3)}:1`);
    }
  });

  it("never lets the floating plane collapse into the card plane", () => {
    // Light had --surface-3 === --surface-1 (both #ffffff), so a dialog was
    // white-on-white over a canvas 1.06:1 away, carried entirely by a hairline.
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

  it("draws the ring with outline, which no ancestor's overflow can clip", () => {
    // A box-shadow ring is painted inside the nearest overflow:hidden ancestor
    // and gets sliced off by it. This app is built out of scrollers and clipped
    // rows, so the ring silently lost an edge against container boundaries.
    assert.match(roles, /--focus-outline:\s*var\(--focus-w\) solid var\(--action\);/);
    assert.match(roles, /--focus-offset:\s*\d+px;/);
    assert.doesNotMatch(roles, /--focus-ring\s*:/, "the box-shadow ring contract was replaced by outline");

    const shadowRings = [...surfaceSheetNames()].filter((name) =>
      /box-shadow:[^;]*--focus-(ring|outline)/.test(readStyle(name))
    );
    assert.deepEqual(shadowRings, [], "focus rings are outlines now — do not paint one as a box-shadow");
  });

  it("distinguishes the danger ring by shape, because it cannot differ by colour", () => {
    // --err and --action resolve to the SAME value in both registers, so the
    // two rings were previously identical down to the pixel and the danger
    // variant communicated nothing. Colour is unavailable; shape is not.
    for (const register of [darkRegister, lightRegister]) {
      assert.equal(
        tokenIn(register, "--err"),
        tokenIn(register, "--action"),
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
    assert.match(workspace, /\.workspace-status-pill\.tone-info\s*\{\s*color:\s*var\(--info\);\s*\}/);
  });

  it("renders status pills as outlined labels without tinted fills", () => {
    assert.match(workspace, /\.workspace-status-pill\s*\{[^}]*border:\s*1px solid currentColor;[^}]*background:\s*transparent;/s);
    for (const tone of ["good", "info", "warn", "bad", "neutral"]) {
      const rule = workspace.match(new RegExp(`\\.workspace-status-pill\\.tone-${tone}\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `missing ${tone} workspace status rule`);
      assert.ok(!rule[1].includes("background"), `${tone} workspace status must not use a tinted fill`);
    }
  });
});
