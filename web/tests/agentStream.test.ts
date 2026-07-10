import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import { displayAgentSegments, emptyAgentStreamSegments, hasStreamingTextCaret, parseAgentStderr, parseAgentStream, userVisibleAgentSegments, agentMessagePlainText, type AgentSegment } from "../src/lib/agentStream.js";

describe("agent stream parsing", () => {
  it("filters Codex stdin notice from stderr", () => {
    const raw = [
      "Reading additional input from stdin.",
      "Reading additional input from stdin...",
      "Reading additional input from stdin…",
      "real warning",
    ].join("\n");

    assert.deepEqual(parseAgentStderr(raw), [
      { kind: "status", tone: "warn", text: "real warning" },
    ]);
  });

  it("collapses long stderr to the tail behind an omitted-lines narration", () => {
    const raw = ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n");

    assert.deepEqual(parseAgentStderr(raw), [
      { kind: "narration", key: "agent_stream.stderr_omitted", params: { count: 2, tone: "warn" } },
      { kind: "status", tone: "warn", text: "line 3" },
      { kind: "status", tone: "warn", text: "line 4" },
      { kind: "status", tone: "warn", text: "line 5" },
    ]);
  });

  it("dedupes consecutive repeated stderr lines", () => {
    const raw = ["progress 50%", "progress 50%", "progress 50%", "done with warnings"].join("\n");

    assert.deepEqual(parseAgentStderr(raw), [
      { kind: "status", tone: "warn", text: "progress 50%" },
      { kind: "status", tone: "warn", text: "done with warnings" },
    ]);
  });

  it("keeps raw fallback output visible when it is the only substance of a turn", () => {
    const segments: AgentSegment[] = [
      { kind: "raw", text: "plain CLI output the parser could not classify" },
      { kind: "narration", key: "agent_stream.codex_finished", params: { tone: "good" } },
    ];

    assert.deepEqual(userVisibleAgentSegments(segments), segments);
  });

  it("still elides raw fallback output once real text is present", () => {
    const segments: AgentSegment[] = [
      { kind: "raw", text: "protocol noise" },
      { kind: "text", text: "Here is the answer." },
    ];

    assert.deepEqual(userVisibleAgentSegments(segments), [
      { kind: "text", text: "Here is the answer." },
    ]);
  });

  it("renders Pi stdout as message text", () => {
    assert.deepEqual(parseAgentStream("pi", "\n\nHi from Pi.\n"), [
      { kind: "text", text: "Hi from Pi." },
    ]);
  });

  it("renders Pi JSON assistant message events as text", () => {
    const raw = [
      JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }] } }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "Hi from Pi JSON." },
    ]);
  });

  it("renders Pi JSON streaming text deltas without empty terminal warnings", () => {
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi " },
      }),
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "from Pi JSON." },
      }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }),
      JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" }, toolResults: [] }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "Hi from Pi JSON." },
    ]);
  });

  it("renders Pi JSON final text events when no text delta was emitted", () => {
    const raw = [
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Final Pi text." },
      }),
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Final Pi text." }], stopReason: "stop" },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "Final Pi text." },
    ]);
  });

  it("parses Pi JSON thinking and tool progress as internal stream segments", () => {
    const raw = [
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking files." },
      }),
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", name: "read", arguments: {} } },
      }),
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "call_1",
        toolName: "bash",
        args: { command: "npm test" },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "thinking", text: "Checking files." },
      { kind: "tool", name: "read" },
      { kind: "tool", name: "bash" },
    ]);
  });

  it("filters internal reasoning and tool progress from the user-visible stream", () => {
    const raw = [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "reason_1", type: "reasoning", text: "Inspecting private chain of thought." },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "cmd_1", type: "command_execution", command: "cat secret.txt" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg_1", type: "agent_message", text: "Here is the answer." },
      }),
      "truncated protocol fragment",
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    assert.deepEqual(userVisibleAgentSegments(parseAgentStream("codex", raw)), [
      { kind: "narration", key: "agent_stream.codex_started", params: { tone: "info" } },
      { kind: "text", text: "Here is the answer." },
      { kind: "narration", key: "agent_stream.codex_finished", params: { tone: "good" } },
    ]);
  });

  it("recovers Codex agent_message objects from truncated completed-log tails", () => {
    const raw = "leted\",\"item\":" + JSON.stringify({
      id: "item_0",
      type: "agent_message",
      text: "Recovered completed answer.",
    });

    assert.deepEqual(userVisibleAgentSegments(parseAgentStream("codex", raw)), [
      { kind: "text", text: "Recovered completed answer." },
    ]);
  });

  it("shows tool and command lines only while a run is streaming", () => {
    const segments: AgentSegment[] = [
      { kind: "text", text: "Planning." },
      { kind: "tool", name: "Read", target: "src/app.ts" },
      { kind: "command", command: "npm test" },
      { kind: "thinking", text: "hidden reasoning" },
    ];

    assert.deepEqual(displayAgentSegments(segments, true), [
      { kind: "text", text: "Planning." },
      { kind: "tool", name: "Read", target: "src/app.ts" },
      { kind: "command", command: "npm test" },
    ]);
    assert.deepEqual(displayAgentSegments(segments, false), [
      { kind: "text", text: "Planning." },
    ]);
  });

  it("detects when the streaming caret should attach to text", () => {
    assert.equal(hasStreamingTextCaret([{ kind: "tool", name: "Read" }]), false);
    assert.equal(hasStreamingTextCaret([{ kind: "text", text: "Still typing" }]), true);
  });

  it("renders Kimi assistant text without raw JSON", () => {
    const raw = JSON.stringify({ role: "assistant", content: "Loop engineering is the latest paradigm." });

    const segments = parseAgentStream("kimi", raw);

    assert.deepEqual(segments, [
      { kind: "text", text: "Loop engineering is the latest paradigm." },
    ]);
    assert.equal(JSON.stringify(segments).includes("\"role\":\"assistant\""), false);
  });

  it("renders Kimi content arrays and tool calls", () => {
    const raw = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "Searching the web." }],
      tool_calls: [{ id: "call_1", function: { name: "web_search" } }],
    });

    assert.deepEqual(parseAgentStream("kimi", raw), [
      { kind: "text", text: "Searching the web." },
      { kind: "tool", name: "web_search" },
    ]);
  });

  it("drops Kimi tool-result and non-assistant messages", () => {
    const raw = [
      JSON.stringify({ role: "user", content: "最新的 loop engineering 是？" }),
      JSON.stringify({ role: "tool", tool_call_id: "call_1", content: "raw tool output" }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("kimi", raw), []);
  });

  it("renders Kimi error events as bad status", () => {
    const raw = JSON.stringify({ type: "error", message: "auth required" });

    assert.deepEqual(parseAgentStream("kimi", raw), [
      { kind: "status", tone: "bad", text: "Kimi error: auth required" },
    ]);
  });

  it("carries the file/command target on Claude tool_use lines", () => {
    const raw = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "backend/relay/app.py" } },
            { type: "tool_use", name: "Bash", input: { command: "npm run build\n(second line ignored)" } },
            { type: "tool_use", name: "Think", input: {} },
          ],
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "tool", name: "Read", target: "backend/relay/app.py" },
      { kind: "tool", name: "Bash", target: "npm run build" },
      { kind: "tool", name: "Think", target: undefined },
    ]);
  });

  it("does not duplicate Claude assistant text after streamed deltas", () => {
    const raw = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "text" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Final Claude answer." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Final Claude answer." }] },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "text", text: "Final Claude answer." },
    ]);
  });

  it("does not duplicate replayed Claude streamed text blocks", () => {
    const streamedAnswer = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "text" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Replayed Claude answer." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop" },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", `${streamedAnswer}\n${streamedAnswer}`), [
      { kind: "text", text: "Replayed Claude answer." },
    ]);
  });

  it("keeps Claude assistant text when no streamed delta was emitted", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Fallback Claude answer." }] },
    });

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "text", text: "Fallback Claude answer." },
    ]);
  });

  it("ignores Pi JSON empty assistant lifecycle events", () => {
    const raw = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop" },
    });

    assert.deepEqual(parseAgentStream("pi", raw), []);
  });

  it("ignores repeated Pi empty assistant lifecycle events", () => {
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }),
      JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" }, toolResults: [] }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), []);
  });

  it("renders Pi JSON assistant errors as bad status", () => {
    const raw = JSON.stringify({
      type: "turn_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Connection error." },
    });

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "status", tone: "bad", text: "Pi error: Connection error." },
    ]);
  });

  it("does not add a Pi-specific fallback warning for completed empty chat output", () => {
    const t = (key: string) => key;

    assert.deepEqual(emptyAgentStreamSegments("pi", false, t as TFunction), []);
    assert.deepEqual(emptyAgentStreamSegments("pi", true, t as TFunction), []);
    assert.deepEqual(emptyAgentStreamSegments("claude", false, t as TFunction), []);
  });

  it("extracts user-visible plain text for copy", () => {
    const t = (key: string) => key;
    const stdout = "\n\nShip the fix.\n";
    const stderr = "stderr warning";

    assert.equal(
      agentMessagePlainText("pi", stdout, stderr, t as TFunction),
      "Ship the fix.\n\nstderr warning",
    );
  });
});
