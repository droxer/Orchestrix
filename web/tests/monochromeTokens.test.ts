import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
    assert.match(darkRegister, /--ok:\s*#7d848d;/);
  });

  it("light register inverts to a black action fill", () => {
    assert.match(lightRegister, /--action:\s*#16181b;/);
    assert.match(lightRegister, /--action-hover:\s*#000000;/);
    assert.match(lightRegister, /--on-action:\s*#ffffff;/);
    assert.match(lightRegister, /--action-soft:\s*color-mix\(in srgb, #16181b 7%, transparent\);/);
    assert.match(lightRegister, /--err:\s*#16181b;/);
    assert.match(lightRegister, /--warn:\s*#484f57;/);
    assert.match(lightRegister, /--ok:\s*#6b727b;/);
  });

  it("pins both registers as tokens so nothing hand-copies a hex", () => {
    // Surfaces that must not follow the active theme (pre-auth login, theme
    // swatches, diff chrome) read these instead of re-declaring literals.
    assert.match(darkRegister, /--dark-canvas:\s*#101214;/);
    assert.match(darkRegister, /--dark-elevated:\s*#22262b;/);
    assert.match(darkRegister, /--dark-ink:\s*#f2f4f6;/);
    assert.match(darkRegister, /--dark-ink-strong:\s*#ffffff;/);
    assert.match(darkRegister, /--dark-body:\s*#c9ced4;/);
    assert.match(darkRegister, /--dark-ink-soft:\s*#99a0a8;/);
    assert.match(darkRegister, /--light-canvas:\s*#f7f8f9;/);
    assert.match(darkRegister, /--light-ink:\s*#16181b;/);
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
