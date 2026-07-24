import type { AgentName, Tone } from "../types.js";
import type { TFunction } from "i18next";

export type AgentSegment =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; target?: string }
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
  if (agent === "kimi") return parseKimi(raw);
  return parsePlain(raw);
}

export function userVisibleAgentSegments(segments: AgentSegment[]): AgentSegment[] {
  const visible = segments.filter(
    (segment) => segment.kind === "text" || segment.kind === "status" || segment.kind === "narration",
  );
  // Raw fallback output (CLI text the parser could not classify) is elided
  // once a run settles — unless it is the only substance, in which case
  // dropping it would leave the turn reading as empty.
  if (visible.some((segment) => segment.kind === "text")) return visible;
  if (!segments.some((segment) => segment.kind === "raw")) return visible;
  return segments.filter(
    (segment) =>
      segment.kind === "text" ||
      segment.kind === "status" ||
      segment.kind === "narration" ||
      segment.kind === "raw",
  );
}

/**
 * While a run is live, surface tool/command lines so long silent stretches
 * still read as activity. After settle they stay too — the settled transcript
 * keeps the tool log instead of collapsing to prose only.
 */
export function displayAgentSegments(segments: AgentSegment[], streaming: boolean): AgentSegment[] {
  if (streaming) return segments.filter((segment) => segment.kind !== "thinking");
  const visible = new Set(userVisibleAgentSegments(segments));
  return segments.filter(
    (segment) => segment.kind === "tool" || segment.kind === "command" || visible.has(segment),
  );
}

export function hasStreamingTextCaret(segments: AgentSegment[]): boolean {
  return segments[segments.length - 1]?.kind === "text";
}

export function emptyAgentStreamSegments(_agent: AgentName, _streaming: boolean, _t: TFunction): AgentSegment[] {
  return [];
}

export function agentMessagePlainText(
  agent: AgentName,
  stdout: string,
  stderr: string,
  t: TFunction,
  streaming = false,
): string {
  const segments = displayAgentSegments(
    [...parseAgentStream(agent, stdout), ...parseAgentStderr(stderr)],
    streaming,
  );
  return segments
    .map((segment) => {
      if (segment.kind === "text" || segment.kind === "status" || segment.kind === "raw") return segment.text;
      if (segment.kind === "narration") return t(segment.key, segment.params);
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

// stderr from a chatty CLI (progress bars, repeated deprecation warnings) can
// run to dozens of lines; the transcript keeps the tail — where the actual
// error usually lands — behind a single "omitted" line instead of a wall of
// warn rows.
const STDERR_TAIL_LINES = 3;

export function parseAgentStderr(raw: string): AgentSegment[] {
  if (!raw) return [];
  const lines = stripAnsi(raw).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCodexStdinNotice(line) && !isClaudeConnectorNotice(line))
    .filter((line, index, all) => line !== all[index - 1]);
  const tail = lines.slice(-STDERR_TAIL_LINES);
  const omitted = lines.length - tail.length;
  const out: AgentSegment[] = [];
  if (omitted > 0) out.push(narration("agent_stream.stderr_omitted", { count: omitted }, "warn"));
  for (const line of tail) out.push({ kind: "status", tone: "warn", text: line });
  return out;
}

function isCodexStdinNotice(line: string): boolean {
  return /^Reading additional input from stdin(?:\.{1,3}|…)?$/.test(line);
}

// Claude prints a claude.ai connectors notice when ANTHROPIC_API_KEY or another
// auth source takes precedence over the claude.ai login. Relay provisions auth
// deliberately, so the notice is informational, not a run warning.
function isClaudeConnectorNotice(line: string): boolean {
  return /claude\.ai connectors are disabled/.test(line)
    || /Unset it to load your organization's connectors/.test(line);
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
      if (text && !isLikelyProtocolFragment(text) && !isClaudeConnectorNotice(text)) out.push({ kind: "text", text });
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
      // Unterminated object: this is almost always a JSON frame still being
      // streamed in. Drop it rather than flashing the partial as raw text;
      // the next render reparses once the closing brace arrives.
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

// A concise, single-line target for a tool call — the file it touched or the
// command it ran — pulled from the tool_use input so the transcript shows
// "Read backend/app.py" instead of a bare "Read". Best-effort: returns
// undefined when no recognizable field is present (or input hasn't streamed
// in yet), in which case the line renders as just the tool name.
const TOOL_TARGET_KEYS = [
  "command",
  "file_path",
  "path",
  "notebook_path",
  "pattern",
  "url",
  "query",
  "prompt",
  "description",
] as const;

function hasSegmentText(out: AgentSegment[], kind: "text" | "thinking", text: string): boolean {
  const normalized = text.trim();
  return out.some((segment) => segment.kind === kind && segment.text.trim() === normalized);
}

function toolTarget(input: Record<string, unknown>): string | undefined {
  for (const key of TOOL_TARGET_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const oneLine = value.trim().split("\n")[0]!.trim();
      return oneLine.length > 120 ? `${oneLine.slice(0, 119)}…` : oneLine;
    }
  }
  return undefined;
}

class TextBuffer {
  private value = "";

  push(chunk: string): void {
    this.value += chunk;
  }

  flush(out: AgentSegment[], kind: "text" | "thinking"): void {
    const trimmed = this.value.trimEnd();
    if (trimmed && !hasSegmentText(out, kind, trimmed)) out.push({ kind, text: trimmed });
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
          out.push({ kind: "tool", name: String(block.name ?? "tool"), target: toolTarget(asRecord(block.input)) });
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
          const blockText = String(block.text ?? "");
          thinking.flush(out, "thinking");
          if (blockText && !hasSegmentText(out, "text", blockText)) text.push(blockText);
        } else if (block.type === "tool_use") {
          text.flush(out, "text");
          thinking.flush(out, "thinking");
          out.push({ kind: "tool", name: String(block.name ?? "tool"), target: toolTarget(asRecord(block.input)) });
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
    if (event.type === "agent_message") {
      const text = textFromContent(event).trim();
      if (text) out.push({ kind: "text", text });
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
  const textBuffer = new TextBuffer();
  const thinkingBuffer = new TextBuffer();
  let sawAssistantTextInTurn = false;
  let sawAssistantThinkingInTurn = false;
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      const text = stripAnsi(record.text).trim();
      if (text) out.push({ kind: "text", text });
      continue;
    }
    const event = record.value;
    if (event.type === "turn_start") {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      sawAssistantTextInTurn = false;
      sawAssistantThinkingInTurn = false;
      continue;
    }
    const delta = piAssistantDelta(event, "text_delta");
    if (delta.trim()) {
      sawAssistantTextInTurn = true;
      thinkingBuffer.flush(out, "thinking");
      textBuffer.push(delta);
      continue;
    }
    const thinkingDelta = piAssistantDelta(event, "thinking_delta");
    if (thinkingDelta.trim()) {
      textBuffer.flush(out, "text");
      sawAssistantThinkingInTurn = true;
      thinkingBuffer.push(thinkingDelta);
      continue;
    }
    const endedText = piAssistantEndedContent(event, "text_end").trim();
    if (endedText) {
      thinkingBuffer.flush(out, "thinking");
      textBuffer.flush(out, "text");
      if (!sawAssistantTextInTurn) out.push({ kind: "text", text: endedText });
      sawAssistantTextInTurn = true;
      continue;
    }
    const endedThinking = piAssistantEndedContent(event, "thinking_end").trim();
    if (endedThinking) {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      if (!sawAssistantThinkingInTurn) out.push({ kind: "thinking", text: endedThinking });
      sawAssistantThinkingInTurn = true;
      continue;
    }
    const text = piAssistantText(event).trim();
    if (text) {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      if (sawAssistantTextInTurn && (event.type === "message_end" || event.type === "turn_end")) continue;
      sawAssistantTextInTurn = true;
      out.push({ kind: "text", text });
      continue;
    }
    const toolName = piToolName(event);
    if (toolName) {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      out.push({ kind: "tool", name: toolName });
      continue;
    }
    if (event.type === "error") {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      out.push({ kind: "status", tone: "bad", text: String(event.message ?? "unknown error") });
      continue;
    }
    const status = piStatusSegment(event);
    if (status) {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      out.push(status);
    }
  }
  textBuffer.flush(out, "text");
  thinkingBuffer.flush(out, "thinking");
  return out;
}

function parseKimi(raw: string): AgentSegment[] {
  const out: AgentSegment[] = [];
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      const text = stripAnsi(record.text).trim();
      if (text) out.push({ kind: "text", text });
      continue;
    }
    const event = record.value;
    if (event.type === "error") {
      out.push({ kind: "status", tone: "bad", text: `Kimi error: ${String(event.message ?? "unknown error")}` });
      continue;
    }

    const message = asRecord(event.message ?? event);
    const role = message.role ?? event.role;
    if (role !== undefined && role !== "assistant") continue;

    const text = textFromContent(message).trim();
    if (text) out.push({ kind: "text", text });

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of toolCalls) {
      const callRecord = asRecord(call);
      const fn = asRecord(callRecord.function);
      out.push({ kind: "tool", name: String(fn.name ?? callRecord.name ?? "tool") });
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

function piAssistantDelta(event: Record<string, unknown>, type: "text_delta" | "thinking_delta"): string {
  if (event.type !== "message_update") return "";
  const message = asRecord(event.message);
  if (message.role !== "assistant") return "";
  const assistantEvent = asRecord(event.assistantMessageEvent);
  if (assistantEvent.type !== type) return "";
  return typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
}

function piAssistantEndedContent(event: Record<string, unknown>, type: "text_end" | "thinking_end"): string {
  if (event.type !== "message_update") return "";
  const message = asRecord(event.message);
  if (message.role !== "assistant") return "";
  const assistantEvent = asRecord(event.assistantMessageEvent);
  if (assistantEvent.type === type && typeof assistantEvent.content === "string") return assistantEvent.content;
  if (assistantEvent.type === "done" && type === "text_end") {
    return textFromContent(asRecord(assistantEvent.message));
  }
  return "";
}

function piToolName(event: Record<string, unknown>): string {
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") return event.toolName;
  if (event.type !== "message_update") return "";
  const message = asRecord(event.message);
  if (message.role !== "assistant") return "";
  const assistantEvent = asRecord(event.assistantMessageEvent);
  if (assistantEvent.type !== "toolcall_end") return "";
  const toolCall = asRecord(assistantEvent.toolCall);
  return typeof toolCall.name === "string" ? toolCall.name : "";
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
