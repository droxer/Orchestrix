import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LANGUAGE_BY_EXTENSION } from "../src/lib/fileKinds.js";
import { highlightToHtml, resolveLanguage } from "../src/lib/syntax.js";

describe("resolveLanguage", () => {
  it("resolves a registered grammar name directly", () => {
    assert.equal(resolveLanguage("python"), "python");
  });

  it("resolves short aliases to their full grammar name", () => {
    assert.equal(resolveLanguage("ts"), "typescript");
    assert.equal(resolveLanguage("py"), "python");
    assert.equal(resolveLanguage("html"), "xml");
  });

  it("is case-insensitive", () => {
    assert.equal(resolveLanguage("TypeScript"), "typescript");
  });

  it("returns null for an unregistered language and for empty input", () => {
    assert.equal(resolveLanguage("cobol"), null);
    assert.equal(resolveLanguage(null), null);
    assert.equal(resolveLanguage(undefined), null);
  });
});

describe("fileKinds language table stays in sync with the highlight registry", () => {
  it("every mapped extension resolves to a grammar lib/syntax actually registers", () => {
    for (const [extension, language] of Object.entries(LANGUAGE_BY_EXTENSION)) {
      assert.notEqual(
        resolveLanguage(language),
        null,
        `fileKinds maps ".${extension}" to "${language}", which lib/syntax does not register or alias`,
      );
    }
  });
});

describe("highlightToHtml", () => {
  it("wraps recognized tokens in hljs classes for a known language", () => {
    const html = highlightToHtml("const x = 1;", "typescript");
    assert.match(html, /class="hljs-keyword"/);
  });

  it("resolves an alias to the same grammar as its canonical name", () => {
    const viaAlias = highlightToHtml("def f(): pass", "py");
    const viaCanonical = highlightToHtml("def f(): pass", "python");
    assert.equal(viaAlias, viaCanonical);
  });

  it("HTML-escapes source so the result is safe for dangerouslySetInnerHTML", () => {
    const html = highlightToHtml("<script>alert(1)</script>", "xml");
    // The xml grammar tokenizes "<" and "script" into separate spans, so
    // assert on the escape itself rather than a literal "&lt;script&gt;" run.
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;/);
    assert.match(html, /&gt;/);
  });

  it("falls back to auto-detection for an unknown language without throwing", () => {
    assert.doesNotThrow(() => highlightToHtml("const x = 1;", "not-a-real-language"));
    assert.doesNotThrow(() => highlightToHtml("const x = 1;", null));
  });

  it("is idempotent across repeated calls (exercises the LRU cache path)", () => {
    const first = highlightToHtml("SELECT * FROM users;", "sql");
    const second = highlightToHtml("SELECT * FROM users;", "sql");
    assert.equal(first, second);
  });
});
