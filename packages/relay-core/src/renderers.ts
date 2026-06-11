import { ansi, color, status } from "./format.js";
import { asRecord, parseJsonObject } from "./shell.js";

const TEXT_MARK = "●";
const THINK_MARK = "○";
const TOOL_MARK = "⏺";
const CONTINUATION_INDENT = "  ";

// Strip ANSI escape sequences and disallowed control chars from untrusted
// agent output (e.g. when a streaming JSONL line fails to parse and falls
// back to plain text). We keep \t (0x09) and \n (0x0a).
export function sanitizeUntrustedText(value: string): string {
  let result = "";
  let i = 0;
  while (i < value.length) {
    const code = value.charCodeAt(i);
    if (code === 0x1b) {
      i += 1;
      const next = value.charCodeAt(i);
      if (next === 0x5b || next === 0x5d) {
        i += 1;
        while (i < value.length) {
          const c = value.charCodeAt(i);
          if ((c >= 0x40 && c <= 0x7e) || c === 0x07) { i += 1; break; }
          i += 1;
        }
      } else if (Number.isFinite(next)) {
        i += 1;
      }
      continue;
    }
    if (code === 0x09 || code === 0x0a || (code >= 0x20 && code !== 0x7f)) {
      result += value[i];
    }
    i += 1;
  }
  return result;
}

export class BlockStreamRenderer {
  private atLineStart = true;
  private blockStarted = false;

  constructor(
    private readonly marker: string,
    private readonly markerColor: string,
    private readonly bodyStyles: readonly string[] = [],
  ) {}

  resetBlock(): void {
    this.blockStarted = false;
    this.atLineStart = true;
  }

  feed(chunk: string): string {
    let output = "";
    for (const char of chunk) {
      if (char === "\r") continue;
      if (this.atLineStart && char !== "\n") {
        output += this.blockStarted
          ? CONTINUATION_INDENT
          : `${color(this.marker, this.markerColor)} `;
        this.blockStarted = true;
        if (this.bodyStyles.length > 0) output += this.bodyStyles.join("");
        this.atLineStart = false;
      }
      if (char === "\n") {
        if (this.bodyStyles.length > 0) output += ansi.reset;
        output += "\n";
        this.atLineStart = true;
      } else {
        output += char;
      }
    }
    return output;
  }
}

export class PlainTextStreamRenderer extends BlockStreamRenderer {
  constructor(_name: string, accent: string) {
    super(TEXT_MARK, accent);
  }
}

export class StderrLineRenderer {
  private buffer = "";

  feed(chunk: string): string {
    this.buffer += chunk;
    const output: string[] = [];
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      const formatted = this.formatLine(line);
      if (formatted) output.push(formatted);
    }
    return output.join("");
  }

  private formatLine(line: string): string {
    if (!line) return "";
    if (line.includes("seccomp not available")) return "";
    return `${status("warn", line)}\n`;
  }
}

export class JsonLineRenderer {
  private buffer = "";

  constructor(private readonly formatLine: (line: string) => string) {}

  feed(chunk: string): string {
    this.buffer += chunk;
    const output: string[] = [];
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) output.push(this.formatLine(line));
    }
    return output.join("");
  }
}

function toolLine(accent: string, label: string, target: string): string {
  return `\n${color(TOOL_MARK, accent)} ${color(label, ansi.dim)} ${color(target, accent)}\n`;
}

export class ClaudeStreamRenderer {
  private readonly text = new BlockStreamRenderer(TEXT_MARK, ansi.brand);
  private readonly thinking = new BlockStreamRenderer(THINK_MARK, ansi.dim, [ansi.dim, ansi.italic]);
  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${sanitizeUntrustedText(line)}\n`);

    if (event.type === "stream_event") {
      const streamEvent = asRecord(event.event);
      const delta = asRecord(streamEvent.delta);
      const contentBlock = asRecord(streamEvent.content_block);
      if (streamEvent.type === "content_block_start") {
        if (contentBlock.type === "tool_use") {
          this.text.resetBlock();
          this.thinking.resetBlock();
          return toolLine(ansi.brand, "tool", String(contentBlock.name ?? "unknown"));
        }
        if (contentBlock.type === "thinking") this.thinking.resetBlock();
        else this.text.resetBlock();
        return "";
      }
      if (streamEvent.type === "content_block_stop") {
        this.text.resetBlock();
        this.thinking.resetBlock();
        return "\n";
      }
      if (delta.type === "text_delta") return this.text.feed(String(delta.text ?? ""));
      if (delta.type === "thinking_delta") return this.thinking.feed(String(delta.thinking ?? ""));
      return "";
    }

    if (event.type === "assistant") {
      const message = asRecord(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      const output: string[] = [];
      for (const item of content) {
        const block = asRecord(item);
        if (block.type === "text") {
          const text = String(block.text ?? "").trim();
          if (text) {
            this.text.resetBlock();
            output.push(this.text.feed(`${text}\n`));
          }
        } else if (block.type === "tool_use") {
          output.push(toolLine(ansi.brand, "tool", String(block.name ?? "unknown")));
        }
      }
      return output.join("");
    }

    if (event.type === "result") {
      return event.is_error
        ? `\n${status("error", `Claude error: ${String(event.result ?? "unknown error")}`)}\n`
        : `\n${status("ok", "Claude finished.")}\n`;
    }
    if (event.type === "system" && event.subtype === "api_retry") {
      return `\n${status("warn", `Claude API retry ${String(event.attempt ?? "?")}/${String(event.max_retries ?? "?")}.`)}\n`;
    }
    return "";
  }
}

export class CodexStreamRenderer {
  private readonly text = new BlockStreamRenderer(TEXT_MARK, ansi.blue);
  private readonly reasoning = new BlockStreamRenderer(THINK_MARK, ansi.dim, [ansi.dim, ansi.italic]);
  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${sanitizeUntrustedText(line)}\n`);

    if (event.type === "turn.started") return `\n${status("info", "Codex started.")}\n`;
    if (event.type === "turn.completed") return `\n${status("ok", "Codex finished.")}\n`;
    if (event.type === "turn.failed") {
      const error = asRecord(event.error);
      return `\n${status("error", `Codex failed: ${String(error.message ?? "turn failed")}`)}\n`;
    }
    if (event.type === "error") return `\n${status("error", `Codex error: ${String(event.message ?? "unknown error")}`)}\n`;

    if (typeof event.type === "string" && event.type.startsWith("item.")) {
      const item = asRecord(event.item);
      if (item.type === "agent_message" && event.type === "item.completed") {
        const text = textFromContentRecord(item).trim();
        if (!text) return "";
        this.text.resetBlock();
        return `\n${this.text.feed(`${text}\n`)}`;
      }
      if (item.type === "reasoning" && event.type === "item.completed") {
        const text = textFromContentRecord(item).trim();
        if (!text) return "";
        this.reasoning.resetBlock();
        return `\n${this.reasoning.feed(`${text}\n`)}`;
      }
      if (item.type === "command_execution" && event.type === "item.started") {
        return toolLine(ansi.blue, "command", String(item.command ?? "command"));
      }
      if (item.type === "file_change" && event.type === "item.completed") {
        return `\n${status("info", "Codex changed files.")}\n`;
      }
    }
    if (event.type === "message" || event.type === "assistant_message") {
      const text = textFromContentRecord(event).trim();
      if (!text) return "";
      this.text.resetBlock();
      return `\n${this.text.feed(`${text}\n`)}`;
    }
    return "";
  }
}

function textFromContentRecord(record: Record<string, unknown>): string {
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const content = record.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((chunk) => {
      const chunkRecord = asRecord(chunk);
      if (typeof chunkRecord.text === "string") return chunkRecord.text;
      if (typeof chunkRecord.content === "string") return chunkRecord.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function formatClaudeJsonLine(line: string): string {
  return new ClaudeStreamRenderer().feed(`${line}\n`);
}

export function formatCodexJsonLine(line: string): string {
  return new CodexStreamRenderer().feed(`${line}\n`);
}
