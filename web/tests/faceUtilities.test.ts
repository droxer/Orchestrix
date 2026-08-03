import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* The old `.mono` utility was a trap: it named a monospace face but only set
   tabular figures in the sans, so every identifier wearing it (node ids,
   @handles, workspace paths, credentials) silently rendered in the reading
   face. It is now split by intent — `.tnum` for figures that must align,
   `.code` for literal strings in the code face. These tests keep the two
   apart and keep the ambiguous name from coming back. */

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "web", "src", "styles", "tokens", "base.css"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("unable to locate repository root");
    dir = parent;
  }
}

const repoRoot = findRepoRoot();
const webSrc = path.join(repoRoot, "web", "src");
const readWebSource = (rel: string) => readFileSync(path.join(webSrc, rel), "utf8");

function walk(dir: string, ext: readonly string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) return walk(absolute, ext);
    return ext.some((e) => entry.endsWith(e)) ? [absolute] : [];
  });
}

/** The `mono` class token on its own — not `--font-mono`, `font-geist-mono`,
 *  `monospace`, or the `adm-drawer-sub--mono` BEM modifier (which does set the
 *  mono family, so its name is honest). */
const BARE_MONO = /(?<![-\w])mono(?![-\w])/;

describe("type-face utilities", () => {
  it("defines .tnum in the sans and .code in the mono face", () => {
    const base = readWebSource("styles/tokens/base.css");

    const tnum = /\.tnum\s*\{([^}]*)\}/.exec(base);
    assert.ok(tnum, ".tnum is not defined in tokens/base.css");
    assert.match(tnum[1], /font-family:\s*var\(--font-sans\)/);
    assert.match(tnum[1], /font-variant-numeric:\s*tabular-nums/);

    const code = /\.code\s*\{([^}]*)\}/.exec(base);
    assert.ok(code, ".code is not defined in tokens/base.css");
    assert.match(code[1], /font-family:\s*var\(--font-mono\)/);

    // Whatever --font-mono resolves to, it must actually end in a monospace
    // fallback — that is the property `.mono` failed to deliver.
    assert.match(readWebSource("styles/tokens/palette.css"), /--font-mono:[^;]*monospace;/);
  });

  it("has retired the ambiguous .mono class everywhere", () => {
    const offenders: string[] = [];

    for (const file of walk(webSrc, [".css"])) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        // Selector position only: `.mono` as a class, not `--font-mono` etc.
        if (/(^|[\s,>+~(])\.mono(?![-\w])/.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
        }
      });
    }

    for (const file of walk(webSrc, [".tsx"])) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (line.includes("className") && BARE_MONO.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
        }
      });
    }

    assert.deepEqual(offenders, [], `\`.mono\` survives at:\n  ${offenders.join("\n  ")}`);
  });

  it("keeps identifiers on .code and figures on .tnum", () => {
    // Identifiers: things an operator could type, paste, or diff.
    assert.match(readWebSource("components/admin/NodeRow.tsx"), /adm-node-card-handle code[^]*?\{node\.id\}/);
    // The credential row moved into CredCopyRow when the connect-computer
    // drawer started sharing it; the face assertion follows the markup.
    assert.match(readWebSource("components/admin/CredCopyRow.tsx"), /adm-cred-value code/);
    assert.match(readWebSource("components/admin/AssignNodeDrawer.tsx"), /adm-assign-node-path code/);
    assert.match(readWebSource("components/AgentWorkspacePage.tsx"), /workspace-path-segment code/);
    assert.match(readWebSource("components/admin/EmployeeCard.tsx"), /adm-emp-card-email code/);

    // Figures: counts, stamps, ratios.
    assert.match(readWebSource("components/ThreadRow.tsx"), /conversation-stamp tnum/);
    assert.match(readWebSource("components/MessageBlock.tsx"), /msg-time tnum/);
    assert.match(readWebSource("components/admin/dashboard/KpiTile.tsx"), /adm-dash-tile-value tnum/);
    assert.match(readWebSource("components/workspace/WorkspacePrimitives.tsx"), /<strong className="tnum">\{value\}<\/strong>/);
  });

  it("re-asserts the code face wherever a later `font` shorthand resets it", () => {
    // The `font` shorthand sets font-family, and these rules are imported
    // after tokens/base.css at equal specificity — so `.code` alone loses.
    const pairs: readonly (readonly [string, string])[] = [
      ["styles/admin-v2-views.css", "adm-node-card-name"],
      ["styles/admin-v2-views.css", "adm-node-history-identity span"],
      ["styles/admin-v2-drawers.css", "adm-assign-node-id"],
    ];

    for (const [file, selector] of pairs) {
      const source = readWebSource(file);
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        source,
        new RegExp(`\\.${escaped}\\.code\\s*\\{[^}]*font-family:\\s*var\\(--font-mono\\)`),
        `.${selector}.code must re-assert --font-mono in ${file}`
      );
    }
  });
});
