import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

describe("streaming prose continuity", () => {
  it("uses one canonical Markdown document before and after settlement", () => {
    const source = readFileSync("web/src/components/AgentStream.tsx", "utf8");

    // `live` is a render condition (suppresses diagram/copy on a partial
    // fence), not a second document — the text passed is still the one string.
    assert.match(source, /<MarkdownContent text=\{visibleText\} live=\{live\} \/>/);
    assert.doesNotMatch(source, /splitStreamingMarkdown/);
    assert.doesNotMatch(source, /parts\.map/);
  });

  it("keeps a loose list as one semantic list", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      children: "- first\n\n- second",
    }));

    assert.equal(html.match(/<ul>/g)?.length, 1);
    assert.equal(html.match(/<li>/g)?.length, 2);
  });
});
