export type HlToken = { kind: HlKind; text: string };
export type HlKind = "keyword" | "string" | "number" | "comment" | "plain";

const KEYWORDS = new Set([
  // TypeScript / JavaScript
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "class", "new", "this", "super",
  "import", "export", "default", "from", "async", "await", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "void", "null", "undefined",
  "true", "false", "type", "interface", "enum", "extends", "implements",
  // Python
  "def", "pass", "lambda", "with", "as", "yield", "raise", "del", "global",
  "nonlocal", "assert", "not", "and", "or", "in", "is", "None", "True", "False",
  // Go
  "func", "go", "chan", "map", "struct", "range", "select", "defer", "package",
]);

export function tokenize(code: string): HlToken[] {
  const out: HlToken[] = [];
  let i = 0;

  while (i < code.length) {
    // Single-line comment: // or #
    if (
      (code[i] === "/" && code[i + 1] === "/") ||
      (code[i] === "#" && (i === 0 || /\s/.test(code[i - 1]!)))
    ) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      out.push({ kind: "comment", text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // Block comment: /* … */
    if (code[i] === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out.push({ kind: "comment", text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // Strings: ", ', `
    if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\" && j + 1 < code.length) { j += 2; continue; }
        if (code[j] === quote) { j += 1; break; }
        j += 1;
      }
      out.push({ kind: "string", text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(code[i]!) && (i === 0 || /\W/.test(code[i - 1]!))) {
      let j = i;
      while (j < code.length && /[0-9._xXa-fA-F]/.test(code[j]!)) j += 1;
      out.push({ kind: "number", text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$]/.test(code[i]!)) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j]!)) j += 1;
      const word = code.slice(i, j);
      out.push({ kind: KEYWORDS.has(word) ? "keyword" : "plain", text: word });
      i = j;
      continue;
    }

    // Everything else: gather non-word chars as plain
    let j = i;
    while (
      j < code.length &&
      !/[a-zA-Z_$0-9"'`#/]/.test(code[j]!) &&
      !(code[j] === "/" && (code[j + 1] === "/" || code[j + 1] === "*"))
    ) {
      j += 1;
    }
    if (j === i) j = i + 1;
    out.push({ kind: "plain", text: code.slice(i, j) });
    i = j;
  }

  return out;
}
