import { useMemo } from "react";

import { highlightToHtml } from "../lib/syntax";

// Map a file extension to a highlight.js language id (display label doubles as
// the grammar hint via the aliases in lib/syntax).
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  json: "json",
  jsonc: "json",
  yml: "yaml",
  yaml: "yaml",
  ini: "ini",
  toml: "ini",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  svg: "xml",
  xml: "xml",
  sql: "sql",
  dockerfile: "dockerfile",
};

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Highlight.js language id for a file, or null when unknown. */
export function languageForFile(name: string): string | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(name)] ?? null;
}

/** Whether a file renders to a Markdown preview. */
export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name));
}

/** Whether a file renders to an HTML document preview. */
export function isHtmlFile(name: string): boolean {
  return HTML_EXTENSIONS.has(extensionOf(name));
}

/** Whether a file has a rendered ("presentation") preview in addition to source. */
export function isRenderableFile(name: string): boolean {
  return isMarkdownFile(name) || isHtmlFile(name);
}

/** Syntax-highlighted code block with a line-number gutter. */
export function CodeView({ code, language }: { code: string; language?: string | null }) {
  const source = code.replace(/\n$/, "");
  const html = useMemo(() => highlightToHtml(source, language), [source, language]);
  const gutter = useMemo(
    () =>
      Array.from({ length: source.split("\n").length }, (_, index) => index + 1).join("\n"),
    [source],
  );
  return (
    <div className="code-view">
      {language ? <span className="code-view-lang">{language}</span> : null}
      <div className="code-view-scroll">
        <pre className="code-gutter" aria-hidden="true">
          {gutter}
        </pre>
        <pre className="code-body">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
