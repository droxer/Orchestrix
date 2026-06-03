import { agentLabel, ansi, color, status } from "./format.js";
import { asRecord, parseJsonObject } from "./shell.js";

export class PlainTextStreamRenderer {
  private atLineStart = true;

  constructor(
    private readonly name: string,
    private readonly accent: string,
  ) {}

  feed(chunk: string): string {
    let output = "";
    for (const char of chunk) {
      if (this.atLineStart && char !== "\n" && char !== "\r") {
        output += `${agentLabel(this.name, this.accent)} ${color("|", ansi.dim)} `;
        this.atLineStart = false;
      }
      output += char;
      if (char === "\n") this.atLineStart = true;
    }
    return output;
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

export class ClaudeStreamRenderer {
  private readonly text = new PlainTextStreamRenderer("Claude", ansi.magenta);
  private readonly thinking = new PlainTextStreamRenderer("Claude thinking", ansi.magenta);

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${line}\n`);

    if (event.type === "stream_event") {
      const streamEvent = asRecord(event.event);
      const delta = asRecord(streamEvent.delta);
      const contentBlock = asRecord(streamEvent.content_block);
      if (streamEvent.type === "content_block_start") {
        if (contentBlock.type === "tool_use") {
          return `\n${agentLabel("Claude", ansi.magenta)} ${color("tool", ansi.dim)} ${String(contentBlock.name ?? "unknown")}\n`;
        }
        return "";
      }
      if (streamEvent.type === "content_block_stop") return "\n";
      if (delta.type === "text_delta") return this.text.feed(String(delta.text ?? ""));
      if (delta.type === "thinking_delta") return this.thinking.feed(String(delta.thinking ?? ""));
      return "";
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
  private readonly text = new PlainTextStreamRenderer("Codex", ansi.blue);
  private readonly reasoning = new PlainTextStreamRenderer("Codex reasoning", ansi.blue);

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${line}\n`);

    if (event.type === "turn.started") return `\n${status("info", "Codex is reviewing.")}\n`;
    if (event.type === "turn.completed") return `\n${status("ok", "Codex finished.")}\n`;
    if (event.type === "turn.failed") {
      const error = asRecord(event.error);
      return `\n${status("error", `Codex failed: ${String(error.message ?? "turn failed")}`)}\n`;
    }
    if (event.type === "error") return `\n${status("error", `Codex error: ${String(event.message ?? "unknown error")}`)}\n`;

    if (typeof event.type === "string" && event.type.startsWith("item.")) {
      const item = asRecord(event.item);
      if (item.type === "agent_message" && event.type === "item.completed") {
        const text = String(item.text ?? "");
        return text.trim() ? `\n${this.text.feed(`${text.trim()}\n`)}` : "";
      }
      if (item.type === "reasoning" && event.type === "item.completed") {
        const text = String(item.text ?? "");
        return text.trim() ? `\n${this.reasoning.feed(`${text.trim()}\n`)}` : "";
      }
      if (item.type === "command_execution" && event.type === "item.started") {
        return `\n${agentLabel("Codex", ansi.blue)} ${color("command", ansi.dim)} ${String(item.command ?? "command")}\n`;
      }
      if (item.type === "file_change" && event.type === "item.completed") {
        return `\n${status("info", "Codex changed files.")}\n`;
      }
    }
    return "";
  }
}

export function formatClaudeJsonLine(line: string): string {
  return new ClaudeStreamRenderer().feed(`${line}\n`);
}

export function formatCodexJsonLine(line: string): string {
  return new CodexStreamRenderer().feed(`${line}\n`);
}
