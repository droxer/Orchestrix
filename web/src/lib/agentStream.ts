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

type ToolSegment = Extract<AgentSegment, { kind: "tool" }>;

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

/**
 * Keeps completed agent turns as parsed checkpoints and reparses only the
 * unfinished suffix while stdout grows. Replacing or truncating stdout resets
 * the cache, so completed-log fallback and run reuse remain correct.
 */
export class AgentStreamAccumulator {
  private raw = "";
  private stableOffset = 0;
  private stableSegments: AgentSegment[] = [];
  private segments: AgentSegment[] = [];
  private seenCheckpointIds = new Set<string>();

  constructor(private readonly agent: AgentName) {}

  update(raw: string): AgentSegment[] {
    if (raw === this.raw) return this.segments;
    if (!raw.startsWith(this.raw)) {
      this.stableOffset = 0;
      this.stableSegments = [];
      this.seenCheckpointIds.clear();
    }
    this.raw = raw;

    let sliceStart = this.stableOffset;
    for (const checkpoint of agentCheckpoints(this.agent, raw, this.stableOffset)) {
      const checkpointId = agentCheckpointId(this.agent, checkpoint.value);
      if (!checkpointId || !this.seenCheckpointIds.has(checkpointId)) {
        this.stableSegments.push(...parseAgentStream(this.agent, raw.slice(sliceStart, checkpoint.end)));
      }
      if (checkpointId) this.seenCheckpointIds.add(checkpointId);
      sliceStart = checkpoint.end;
      this.stableOffset = checkpoint.end;
    }
    this.segments = [
      ...this.stableSegments,
      ...parseAgentStream(this.agent, raw.slice(this.stableOffset)),
    ];
    return this.segments;
  }
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

// The two end-of-turn narrations that report success. Failure is recognised by
// tone instead, so every agent's error shape is covered without enumerating it.
const TERMINAL_SUCCESS_KEYS: ReadonlySet<string> = new Set([
  "agent_stream.claude_finished",
  "agent_stream.codex_finished",
]);

function segmentTone(segment: AgentSegment): string | undefined {
  if (segment.kind === "status") return segment.tone;
  if (segment.kind === "narration" && typeof segment.params?.tone === "string") return segment.params.tone;
  return undefined;
}

/**
 * True once the agent's own stream has reported the turn is over — Claude's
 * `result`, Codex's `turn.completed`/`turn.failed`, or any agent's error frame.
 *
 * The run stays `streaming` until the daemon posts `agent.completed`, so
 * without this the transcript keeps a "Working…" pulse under a line that
 * already says the agent finished. Only `bad` tones count as terminal: `info`
 * belongs to start/progress narrations and `warn` to retries and stderr
 * chatter, all of which happen mid-run while the agent really is still working.
 */
export function hasTerminalOutcome(segments: AgentSegment[]): boolean {
  return segments.some(
    (segment) =>
      (segment.kind === "narration" && TERMINAL_SUCCESS_KEYS.has(segment.key)) || segmentTone(segment) === "bad",
  );
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
  return /"type"\s*:|"session_id"\s*:|stream_event|content_block_|parent_tool_use_id|uuid/.test(text)
    || /(?:tream_event|ream_event|eam_event|am_event|m_event)"\s*,\s*"event"\s*:/.test(text);
}

type StreamRecord =
  | { kind: "json"; value: Record<string, unknown>; end: number }
  | { kind: "text"; text: string; end: number };

const AGENT_CHECKPOINT_TYPES: Record<AgentName, "each" | ReadonlySet<unknown>> = {
  claude: new Set(["assistant", "result"]),
  codex: new Set(["turn.completed", "turn.failed"]),
  pi: new Set(["turn_end"]),
  kimi: "each",
};

function streamRecords(raw: string): StreamRecord[] {
  const out: StreamRecord[] = [];
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
      if (text && !isLikelyProtocolFragment(text) && !isClaudeConnectorNotice(text)) out.push({ kind: "text", text, end });
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
    if (parsed) out.push({ kind: "json", value: parsed, end });
    else if (!isLikelyProtocolFragment(jsonText)) out.push({ kind: "text", text: stripAnsi(jsonText), end });
    i = end;
  }

  return out;
}

type AgentCheckpoint = { end: number; value: Record<string, unknown> };

function agentCheckpoints(agent: AgentName, raw: string, offset: number): AgentCheckpoint[] {
  const checkpoints: AgentCheckpoint[] = [];
  const policy = AGENT_CHECKPOINT_TYPES[agent];
  for (const record of streamRecords(raw.slice(offset))) {
    if (record.kind !== "json") continue;
    if (policy === "each" || policy.has(record.value.type)) {
      checkpoints.push({ end: offset + record.end, value: record.value });
    }
  }
  return checkpoints;
}

function agentCheckpointId(agent: AgentName, event: Record<string, unknown>): string | undefined {
  if (agent !== "claude" || event.type !== "assistant") return undefined;
  const messageId = asRecord(event.message).id;
  return typeof messageId === "string" && messageId ? `assistant:${messageId}` : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toolInput(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return safeParse(value) ?? {};
  return asRecord(value);
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

function upsertSegmentById(
  out: AgentSegment[],
  segmentById: Map<string, number>,
  id: string | undefined,
  segment: AgentSegment,
): void {
  const existing = id ? segmentById.get(id) : undefined;
  if (existing !== undefined) {
    out[existing] = mergeLifecycleSegment(out[existing], segment);
    return;
  }
  out.push(segment);
  if (id) segmentById.set(id, out.length - 1);
}

function mergeLifecycleSegment(previous: AgentSegment | undefined, next: AgentSegment): AgentSegment {
  if (previous?.kind === "tool" && next.kind === "tool" && !next.target && previous.target) {
    return { ...next, target: previous.target };
  }
  return next;
}

function codexToolSegment(item: Record<string, unknown>): ToolSegment | null {
  if (item.type === "mcp_tool_call") {
    const server = typeof item.server === "string" ? item.server : "mcp";
    const tool = typeof item.tool === "string" ? item.tool : String(item.name ?? "tool");
    return { kind: "tool", name: `${server}.${tool}`, target: toolTarget(toolInput(item.arguments ?? item.input)) };
  }
  if (item.type === "web_search") {
    return { kind: "tool", name: "web_search", target: toolTarget(item) };
  }
  if (item.type === "dynamic_tool_call" || item.type === "tool_call") {
    return {
      kind: "tool",
      name: String(item.tool ?? item.name ?? "tool"),
      target: toolTarget(toolInput(item.arguments ?? item.input)),
    };
  }
  if (
    typeof item.type === "string"
    && item.type.endsWith("_tool_call")
    && item.type !== "collab_tool_call"
    && item.type !== "collab_agent_tool_call"
  ) {
    return {
      kind: "tool",
      name: String(item.tool ?? item.name ?? item.type.slice(0, -"_tool_call".length)),
      target: toolTarget(toolInput(item.arguments ?? item.input)),
    };
  }
  return null;
}

class TextBuffer {
  private value = "";

  push(chunk: string): void {
    this.value += chunk;
  }

  drain(): string {
    const trimmed = this.value.trimEnd();
    this.value = "";
    return trimmed;
  }

  flush(out: AgentSegment[], kind: "text" | "thinking"): string {
    const trimmed = this.drain();
    if (trimmed) out.push({ kind, text: trimmed });
    return trimmed;
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
  const streamedTextBlocks: string[] = [];
  const streamedTextByIndex = new Map<number, string>();
  const streamedTextWithoutIndex = new Set<string>();
  const toolSegmentById = new Map<string, number>();
  const seenAssistantMessageIds = new Set<string>();
  let activeTextIndex: number | undefined;
  let turnStartIndex = 0;

  const flushStreamedText = (index = activeTextIndex): void => {
    const blockText = text.drain();
    activeTextIndex = undefined;
    if (!blockText) return;
    const replayed = index === undefined
      ? streamedTextWithoutIndex.has(blockText)
      : streamedTextByIndex.get(index) === blockText;
    if (replayed) return;
    if (index === undefined) streamedTextWithoutIndex.add(blockText);
    else streamedTextByIndex.set(index, blockText);
    streamedTextBlocks.push(blockText);
    out.push({ kind: "text", text: blockText });
  };
  const resetTurnState = (): void => {
    streamedTextBlocks.length = 0;
    streamedTextByIndex.clear();
    streamedTextWithoutIndex.clear();
    toolSegmentById.clear();
  };

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
          flushStreamedText();
          thinking.flush(out, "thinking");
          const segment: AgentSegment = { kind: "tool", name: String(block.name ?? "tool"), target: toolTarget(asRecord(block.input)) };
          upsertSegmentById(out, toolSegmentById, typeof block.id === "string" ? block.id : undefined, segment);
        } else if (block.type === "text") {
          activeTextIndex = typeof streamEvent.index === "number" ? streamEvent.index : undefined;
        }
        continue;
      }
      if (streamEvent.type === "content_block_stop") {
        flushStreamedText(typeof streamEvent.index === "number" ? streamEvent.index : activeTextIndex);
        thinking.flush(out, "thinking");
        continue;
      }
      if (delta.type === "text_delta") {
        thinking.flush(out, "thinking");
        if (typeof streamEvent.index === "number") activeTextIndex = streamEvent.index;
        text.push(String(delta.text ?? ""));
      } else if (delta.type === "thinking_delta") {
        flushStreamedText();
        thinking.push(String(delta.thinking ?? ""));
      }
      continue;
    }
    if (event.type === "assistant") {
      const message = asRecord(event.message);
      const messageId = typeof message.id === "string" ? message.id : undefined;
      if (messageId && seenAssistantMessageIds.has(messageId)) {
        out.splice(turnStartIndex);
        resetTurnState();
        continue;
      }
      if (messageId) seenAssistantMessageIds.add(messageId);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const item of content) {
        const block = asRecord(item);
        if (block.type === "text") {
          const blockText = String(block.text ?? "");
          thinking.flush(out, "thinking");
          flushStreamedText();
          const replayIndex = streamedTextBlocks.indexOf(blockText.trimEnd());
          if (replayIndex >= 0) streamedTextBlocks.splice(replayIndex, 1);
          else if (blockText) out.push({ kind: "text", text: blockText.trimEnd() });
        } else if (block.type === "tool_use") {
          flushStreamedText();
          thinking.flush(out, "thinking");
          const segment: AgentSegment = { kind: "tool", name: String(block.name ?? "tool"), target: toolTarget(asRecord(block.input)) };
          upsertSegmentById(out, toolSegmentById, typeof block.id === "string" ? block.id : undefined, segment);
        }
      }
      resetTurnState();
      turnStartIndex = out.length;
      continue;
    }
    if (event.type === "result") {
      flushStreamedText();
      thinking.flush(out, "thinking");
      if (event.is_error) {
        const message = String(event.result ?? "");
        out.push(message
          ? { kind: "status", tone: "bad", text: message }
          : narration("agent_stream.claude_error", undefined, "bad"));
      } else {
        // Some Claude Code builds (including the cloud-computer image) emit
        // the final response only on the result envelope. Prefer the richer
        // assistant/stream events when present, but never discard the sole
        // copy of a successful answer.
        const resultText = typeof event.result === "string" ? event.result.trimEnd() : "";
        const alreadyRendered = resultText
          ? out.some((segment) => segment.kind === "text" && segment.text.trimEnd() === resultText)
          : false;
        if (resultText && !alreadyRendered) out.push({ kind: "text", text: resultText });
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
  flushStreamedText();
  thinking.flush(out, "thinking");
  return out;
}

function parseCodex(raw: string): AgentSegment[] {
  const out: AgentSegment[] = [];
  const toolSegmentById = new Map<string, number>();
  const toolItemById = new Map<string, Record<string, unknown>>();
  const commandSegmentById = new Map<string, number>();
  for (const record of streamRecords(raw)) {
    if (record.kind === "text") {
      out.push({ kind: "raw", text: stripAnsi(record.text) });
      continue;
    }
    const event = record.value;
    if (event.type === "turn.started") {
      toolSegmentById.clear();
      toolItemById.clear();
      commandSegmentById.clear();
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
      if (
        item.type === "command_execution"
        && (event.type === "item.started" || event.type === "item.completed")
      ) {
        const id = typeof item.id === "string" ? item.id : undefined;
        const existing = id ? commandSegmentById.get(id) : undefined;
        const previous = existing === undefined ? undefined : out[existing];
        let command = "command";
        if (typeof item.command === "string") command = item.command;
        else if (previous?.kind === "command") command = previous.command;
        upsertSegmentById(out, commandSegmentById, id, {
          kind: "command",
          command,
        });
        continue;
      }
      if (event.type === "item.started" || event.type === "item.completed") {
        const id = typeof item.id === "string" ? item.id : undefined;
        const previousItem = id ? toolItemById.get(id) : undefined;
        const mergedItem = previousItem ? { ...previousItem, ...item } : item;
        const tool = codexToolSegment(mergedItem);
        if (tool) {
          if (id) toolItemById.set(id, mergedItem);
          upsertSegmentById(out, toolSegmentById, id, tool);
          continue;
        }
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
  const toolSegmentById = new Map<string, number>();
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
      toolSegmentById.clear();
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
    const tool = piTool(event);
    if (tool) {
      const streamedText = textBuffer.flush(out, "text");
      if (streamedText) sawAssistantTextInTurn = true;
      thinkingBuffer.flush(out, "thinking");
      if (!sawAssistantTextInTurn) {
        const accumulatedText = piAssistantText(event).trim();
        if (accumulatedText) {
          out.push({ kind: "text", text: accumulatedText });
          sawAssistantTextInTurn = true;
        }
      }
      const segment: AgentSegment = {
        kind: "tool",
        name: tool.name,
        ...(tool.target ? { target: tool.target } : {}),
      };
      upsertSegmentById(out, toolSegmentById, tool.id, segment);
      continue;
    }
    const assistantText = piAssistantText(event).trim();
    if (assistantText) {
      textBuffer.flush(out, "text");
      thinkingBuffer.flush(out, "thinking");
      if (sawAssistantTextInTurn && (event.type === "message_end" || event.type === "turn_end")) continue;
      sawAssistantTextInTurn = true;
      out.push({ kind: "text", text: assistantText });
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
      const target = toolTarget(toolInput(fn.arguments ?? callRecord.arguments));
      out.push({
        kind: "tool",
        name: String(fn.name ?? callRecord.name ?? "tool"),
        ...(target ? { target } : {}),
      });
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

function piTool(event: Record<string, unknown>): { id?: string; name: string; target?: string } | null {
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
    return {
      id: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
      name: event.toolName,
      target: toolTarget(toolInput(event.args)),
    };
  }
  if (event.type !== "message_update") return null;
  const message = asRecord(event.message);
  if (message.role !== "assistant") return null;
  const assistantEvent = asRecord(event.assistantMessageEvent);
  if (assistantEvent.type !== "toolcall_end") return null;
  const toolCall = asRecord(assistantEvent.toolCall);
  if (typeof toolCall.name !== "string") return null;
  return {
    id: typeof toolCall.id === "string" ? toolCall.id : undefined,
    name: toolCall.name,
    target: toolTarget(toolInput(toolCall.arguments ?? toolCall.args)),
  };
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
