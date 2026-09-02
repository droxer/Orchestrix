import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The modal contract belongs to the Dialog primitive.
 *
 * It used to be four hand-rolled copies — `useModalDrawer` for the drawers
 * and the confirm/prompt provider, plus one each inside the command palette
 * and the shortcuts sheet — and the copies had already drifted: two of them
 * focused their panel but never trapped Tab, so a keyboard user could walk
 * out of an open modal into the page behind it. Nothing on screen shows that,
 * which is why it is worth a test rather than a comment.
 */

const STYLES_DIR = path.join("web", "src", "styles");
const MARKER = path.join(STYLES_DIR, "tokens", "palette.css");

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`unable to locate ${MARKER}`);
    dir = parent;
  }
}

const repoRoot = findRepoRoot();
const srcDir = path.join(repoRoot, "web", "src");
const stylesDir = path.join(repoRoot, STYLES_DIR);

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({ rel: path.relative(srcDir, full), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(srcDir);
  return out;
}

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const DIALOG_PRIMITIVE = path.join("components", "ui", "dialog.tsx");

describe("overlay primitive", () => {
  const all = sources();

  it("routes every modal through the Dialog primitive", () => {
    const offenders = all
      .filter(({ rel }) => rel !== DIALOG_PRIMITIVE)
      // `(?<!\[)` skips the attribute SELECTOR — reading `[aria-modal="true"]`
      // to find whichever overlay owns the keyboard is consuming the contract,
      // not declaring one.
      .filter(({ text }) => /(?<!\[)\baria-modal=/.test(stripComments(text)))
      .map(({ rel }) => rel);
    assert.deepEqual(
      offenders,
      [],
      `these declare a modal by hand instead of using ui/dialog: ${offenders.join(", ")}`,
    );
  });

  it("keeps no hand-rolled focus restore or scroll lock", () => {
    for (const { rel, text } of all) {
      const code = stripComments(text);
      assert.ok(
        !/previouslyFocused/.test(code),
        `${rel} restores focus by hand — the primitive's finalFocus does that`,
      );
      assert.ok(
        !/BodyScrollLock/.test(code),
        `${rel} locks body scroll by hand — the primitive does that`,
      );
    }
  });

  it("drives overlay exit and underlay from the primitive's state, not a class", () => {
    // `.is-closing` was toggled by the app after measuring the panel's own
    // animation duration; `.is-underlay` came from a drawer stack the app
    // maintained. Both are states the primitive already publishes, as
    // `[data-ending-style]` and `[data-nested-dialog-open]`.
    for (const sheet of [
      "overlay.css",
      "dialog.css",
      "preferences.css",
      "command.css",
      "admin-v2-drawers.css",
      "mobile-overlays.css",
    ]) {
      const css = readFileSync(path.join(stylesDir, sheet), "utf8");
      assert.ok(!css.includes(".is-closing"), `${sheet} still keys an exit off .is-closing`);
      assert.ok(!css.includes(".is-underlay"), `${sheet} still keys the underlay off .is-underlay`);
    }
  });
});
