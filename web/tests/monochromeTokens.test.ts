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
