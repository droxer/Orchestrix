import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "web", "src", "styles", "tokens", "palette.css"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("unable to locate repository root");
    dir = parent;
  }
}

const repoRoot = findRepoRoot();
const fontsDir = path.join(repoRoot, "web", "src", "app", "fonts");
const readWebSource = (rel: string) => readFileSync(path.join(repoRoot, "web", "src", rel), "utf8");

describe("local typography assets", () => {
  it("ships real WOFF2 binaries for every application family", () => {
    for (const file of ["MonaSans-Variable.woff2", "Geist-Variable.woff2", "GeistMono-Variable.woff2"]) {
      const absolute = path.join(fontsDir, file);
      assert.ok(existsSync(absolute), `missing ${file}`);
      assert.ok(statSync(absolute).size > 1024, `${file} is not a materialized font binary`);
      assert.equal(readFileSync(absolute).subarray(0, 4).toString("ascii"), "wOF2", `${file} is not WOFF2`);
    }
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    assert.doesNotMatch(attributes, /web\/src\/app\/fonts\/.*filter=lfs/);
    assert.ok(existsSync(path.join(fontsDir, "OFL-MonaSans.txt")), "missing Mona Sans license");
  });
});

describe("application typography roles", () => {
  it("uses Mona Sans selectively for display hierarchy", () => {
    const layout = readWebSource("app/layout.tsx");
    const palette = readWebSource("styles/tokens/palette.css");
    const roles = readWebSource("styles/tokens/roles.css");

    assert.match(layout, /src:\s*["']\.\/fonts\/MonaSans-Variable\.woff2["']/);
    assert.match(layout, /variable:\s*["']--font-app-display["']/);
    assert.match(palette, /--font-display:\s*var\(--font-app-display\),\s*["']Mona Sans["']/);
    assert.match(roles, /--type-display:\s+600[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-title:\s+550[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-heading:\s+550[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-number:\s+600[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-body:\s+400[^;]+var\(--font-sans\);/);
    assert.match(roles, /--type-label:\s+500[^;]+var\(--font-sans\);/);
  });

  it("keeps CJK typography internally coherent and display tracking restrained", () => {
    const palette = readWebSource("styles/tokens/palette.css");
    const base = readWebSource("styles/tokens/base.css");
    const atelier = readWebSource("styles/atelier.css");

    assert.match(palette, /--track-tight:\s*0;/);
    assert.match(palette, /--track-caps:\s*0\.03em;/);
    assert.match(
      palette,
      /html:lang\(zh-CN\)\s*\{[^}]*--font-sans:\s*"PingFang SC"[^;]+var\(--font-app-sans\)[^;]*;[^}]*--font-display:\s*var\(--font-sans\);/s,
    );
    assert.match(
      palette,
      /html:lang\(zh-TW\)\s*\{[^}]*--font-sans:\s*"PingFang TC"[^;]+var\(--font-app-sans\)[^;]*;[^}]*--font-display:\s*var\(--font-sans\);/s,
    );
    const eyebrowRule = base.match(/\.eyebrow\s*\{([^}]*)\}/)?.[1] ?? "";
    const headerKickerRule = atelier.match(/\.page-header-kicker,[^{]+\{([^}]*)\}/s)?.[1] ?? "";
    assert.ok(!eyebrowRule.includes("text-transform: uppercase"), "generic eyebrows should preserve sentence case");
    assert.ok(!headerKickerRule.includes("text-transform: uppercase"), "page kickers should preserve sentence case");
  });
});
