import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { artifactRawHref, workspaceFilePreviewMode } from "../src/lib/artifactPreview.js";

describe("workspaceFilePreviewMode", () => {
  it("maps image content types to an inline image preview", () => {
    assert.equal(workspaceFilePreviewMode("image/png"), "image");
    assert.equal(workspaceFilePreviewMode("image/svg+xml"), "image");
    assert.equal(workspaceFilePreviewMode("IMAGE/JPEG"), "image");
  });

  it("maps pdf and html to frame previews", () => {
    assert.equal(workspaceFilePreviewMode("application/pdf"), "pdf");
    assert.equal(workspaceFilePreviewMode("text/html"), "html");
    assert.equal(workspaceFilePreviewMode("text/html; charset=utf-8"), "html");
  });

  it("maps text-like content to a plain text preview", () => {
    assert.equal(workspaceFilePreviewMode("text/csv"), "text");
    assert.equal(workspaceFilePreviewMode("text/tab-separated-values"), "text");
    assert.equal(workspaceFilePreviewMode("application/json"), "text");
  });

  it("falls back to none for binary documents and missing types", () => {
    assert.equal(workspaceFilePreviewMode("application/vnd.openxmlformats-officedocument.presentationml.presentation"), "none");
    assert.equal(workspaceFilePreviewMode("application/zip"), "none");
    assert.equal(workspaceFilePreviewMode(undefined), "none");
    assert.equal(workspaceFilePreviewMode(""), "none");
  });
});

describe("artifactRawHref", () => {
  it("URL-encodes both identifiers", () => {
    assert.equal(artifactRawHref("ses 1", "art/2"), "/sessions/ses%201/artifacts/art%2F2");
  });
});
