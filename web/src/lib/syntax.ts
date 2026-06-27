import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Curated language set — registered once at module load. Keeping the core
// build plus an explicit list avoids pulling highlight.js's full grammar
// bundle into the static export.
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

let registered = false;
function ensureRegistered() {
  if (registered) return;
  for (const [name, language] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, language);
  }
  registered = true;
}

// Aliases for grammars that cover several languages (highlight.js bundles
// JSX/TSX into javascript/typescript, HTML into xml, etc.).
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  cc: "cpp",
  "c++": "cpp",
  h: "c",
  cs: "csharp",
  html: "xml",
  htm: "xml",
  svg: "xml",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  md: "markdown",
  jsonc: "json",
};

function resolveLanguage(language: string | null | undefined): string | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  const resolved = LANGUAGE_ALIASES[lower] ?? lower;
  return hljs.getLanguage(resolved) ? resolved : null;
}

/**
 * Highlights `code` to HTML using a real grammar when the language is known,
 * falling back to auto-detection otherwise. Input is HTML-escaped by
 * highlight.js, so the result is safe to inject via dangerouslySetInnerHTML.
 */
export function highlightToHtml(code: string, language?: string | null): string {
  ensureRegistered();
  const resolved = resolveLanguage(language);
  if (resolved) {
    return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(code).value;
}
