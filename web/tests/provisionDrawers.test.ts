import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

import {
  employeeHandleOf,
  handleForEmployeeId,
  isValidEmployeeHandle,
  normalizeEmployeeHandle,
} from "../src/lib/employeeHandle.js";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isValidPassword,
  passwordProblem,
} from "../src/lib/passwordPolicy.js";

const readWeb = (path: string) => readFileSync(resolve("web", path), "utf8");

describe("employee handle grammar", () => {
  it("normalizes decoration, spacing, and case so the preview cannot lie", () => {
    assert.equal(normalizeEmployeeHandle("  @Alice  "), "alice");
    assert.equal(normalizeEmployeeHandle("@@bob"), "bob");
    assert.equal(normalizeEmployeeHandle(""), "");
  });

  it("mirrors the backend pattern in relay/api/helpers.py", () => {
    for (const good of ["alice", "a1", "alice.chen", "alice-chen", "a_b"]) {
      assert.equal(isValidEmployeeHandle(good), true, good);
    }
    // Too short, spaces, slashes, and leading punctuation are the shapes that
    // would make two spellings look like one identity in a path or an @handle.
    for (const bad of ["a", "alice chen", "alice/bob", "-alice", ".x", "Alice"]) {
      assert.equal(isValidEmployeeHandle(bad), false, bad);
    }
  });
});

describe("provision drawers", () => {
  it("gives the run-mode radio a focusable box instead of hiding the ring", () => {
    const css = readWeb("src/styles/admin-v2-provision.css");
    const segment = css.slice(css.indexOf(".adm-profile-segment-input"));
    const block = segment.slice(0, segment.indexOf("}"));
    // opacity: 0 hides the outline along with the box, so base.css's single
    // input:focus-visible ring never lands — the same trap .adm-assign-node-input
    // documents in admin-v2-drawers.css.
    assert.ok(!/opacity:\s*0/.test(block), "the segment radio must not be opacity-hidden");
    assert.match(block, /inset:\s*0/);
    assert.match(block, /appearance:\s*none/);
  });

  it("does not print an error string as a resting hint", () => {
    const source = readWeb("src/components/admin/AddNodeDrawer.tsx");
    const hint = source.slice(source.indexOf("adm-form-hint\">"));
    assert.ok(
      !hint.includes("admin.employee_required"),
      "the assignment hint must be guidance, not the field's own error text",
    );
  });

  it("keeps the employee preview out of the live region", () => {
    const source = readWeb("src/components/admin/AddEmployeeDrawer.tsx");
    const preview = source.slice(source.indexOf("adm-provision-preview "));
    assert.ok(
      !preview.slice(0, 400).includes("aria-live"),
      "a keystroke-driven preview must not announce on every character",
    );
  });

  it("never offers the admin's own autofill for an account they are creating", () => {
    for (const path of [
      "src/components/admin/AddEmployeeDrawer.tsx",
      "src/components/admin/EditEmployeeDrawer.tsx",
    ]) {
      const source = readWeb(path);
      for (const value of ["\"username\"", "\"email\"", "\"new-password\""]) {
        assert.ok(
          !source.includes(`autoComplete=${value}`),
          `${path} must not autofill ${value} into someone else's account`,
        );
      }
    }
  });

  it("focuses every field it validates", () => {
    const source = readWeb("src/components/admin/AddEmployeeDrawer.tsx");
    const chain = source.slice(source.indexOf("const firstInvalid"), source.indexOf("if (firstInvalid)"));
    for (const field of ["employeeId", "maxLocalComputers", "username", "password"]) {
      assert.ok(chain.includes(field), `${field} is validated but never focused`);
    }
  });

  it("marks the created computer in the list it lands in", () => {
    const admin = readWeb("src/components/AdminPage.tsx");
    assert.match(admin, /highlightedNodeId/);
    // Both node paths switch to the Computers view, where an employee-keyed
    // pulse is never read.
    assert.match(admin, /function handleCreateManagedNodeSuccess[\s\S]{0,400}pulseNode\(node\.id\)/);
    assert.match(admin, /function handleCreateManualNodeSuccess[\s\S]{0,600}pulseNode\(node\.id\)/);
  });
});

describe("password policy", () => {
  it("mirrors the backend bounds in relay/security/passwords.py", () => {
    const py = readFileSync(resolve("backend/relay/security/passwords.py"), "utf8");
    assert.match(py, new RegExp(`MIN_PASSWORD_LENGTH = ${MIN_PASSWORD_LENGTH}\\b`));
    assert.match(py, new RegExp(`MAX_PASSWORD_LENGTH = ${MAX_PASSWORD_LENGTH}\\b`));
  });

  it("refuses what the backend refuses, for the same stated reason", () => {
    assert.equal(passwordProblem("short"), "short");
    assert.equal(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1)), "long");
    assert.equal(passwordProblem("aaaaaaaa"), "degenerate");
    assert.equal(passwordProblem("qwertyuiop"), "degenerate");
    // The account's own names are the first guesses anyone makes.
    assert.equal(
      passwordProblem("alice-in-wonderland", ["alice", "Alice Chen"]),
      "identifier",
    );
    assert.equal(passwordProblem("chen-was-here-2026", ["Alice Chen"]), "identifier");
    // The shared email domain is not an identifier — it would reject far too much.
    assert.equal(passwordProblem("example-of-a-fine-one", ["zoe@example.com"]), null);
    // A two-letter handle is skipped for the same reason.
    assert.equal(passwordProblem("something-ordinary-88", ["jo"]), null);
  });

  it("keeps no composition rules — a plain passphrase passes", () => {
    assert.equal(passwordProblem("correct horse battery staple"), null);
    assert.equal(isValidPassword("kestrel-vault-7719"), true);
  });

  it("leaves the blocklist to the backend rather than duplicating it", () => {
    const ts = readFileSync(resolve("web/src/lib/passwordPolicy.ts"), "utf8");
    assert.ok(
      !ts.includes("letmein") && !ts.includes("trustno1"),
      "the common-password list must not be mirrored into the client, where it would drift",
    );
    // ...and the backend must actually carry it.
    const py = readFileSync(resolve("backend/relay/security/passwords.py"), "utf8");
    assert.match(py, /COMMON_PASSWORDS/);
  });
});
