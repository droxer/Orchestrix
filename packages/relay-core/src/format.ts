export type AgentOutputSink = (text: string) => void;

const colorsEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brand: "\x1b[38;5;173m",
} as const;

export function color(text: string, ...codes: string[]): string {
  if (!colorsEnabled) return text;
  return `${codes.join("")}${text}${ansi.reset}`;
}

// CSI/SGR escape sequences (colours, cursor moves). The TUI owns its own
// styling via Ink, so agent output captured for the transcript must be
// stripped of the renderers' inline ANSI before it is re-rendered.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function section(title: string, accent: string): string {
  return `\n${color(`== ${title} `, ansi.bold, accent)}${color("=".repeat(Math.max(8, 58 - title.length)), accent)}\n`;
}

export function status(kind: "ok" | "warn" | "error" | "info", message: string): string {
  const label = {
    ok: color("OK", ansi.green, ansi.bold),
    warn: color("WARN", ansi.yellow, ansi.bold),
    error: color("ERR", ansi.red, ansi.bold),
    info: color("INFO", ansi.cyan, ansi.bold),
  }[kind];
  return `${label}  ${message}`;
}

export function keyValue(key: string, value: string): string {
  return `${color(key.padEnd(11), ansi.dim)} ${value}`;
}

export function agentLabel(name: string, accent: string): string {
  return color(name, ansi.bold, accent);
}

export function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns || 88, 64), 110);
}

export function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function promptBlock(title: string, prompt: string, accent: string): string {
  return [
    section(title, accent),
    color("Prompt", ansi.dim),
    indent(wrapText(prompt, terminalWidth() - 2), 2),
    "",
  ].join("\n");
}

export function emitOrPrint(sink: AgentOutputSink | undefined, text: string): void {
  if (sink) {
    sink(text.endsWith("\n") ? text : `${text}\n`);
  } else {
    console.log(text);
  }
}
