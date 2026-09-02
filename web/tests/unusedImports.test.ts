import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { describe, it } from "node:test";

/**
 * Splitting a large component file leaves the copied import block behind in
 * both halves. It happened to ChannelPrimitives (split out of a 1072-line
 * ChannelsView) and to BacklogChrome/BacklogRecords (split out of BacklogPage),
 * and the debris — 84 dead specifiers across 11 files — was invisible because
 * nothing was checking: `noUnusedLocals` is off for the web tsconfig, so tsc
 * compiles an unused import without complaint.
 *
 * This is the check. It is deliberately narrow — imports only, not locals — so
 * it stays a cheap structural assertion rather than a second type-checker.
 */

const SRC = resolve("web/src");

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every identifier a file binds via `import`, with its source line. */
function importedNames(source: string): { name: string; statement: string }[] {
  const bound: { name: string; statement: string }[] = [];

  // Named + type specifiers: import { a, b as c, type D } from "…"
  for (const match of source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"[^"]+";/gm)) {
    for (const specifier of match[1].split(",")) {
      // `b as c` binds c; `type D` binds D.
      const name = specifier.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "").trim();
      if (name) bound.push({ name, statement: match[0] });
    }
  }
  // Default + namespace: import X from "…" / import * as X from "…"
  for (const match of source.matchAll(/^import\s+(?:\*\s+as\s+)?(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*"[^"]+";/gm)) {
    bound.push({ name: match[1], statement: match[0] });
  }
  return bound;
}

describe("import hygiene", () => {
  it("binds no import the file never uses", async () => {
    const files = await sourceFiles(SRC);
    // A floor, not a pin: catches the sweep being pointed at an empty tree.
    assert.ok(files.length > 100, `only found ${files.length} source files — is SRC wrong?`);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      // Strip the import statements themselves so a specifier does not count
      // as its own usage. Everything else — JSX tags, type positions, plain
      // references — is a word-boundary match on the bound identifier.
      const body = source.replace(/^import[\s\S]*?;\s*$/gm, "");
      for (const { name } of importedNames(source)) {
        if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body)) {
          offenders.push(`${file.slice(file.indexOf("web/src"))}: ${name}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "these imports are never used — drop them from the import block");
  });

  /**
   * A VALUE import of a sibling module must not spell the target `.js`.
   * Turbopack resolves the web app with bundler resolution and looks for the
   * literal file — `./agentPlacements.js` does not exist, so the route 500s
   * with "Module not found" while `tsc -p packages/tsconfig.json` (NodeNext,
   * which rewrites `.js` → `.ts`) compiles the same line happily and every
   * node:test passes. Type-only imports are exempt: they are erased before a
   * bundler ever sees them, which is why `import type … from "../types.js"`
   * is all over this tree without breaking anything.
   */
  it("imports sibling modules by a path the bundler can resolve", async () => {
    const files = await sourceFiles(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/^import\s+(type\s+)?([^;]*?)from\s*"(\.[^"]*\.js)";/gm)) {
        // `import type …` is erased; only a value binding reaches the bundler.
        if (match[1]) continue;
        const clause = match[2];
        const named = clause.match(/\{([\s\S]*)\}/);
        const bindsValue = named
          ? named[1].split(",").some((specifier) => specifier.trim() && !/^type\s/.test(specifier.trim()))
          : clause.trim().length > 0;
        if (bindsValue) offenders.push(`${file.slice(file.indexOf("web/src"))}: ${match[3]}`);
      }
    }
    assert.deepEqual(offenders, [], "value imports must end in .ts (or no extension) — .js resolves in tsc but not in Turbopack");
  });
});
