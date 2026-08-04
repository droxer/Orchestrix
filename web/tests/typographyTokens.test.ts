import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  it("ships real WOFF2 binaries for both application families", () => {
    // Phosphor runs two families: JetBrains Mono covers the display tier and
    // technical text, Geist carries prose and UI body copy.
    for (const file of ["JetBrainsMono-Variable.woff2", "Geist-Variable.woff2"]) {
      const absolute = path.join(fontsDir, file);
      assert.ok(existsSync(absolute), `missing ${file}`);
      assert.ok(statSync(absolute).size > 1024, `${file} is not a materialized font binary`);
      assert.equal(readFileSync(absolute).subarray(0, 4).toString("ascii"), "wOF2", `${file} is not WOFF2`);
    }
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    assert.doesNotMatch(attributes, /web\/src\/app\/fonts\/.*filter=lfs/);
    assert.ok(existsSync(path.join(fontsDir, "OFL-JetBrainsMono.txt")), "missing JetBrains Mono license");
  });

  it("retires Mona Sans and Geist Mono rather than leaving them dormant", () => {
    // One mono replaced two faces; leaving the old binaries in the tree would
    // ship ~203 KB nobody loads.
    for (const file of ["MonaSans-Variable.woff2", "GeistMono-Variable.woff2", "OFL-MonaSans.txt"]) {
      assert.ok(!existsSync(path.join(fontsDir, file)), `${file} should have been removed`);
    }
  });
});

describe("application typography roles", () => {
  it("wires one mono family for both display and technical text", () => {
    const layout = readWebSource("app/layout.tsx");
    const palette = readWebSource("styles/tokens/palette.css");

    assert.match(layout, /src:\s*["']\.\/fonts\/JetBrainsMono-Variable\.woff2["']/);
    assert.match(layout, /variable:\s*["']--font-app-mono["']/);
    assert.doesNotMatch(layout, /MonaSans|--font-app-display|GeistMono|--font-geist-mono/);

    assert.match(palette, /--font-display:\s*var\(--font-app-mono\),\s*["']JetBrains Mono["']/);
    assert.match(palette, /--font-mono:\s*var\(--font-app-mono\),\s*["']JetBrains Mono["']/);
  });

  it("gives the display tier mono weights and keeps code at 400", () => {
    const roles = readWebSource("styles/tokens/roles.css");

    // Display and technical share a face, so they are separated by weight:
    // 700/600 for display, 400 for code (plus --ink-4 and no tracking).
    assert.match(roles, /--type-display:\s+700[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-title:\s+700[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-heading:\s+600[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-number:\s+700[^;]+var\(--font-display\);/);
    assert.match(roles, /--type-code:\s+400[^;]+var\(--font-mono\);/);
    assert.match(roles, /--type-body:\s+400[^;]+var\(--font-sans\);/);
    assert.match(roles, /--type-label:\s+500[^;]+var\(--font-sans\);/);
  });

  it("tracks the display tier and the reading tiers, and nothing by accident", () => {
    const palette = readWebSource("styles/tokens/palette.css");

    assert.match(palette, /--track-display:\s*-0\.04em;/);
    assert.match(palette, /--track-body:\s*-0\.011em;/);
    assert.match(palette, /--track-body-sm:\s*-0\.013em;/);
    assert.match(palette, /--track-caps:\s*0\.03em;/);

    // --track-tight was declared 0, so its name promised a tightening it never
    // applied and its single consumer meant --track-0 all along. A token whose
    // name contradicts its value is worse than no token.
    // Strip comments first: palette.css documents the retirement in prose, and
    // a substring check would read its own explanation as the declaration.
    const code = palette.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /--track-tight:/, "--track-tight was retired; use --track-0");
    const styles = path.join(repoRoot, "web", "src", "styles");
    const stragglers = readdirSync(styles)
      .filter((f) => f.endsWith(".css"))
      .filter((f) => /var\(--track-tight\)/.test(readFileSync(path.join(styles, f), "utf8")));
    assert.deepEqual(stragglers, [], "these still reference the retired --track-tight");
  });

  it("pairs every type role with a tracking token", () => {
    // The `font:` shorthand cannot carry letter-spacing, so a role applied as
    // `font: var(--type-title)` loses its tracking unless the call site
    // remembers a second declaration — which is how an untracked login headline
    // shipped once. Pairing the tokens by name is what makes the omission
    // greppable; Linear ships --title-1 next to --title-1-letter-spacing for
    // exactly this reason.
    const roles = readWebSource("styles/tokens/roles.css");
    const declared = [...roles.matchAll(/--type-([a-z-]+):\s/g)]
      .map((m) => m[1])
      .filter((name) => !name.endsWith("-track"));
    assert.ok(declared.length >= 10, "roles.css lost its --type-* block");
    for (const role of declared) {
      assert.match(
        roles,
        new RegExp(`--type-${role}-track:\\s*var\\(--track-[a-z0-9-]+\\);`),
        `--type-${role} has no paired --type-${role}-track`
      );
    }
  });

  it("keeps the monospace column out of the inherited body tracking", () => {
    // base.css sets --track-body on html+body so every reading surface inherits
    // it. A monospace face is chosen for its fixed advance, and these are
    // strings an operator compares character by character — so every rule that
    // opts into the mono family must opt back out of the tracking.
    const styles = path.join(repoRoot, "web", "src", "styles");
    const problems: string[] = [];
    for (const file of readdirSync(styles).filter((f) => f.endsWith(".css"))) {
      const source = readFileSync(path.join(styles, file), "utf8");
      for (const rule of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [, , body] = rule;
        if (!/font-family:\s*var\(--font-mono\)/.test(body)) continue;
        if (/letter-spacing:/.test(body)) continue;
        problems.push(`${file}:${source.slice(0, rule.index).split("\n").length}`);
      }
    }
    assert.deepEqual(problems, [], `mono rules inheriting body tracking:\n${problems.join("\n")}`);
  });

  it("applies display tracking at every display-tier rule", () => {
    // Display text without --track-display renders as spaced-out code, and a
    // second letter-spacing in the same rule silently overrides it.
    //
    // Two shapes count as display-tier and BOTH must be swept: the --type-*
    // shorthand roles, and rules that opt into `font-family: var(--font-display)`
    // by hand (login's headline, drawer titles, stat values, …). Missing the
    // second shape is exactly how the login screen shipped untracked once.
    const stylesDir = path.join(repoRoot, "web", "src", "styles");
    const files = readdirSync(stylesDir).filter((f) => f.endsWith(".css"));
    const problems: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(stylesDir, file), "utf8");
      for (const rule of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [, selector, body] = rule;
        const isRole = /font:\s*var\(--type-(display|title|heading|number)\)/.test(body);
        const isHandRolled = /font-family:\s*var\(--font-display\)/.test(body);
        if (!isRole && !isHandRolled) continue;
        // A single decorative glyph has no inter-character spacing to track.
        if (/relay-bleed-mark/.test(selector)) continue;
        const spacing = [...body.matchAll(/letter-spacing:\s*([^;]+);/g)].map((m) => m[1].trim());
        // Either the shared value or the role's paired token — both resolve to
        // --track-display, and the paired form is the one that names its role.
        const accepted = /^var\(--(?:track-display|type-(?:display|title|heading|number)-track)\)$/;
        if (spacing.length !== 1 || !accepted.test(spacing[0])) {
          const line = source.slice(0, rule.index).split("\n").length;
          problems.push(`${file}:${line} → [${spacing.join(" | ") || "no letter-spacing"}]`);
        }
      }
    }
    assert.deepEqual(problems, [], `display-tier rules missing or overriding --track-display:\n${problems.join("\n")}`);
  });

  it("keeps CJK typography internally coherent and display tracking restrained", () => {
    const palette = readWebSource("styles/tokens/palette.css");
    const base = readWebSource("styles/tokens/base.css");
    const atelier = readWebSource("styles/atelier.css");

    // JetBrains Mono has no Han coverage, so CJK display falls back to the sans
    // stack — and the mono tracking must be neutralised or Han titles crush.
    assert.match(
      palette,
      /html:lang\(zh-CN\)\s*\{[^}]*--font-sans:\s*"PingFang SC"[^;]+var\(--font-app-sans\)[^;]*;[^}]*--font-display:\s*var\(--font-sans\);/s,
    );
    assert.match(
      palette,
      /html:lang\(zh-TW\)\s*\{[^}]*--font-sans:\s*"PingFang TC"[^;]+var\(--font-app-sans\)[^;]*;[^}]*--font-display:\s*var\(--font-sans\);/s,
    );
    assert.match(
      palette,
      /html:lang\(zh-CN\),\s*html:lang\(zh-TW\)\s*\{[^}]*--track-display:\s*0;/s,
    );

    const eyebrowRule = base.match(/\.eyebrow\s*\{([^}]*)\}/)?.[1] ?? "";
    const headerKickerRule = atelier.match(/\.page-header-kicker,[^{]+\{([^}]*)\}/s)?.[1] ?? "";
    assert.ok(!eyebrowRule.includes("text-transform: uppercase"), "generic eyebrows should preserve sentence case");
    assert.ok(!headerKickerRule.includes("text-transform: uppercase"), "page kickers should preserve sentence case");
  });

  it("keeps CJK fallbacks available for multilingual transcripts in any UI language", () => {
    const palette = readWebSource("styles/tokens/palette.css");
    const root = palette.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    // Agent output can be Chinese while the surrounding controls remain in
    // English, so glyph coverage cannot depend only on html:lang(zh-*).
    for (const role of ["display", "sans", "mono"]) {
      const family = root.match(new RegExp(`--font-${role}:\\s*([^;]+);`))?.[1] ?? "";
      assert.match(family, /"PingFang SC"/, `${role} is missing the macOS CJK fallback`);
      assert.match(family, /"Microsoft YaHei/, `${role} is missing the Windows CJK fallback`);
      assert.match(family, /"Noto Sans/, `${role} is missing the Linux CJK fallback`);
    }
  });
});
