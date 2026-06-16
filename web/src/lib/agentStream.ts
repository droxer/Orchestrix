import type { AgentName, Tone } from "../types.js";

export type AgentSegment =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "command"; command: string }
  | { kind: "status"; tone: StatusTone; text: string }
  | { kind: "narration"; key: string; params?: Record<string, string | number> }
  | { kind: "raw"; text: string };

type StatusTone = Exclude<Tone, "neutral">;

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function parseAgentStream(agent: AgentName, raw: string): AgentSegment[] {
  if (!raw) return [];
  if (agent === "claude") return parseClaude(raw);
  if (agent === "codex") return parseCodex(raw);
  if (agent === "pi") return parsePi(raw);
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
      if (text && !isLikelyProtocolFragment(text)) out.push({ kind: "text", text: stripAnsi(text) });
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

function narration(
  key: string,
  params?: Record<string, string | number>,
  tone?: StatusTone,
): AgentSegment {
  return { kind: "narration", key, params: tone ? { ...params, tone } : params };
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
        const message = String(event.result ?? "");
        out.push(message
          ? { kind: "status", tone: "bad", text: message }
          : narration("agent_stream.claude_error", undefined, "bad"));
      } else {
        out.push(narration("agent_stream.claude_finished", undefined, "good"));
      }
      continue;
    }
    if (event.type === "system" && event.subtype === "api_retry") {
      out.push(narration("agent_stream.claude_api_retry", {
        attempt: Number(event.attempt ?? "?"),
        max: Number(event.max_retries ?? "?"),
      }, "warn"));
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
      out.push(narration("agent_stream.codex_started", undefined, "info"));
      continue;
    }
    if (event.type === "turn.completed") {
      out.push(narration("agent_stream.codex_finished", undefined, "good"));
      continue;
    }
    if (event.type === "turn.failed") {
      const error = asRecord(event.error);
      out.push(narration("agent_stream.codex_failed", { message: String(error.message ?? "turn failed") }, "bad"));
      continue;
    }
    if (event.type === "error") {
      out.push(narration("agent_stream.codex_error", { message: String(event.message ?? "unknown") }, "bad"));
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
        out.push(narration("agent_stream.codex_changed_files", undefined, "info"));
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

function parsePi(raw: string): AgentSegment[] {
  const out: AgentSegment[] = [];
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      const text = stripAnsi(record.text).trim();
      if (text) out.push({ kind: "text", text });
      continue;
    }
    const event = record.value;
    const text = piAssistantText(event).trim();
    if (text) {
      out.push({ kind: "text", text });
      continue;
    }
    if (event.type === "error") {
      out.push({ kind: "status", tone: "bad", text: String(event.message ?? "unknown error") });
      continue;
    }
    const status = piStatusSegment(event);
    if (status) {
      out.push(status);
    }
  }
  return out;
}

function parsePlain(raw: string): AgentSegment[] {
  const text = stripAnsi(raw).trim();
  return text ? [{ kind: "text", text }] : [];
}

function piAssistantText(event: Record<string, unknown>): string {
  const message = asRecord(event.message ?? event);
  if (event.type !== "message" && event.type !== "assistant_message" && message.role !== "assistant") return "";
  if (message.role && message.role !== "assistant") return "";
  return textFromContent(message);
}

function piStatusSegment(event: Record<string, unknown>): AgentSegment | null {
  if (event.type === "auto_retry_end" && event.success === false) {
    return { kind: "status", tone: "bad", text: `Pi error: ${String(event.finalError ?? "unknown error")}` };
  }
  if (event.type !== "message_end" && event.type !== "turn_end") return null;
  const message = asRecord(event.message ?? event);
  if (message.role !== "assistant") return null;
  const errorMessage = message.errorMessage ?? event.errorMessage;
  if (errorMessage || message.stopReason === "error") {
    return { kind: "status", tone: "bad", text: `Pi error: ${String(errorMessage ?? "unknown error")}` };
  }
  const content = message.content;
  if (Array.isArray(content) && content.length === 0 && message.stopReason === "stop") {
    return { kind: "status", tone: "warn", text: "Pi returned no assistant text." };
  }
  return null;
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
