import type { AgentName } from "../types";

export type AgentSegment =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "command"; command: string }
  | { kind: "status"; tone: StatusTone; text: string }
  | { kind: "raw"; text: string };

type StatusTone = "ok" | "error" | "warn" | "info";

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function parseAgentStream(agent: AgentName, raw: string): AgentSegment[] {
  if (!raw) return [];
  if (agent === "claude") return parseClaude(raw);
  if (agent === "codex") return parseCodex(raw);
  return parsePlain(raw);
}

export function parseAgentStderr(raw: string): AgentSegment[] {
  if (!raw) return [];
  const lines = stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line): AgentSegment => ({ kind: "status", tone: "warn", text: line }));
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isLikelyProtocolFragment(text: string): boolean {
  return /"type"\s*:|"session_id"\s*:|stream_event|content_block_|parent_tool_use_id|uuid/.test(text);
}

function streamRecords(raw: string): Array<{ kind: "json"; value: Record<string, unknown> } | { kind: "text"; text: string }> {
  const out: Array<{ kind: "json"; value: Record<string, unknown> } | { kind: "text"; text: string }> = [];
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char !== "{") {
      const nextJson = raw.indexOf("{", i);
      const end = nextJson === -1 ? raw.length : nextJson;
      const text = raw.slice(i, end).trim();
      if (text && !isLikelyProtocolFragment(text)) out.push({ kind: "text", text });
      i = end;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let j = i; j < raw.length; j += 1) {
      const c = raw[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = inString;
        continue;
      }
      if (c === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") depth += 1;
      if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }

    if (end === -1) {
      const text = raw.slice(i).trim();
      if (text && !isLikelyProtocolFragment(text)) out.push({ kind: "text", text });
      break;
    }

    const jsonText = raw.slice(i, end);
    const parsed = safeParse(jsonText);
    if (parsed) out.push({ kind: "json", value: parsed });
    else if (!isLikelyProtocolFragment(jsonText)) out.push({ kind: "text", text: stripAnsi(jsonText) });
    i = end;
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

class TextBuffer {
  private value = "";

  push(chunk: string): void {
    this.value += chunk;
  }

  flush(out: AgentSegment[], kind: "text" | "thinking"): void {
    const trimmed = this.value.trimEnd();
    if (trimmed) out.push({ kind, text: trimmed });
    this.value = "";
  }
}

function parseClaude(raw: string): AgentSegment[] {
  const out: AgentSegment[] = [];
  const text = new TextBuffer();
  const thinking = new TextBuffer();
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      text.push(`${stripAnsi(record.text)}\n`);
      continue;
    }
    const event = record.value;
    if (event.type === "stream_event") {
      const streamEvent = asRecord(event.event);
      const delta = asRecord(streamEvent.delta);
      const block = asRecord(streamEvent.content_block);
      if (streamEvent.type === "content_block_start") {
        if (block.type === "tool_use") {
          text.flush(out, "text");
          thinking.flush(out, "thinking");
          out.push({ kind: "tool", name: String(block.name ?? "tool") });
        }
        continue;
      }
      if (streamEvent.type === "content_block_stop") {
        text.flush(out, "text");
        thinking.flush(out, "thinking");
        continue;
      }
      if (delta.type === "text_delta") {
        thinking.flush(out, "thinking");
        text.push(String(delta.text ?? ""));
      } else if (delta.type === "thinking_delta") {
        text.flush(out, "text");
        thinking.push(String(delta.thinking ?? ""));
      }
      continue;
    }
    if (event.type === "assistant") {
      const message = asRecord(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const item of content) {
        const block = asRecord(item);
        if (block.type === "text") {
          thinking.flush(out, "thinking");
          text.push(String(block.text ?? ""));
        } else if (block.type === "tool_use") {
          text.flush(out, "text");
          thinking.flush(out, "thinking");
          out.push({ kind: "tool", name: String(block.name ?? "tool") });
        }
      }
      continue;
    }
    if (event.type === "result") {
      text.flush(out, "text");
      thinking.flush(out, "thinking");
      if (event.is_error) {
        out.push({ kind: "status", tone: "error", text: String(event.result ?? "Claude error") });
      } else {
        out.push({ kind: "status", tone: "ok", text: "Claude finished." });
      }
      continue;
    }
    if (event.type === "system" && event.subtype === "api_retry") {
      out.push({
        kind: "status",
        tone: "warn",
        text: `Claude API retry ${String(event.attempt ?? "?")}/${String(event.max_retries ?? "?")}`,
      });
    }
  }
  text.flush(out, "text");
  thinking.flush(out, "thinking");
  return out;
}

function parseCodex(raw: string): AgentSegment[] {
  const out: AgentSegment[] = [];
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      out.push({ kind: "raw", text: stripAnsi(record.text) });
      continue;
    }
    const event = record.value;
    if (event.type === "turn.started") {
      out.push({ kind: "status", tone: "info", text: "Codex started." });
      continue;
    }
    if (event.type === "turn.completed") {
      out.push({ kind: "status", tone: "ok", text: "Codex finished." });
      continue;
    }
    if (event.type === "turn.failed") {
      const error = asRecord(event.error);
      out.push({ kind: "status", tone: "error", text: `Codex failed: ${String(error.message ?? "turn failed")}` });
      continue;
    }
    if (event.type === "error") {
      out.push({ kind: "status", tone: "error", text: `Codex error: ${String(event.message ?? "unknown")}` });
      continue;
    }
    if (typeof event.type === "string" && event.type.startsWith("item.")) {
      const item = asRecord(event.item);
      if (item.type === "agent_message" && event.type === "item.completed") {
        const text = textFromContent(item).trim();
        if (text) out.push({ kind: "text", text });
        continue;
      }
      if (item.type === "reasoning" && event.type === "item.completed") {
        const text = textFromContent(item).trim();
        if (text) out.push({ kind: "thinking", text });
        continue;
      }
      if (item.type === "command_execution" && event.type === "item.started") {
        out.push({ kind: "command", command: String(item.command ?? "command") });
        continue;
      }
      if (item.type === "file_change" && event.type === "item.completed") {
        out.push({ kind: "status", tone: "info", text: "Codex changed files." });
      }
      continue;
    }
    if (event.type === "message" || event.type === "assistant_message") {
      const text = textFromContent(event).trim();
      if (text) out.push({ kind: "text", text });
    }
  }
  return out;
}

function parsePlain(raw: string): AgentSegment[] {
  const text = stripAnsi(raw).trim();
  return text ? [{ kind: "text", text }] : [];
}

function textFromContent(record: Record<string, unknown>): string {
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
