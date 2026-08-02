export type StreamingMarkdownPart = {
  kind: "text" | "markdown";
  text: string;
};

type Fence = {
  marker: "`" | "~";
  length: number;
};

function openingFence(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const delimiter = match[1];
  const marker = delimiter[0] as Fence["marker"];
  // CommonMark does not allow a backtick in a backtick fence's info string.
  if (marker === "`" && match[2].includes("`")) return null;
  return { marker, length: delimiter.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(
    match
      && match[1][0] === fence.marker
      && match[1].length >= fence.length,
  );
}

/**
 * Pull complete fenced blocks out of a growing Markdown document. The live
 * renderer can highlight those stable blocks without reparsing the unfinished
 * prose tail on every animation frame.
 */
export function splitStreamingMarkdown(text: string): StreamingMarkdownPart[] {
  if (!text) return [{ kind: "text", text }];
  const parts: StreamingMarkdownPart[] = [];
  let plainStart = 0;
  let fenceStart = -1;
  let fence: Fence | null = null;
  let lineStart = 0;

  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    const nextLineStart = newline < 0 ? text.length : newline + 1;
    const rawLine = text.slice(lineStart, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (!fence) {
      const opener = openingFence(line);
      if (opener) {
        fence = opener;
        fenceStart = lineStart;
      }
    } else if (closesFence(line, fence)) {
      if (plainStart < fenceStart) {
        parts.push({ kind: "text", text: text.slice(plainStart, fenceStart) });
      }
      parts.push({ kind: "markdown", text: text.slice(fenceStart, nextLineStart) });
      plainStart = nextLineStart;
      fenceStart = -1;
      fence = null;
    }

    lineStart = nextLineStart;
  }

  if (plainStart < text.length) {
    parts.push({ kind: "text", text: text.slice(plainStart) });
  }
  return parts;
}
