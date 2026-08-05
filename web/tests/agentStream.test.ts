import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import { AgentStreamAccumulator, displayAgentSegments, reasoningDisplay, displayAgentStreamSegments, emptyAgentStreamSegments, hasStreamingTextCaret, hasTerminalOutcome, parseAgentStderr, parseAgentStream, userVisibleAgentSegments, agentMessagePlainText, type AgentSegment } from "../src/lib/agentStream.js";

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

  it("filters the Claude claude.ai connectors notice from stderr", () => {
    const raw = [
      "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors",
      "real warning",
    ].join("\n");

    assert.deepEqual(parseAgentStderr(raw), [
      { kind: "status", tone: "warn", text: "real warning" },
    ]);
  });

  it("filters the Claude claude.ai connectors notice from stdout text lines", () => {
    const raw = [
      "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set",
      JSON.stringify({ type: "result", is_error: false }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
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

  it("does not render a truncated stream-event envelope as an AI response", () => {
    assert.deepEqual(parseAgentStream("claude", '"m_event","event": "'), []);
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
      { kind: "tool", name: "bash", target: "npm test" },
    ]);
  });

  it("renders a Pi toolcall_end once when the event carries accumulated assistant text", () => {
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "message_update",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Checking files." },
            { type: "toolCall", name: "read", arguments: { path: "src/app.ts" } },
          ],
        },
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 1,
          toolCall: { id: "call_1", type: "toolCall", name: "read", arguments: { path: "src/app.ts" } },
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "Checking files." },
      { kind: "tool", name: "read", target: "src/app.ts" },
    ]);
  });

  it("does not render a Pi text block from the accumulated snapshot before its deltas stream", () => {
    // `text_start` already carries the opening characters of the block in the
    // accumulated message. Rendering that snapshot emits a truncated segment
    // that the completed block then repeats in full.
    const partial = { role: "assistant", content: [{ type: "text", text: "I checked the" }] };
    const whole = { role: "assistant", content: [{ type: "text", text: "I checked the project." }] };
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_start", contentIndex: 0 },
      }),
      JSON.stringify({
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "I checked the" },
      }),
      JSON.stringify({
        type: "message_update",
        message: whole,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " project." },
      }),
      JSON.stringify({
        type: "message_update",
        message: whole,
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "I checked the project." },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "I checked the project." },
    ]);
  });

  it("renders streamed Pi text once when later toolcall frames carry the same accumulated message", () => {
    // Pi attaches the accumulated assistant message to every `message_update`,
    // including the toolcall frames that follow a completed text block. Each of
    // those carries the reply the deltas already rendered, so the parser must
    // recognise it as text it has emitted rather than push another copy.
    const accumulated = {
      role: "assistant",
      content: [{ type: "text", text: "Checked the project." }],
    };
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "message_update",
        message: accumulated,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Checked " },
      }),
      JSON.stringify({
        type: "message_update",
        message: accumulated,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "the project." },
      }),
      JSON.stringify({
        type: "message_update",
        message: accumulated,
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 },
      }),
      JSON.stringify({
        type: "message_update",
        message: accumulated,
        assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "{\"path\":" },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "Checked the project." },
    ]);
  });

  it("keeps reused Pi tool ids distinct across turns", () => {
    const toolEvent = (name: string) => JSON.stringify({
      type: "message_update",
      message: { role: "assistant", content: [] },
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: { id: "call_1", type: "toolCall", name, arguments: {} },
      },
    });
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      toolEvent("read"),
      JSON.stringify({ type: "turn_start" }),
      toolEvent("bash"),
    ].join("\n");

    assert.deepEqual(parseAgentStream("pi", raw), [
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

  it("renders Codex MCP and web-search item starts as tool calls", () => {
    const raw = [
      JSON.stringify({
        type: "item.started",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
          server: "context7",
          tool: "query-docs",
          arguments: { query: "current docs" },
        },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "web_1", type: "web_search", query: "Relay SSE rendering" },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "db_1", type: "database_tool_call", tool: "lookup", arguments: { query: "session events" } },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "tool", name: "context7.query-docs", target: "current docs" },
      { kind: "tool", name: "web_search", target: "Relay SSE rendering" },
      { kind: "tool", name: "lookup", target: "session events" },
    ]);
  });

  it("renders a Codex tool call when only its completed lifecycle event is available", () => {
    const raw = JSON.stringify({
      type: "item.completed",
      item: {
        id: "mcp_1",
        type: "mcp_tool_call",
        server: "context7",
        tool: "query-docs",
        arguments: { query: "current docs" },
      },
    });

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "tool", name: "context7.query-docs", target: "current docs" },
    ]);
  });

  it("merges Codex started and completed events for the same tool call", () => {
    const raw = [
      JSON.stringify({
        type: "item.started",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
          server: "context7",
          tool: "query-docs",
          arguments: {},
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
          server: "context7",
          tool: "query-docs",
          arguments: { query: "current docs" },
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "tool", name: "context7.query-docs", target: "current docs" },
    ]);
  });

  it("preserves the Codex tool target when its completed event is sparse", () => {
    const raw = [
      JSON.stringify({
        type: "item.started",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
          server: "context7",
          tool: "query-docs",
          arguments: { query: "current docs" },
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "tool", name: "context7.query-docs", target: "current docs" },
    ]);
  });

  it("keeps one Codex tool line while its lifecycle advances incrementally", () => {
    const started = JSON.stringify({
      type: "item.started",
      item: {
        id: "mcp_1",
        type: "mcp_tool_call",
        server: "context7",
        tool: "query-docs",
        arguments: {},
      },
    });
    const completed = JSON.stringify({
      type: "item.completed",
      item: {
        id: "mcp_1",
        type: "mcp_tool_call",
        server: "context7",
        tool: "query-docs",
        arguments: { query: "current docs" },
      },
    });
    const accumulator = new AgentStreamAccumulator("codex");

    assert.deepEqual(accumulator.update(started), [
      { kind: "tool", name: "context7.query-docs", target: undefined },
    ]);
    assert.deepEqual(accumulator.update(`${started}\n${completed}`), [
      { kind: "tool", name: "context7.query-docs", target: "current docs" },
    ]);
  });

  it("keeps reused Codex tool ids distinct across turns", () => {
    const raw = [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.started",
        item: { id: "tool_1", type: "tool_call", name: "read", arguments: { path: "one.ts" } },
      }),
      JSON.stringify({ type: "turn.completed" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.started",
        item: { id: "tool_1", type: "tool_call", name: "write", arguments: { path: "two.ts" } },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "narration", key: "agent_stream.codex_started", params: { tone: "info" } },
      { kind: "tool", name: "read", target: "one.ts" },
      { kind: "narration", key: "agent_stream.codex_finished", params: { tone: "good" } },
      { kind: "narration", key: "agent_stream.codex_started", params: { tone: "info" } },
      { kind: "tool", name: "write", target: "two.ts" },
    ]);
  });

  it("renders a Codex command when only its completed lifecycle event is available", () => {
    const raw = JSON.stringify({
      type: "item.completed",
      item: {
        id: "cmd_1",
        type: "command_execution",
        command: "npm test",
      },
    });

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "command", command: "npm test" },
    ]);
  });

  it("merges Codex command lifecycle events without losing the command text", () => {
    const raw = [
      JSON.stringify({
        type: "item.started",
        item: { id: "cmd_1", type: "command_execution", command: "npm test" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "cmd_1", type: "command_execution" },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "command", command: "npm test" },
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

  it("collapses settled reasoning to its expand toggle", () => {
    const lines = ["Checking the config.", "It looks fine."];

    assert.deepEqual(reasoningDisplay(lines, { live: false, expanded: false }), {
      lines: [],
      toggle: "expand",
    });
  });

  it("shows every reasoning line once the reader expands it", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `step ${index}`);

    assert.deepEqual(reasoningDisplay(lines, { live: false, expanded: true }), {
      lines,
      toggle: "collapse",
    });
  });

  it("keeps live reasoning open and untoggleable", () => {
    // A run can spend minutes reasoning before it writes a word — collapsing
    // the block still being written would leave the turn visibly blank.
    const lines = ["Weighing the options."];

    assert.deepEqual(reasoningDisplay(lines, { live: true, expanded: false }), {
      lines,
      toggle: null,
    });
  });

  it("keeps tool, command and reasoning lines in the transcript", () => {
    const segments: AgentSegment[] = [
      { kind: "text", text: "Planning." },
      { kind: "tool", name: "Read", target: "src/app.ts" },
      { kind: "command", command: "npm test" },
      { kind: "thinking", text: "weighing the options" },
    ];

    // Reasoning is part of the rendered transcript: a run can spend minutes
    // thinking before it writes a word, and hiding it left those stretches
    // blank. Settling must not erase the tool log or the reasoning either.
    assert.deepEqual(displayAgentSegments(segments, true), segments);
    assert.deepEqual(displayAgentSegments(segments, false), segments);
  });

  it("keeps reasoning out of the copied plain text", () => {
    // Rendering reasoning is a transcript decision; the copy affordance stays
    // the agent's prose answer.
    const t = (key: string) => key;
    const raw = [
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "weighing the options" },
      }),
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Done." },
      }),
    ].join("\n");

    assert.equal(agentMessagePlainText("pi", raw, "", t as TFunction, true), "Done.");
  });

  it("detects when the streaming caret should attach to text", () => {
    assert.equal(hasStreamingTextCaret([{ kind: "tool", name: "Read" }]), false);
    assert.equal(hasStreamingTextCaret([{ kind: "text", text: "Still typing" }]), true);
  });

  it("keeps stdout text live when stderr status rows trail it", () => {
    const text = { kind: "text", text: "Still typing" } as const;
    const warning = { kind: "status", tone: "warn", text: "retrying" } as const;
    const displayed = displayAgentStreamSegments([text], [warning], true);

    assert.deepEqual(displayed.segments, [text, warning]);
    assert.equal(displayed.liveTextIndex, 0);
  });

  it("does not mark earlier text live after a stdout tool call", () => {
    const displayed = displayAgentStreamSegments([
      { kind: "text", text: "Checking." },
      { kind: "tool", name: "Read" },
    ], [{ kind: "status", tone: "warn", text: "slow command" }], true);

    assert.equal(displayed.liveTextIndex, -1);
  });

  it("treats an agent's own end-of-turn frame as a terminal outcome", () => {
    for (const agent of ["claude", "codex"] as const) {
      const raw = agent === "claude"
        ? JSON.stringify({ type: "result", subtype: "success", is_error: false })
        : JSON.stringify({ type: "turn.completed" });
      assert.equal(hasTerminalOutcome(parseAgentStream(agent, raw)), true, `${agent} finished`);
    }
  });

  it("treats a failed turn as a terminal outcome for every agent", () => {
    const failures: Array<[Parameters<typeof parseAgentStream>[0], string]> = [
      ["claude", JSON.stringify({ type: "result", is_error: true, result: "API error: 529 overloaded" })],
      ["codex", JSON.stringify({ type: "turn.failed", error: { message: "sandbox denied write" } })],
      ["pi", JSON.stringify({ type: "error", message: "model unavailable" })],
      ["kimi", JSON.stringify({ type: "error", message: "context length exceeded" })],
    ];
    for (const [agent, raw] of failures) {
      assert.equal(hasTerminalOutcome(parseAgentStream(agent, raw)), true, `${agent} failed`);
    }
  });

  // The pulse must survive the long silences mid-run: a start narration, a
  // retry, and stderr chatter all mean the agent is still working.
  it("does not treat start, retry, or stderr segments as a terminal outcome", () => {
    assert.equal(hasTerminalOutcome(parseAgentStream("codex", JSON.stringify({ type: "turn.started" }))), false);
    assert.equal(
      hasTerminalOutcome(parseAgentStream("claude", JSON.stringify({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 5 }))),
      false,
    );
    assert.equal(hasTerminalOutcome(parseAgentStderr("warning: cache directory not writable")), false);
    assert.equal(hasTerminalOutcome([{ kind: "text", text: "Still typing" }, { kind: "tool", name: "Read" }]), false);
  });

  // stderr segments are appended after stdout, so the terminal frame is not
  // necessarily the last segment in the list.
  it("detects a terminal outcome even when stderr rows trail it", () => {
    const segments = [
      ...parseAgentStream("claude", JSON.stringify({ type: "result", subtype: "success", is_error: false })),
      ...parseAgentStderr("warning: deprecated flag\nerror: upstream connect timeout"),
    ];

    assert.equal(hasTerminalOutcome(segments), true);
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

  it("renders a Kimi tool target from JSON-string function arguments", () => {
    const raw = JSON.stringify({
      role: "assistant",
      content: [],
      tool_calls: [{
        id: "call_1",
        function: { name: "web_search", arguments: JSON.stringify({ query: "Relay SSE rendering" }) },
      }],
    });

    assert.deepEqual(parseAgentStream("kimi", raw), [
      { kind: "tool", name: "web_search", target: "Relay SSE rendering" },
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

  it("merges Claude partial and completed events for the same tool call", () => {
    const raw = [
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool_1", name: "Read", input: {} },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "src/app.ts" } },
          ],
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "tool", name: "Read", target: "src/app.ts" },
    ]);
  });

  it("preserves identical Claude text in distinct indexed content blocks", () => {
    const block = (index: number) => [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_start", index, content_block: { type: "text" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index, delta: { type: "text_delta", text: "Same text." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index },
      }),
    ];

    assert.deepEqual(parseAgentStream("claude", [...block(0), ...block(1)].join("\n")), [
      { kind: "text", text: "Same text." },
      { kind: "text", text: "Same text." },
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

  it("does not duplicate replayed Claude turns with the same assistant message id", () => {
    const turn = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Replayed turn." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "Replayed turn." }] },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", `${turn}\n${turn}`), [
      { kind: "text", text: "Replayed turn." },
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

  it("renders a Claude result-only response from a cloud computer", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Final response from cloud Claude.",
    });

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "text", text: "Final response from cloud Claude." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("does not duplicate Claude result text already carried by an assistant event", () => {
    const raw = [
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "One final response." }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "One final response.",
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", raw), [
      { kind: "text", text: "One final response." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("incrementally renders only the unfinished Claude turn without changing visible output", () => {
    const accumulator = new AgentStreamAccumulator("claude");
    const streamed = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "First answer." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
    ].join("\n");
    const completed = `${streamed}\n${JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "First answer." }] },
    })}`;
    const nextTurn = `${completed}\n${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Second" } },
    })}`;

    assert.deepEqual(accumulator.update(streamed), [{ kind: "text", text: "First answer." }]);
    assert.deepEqual(accumulator.update(completed), [{ kind: "text", text: "First answer." }]);
    assert.deepEqual(accumulator.update(nextTurn), [
      { kind: "text", text: "First answer." },
      { kind: "text", text: "Second" },
    ]);
    assert.deepEqual(accumulator.update("plain replacement"), [{ kind: "text", text: "plain replacement" }]);
  });

  it("does not re-append a replayed Claude checkpoint", () => {
    const turn = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "One answer." } },
      }),
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "One answer." }] },
      }),
    ].join("\n");
    const accumulator = new AgentStreamAccumulator("claude");

    assert.deepEqual(accumulator.update(turn), [{ kind: "text", text: "One answer." }]);
    assert.deepEqual(accumulator.update(`${turn}\n${turn}`), [{ kind: "text", text: "One answer." }]);
  });

  it("does not duplicate Claude result text when the result frame checkpoints separately", () => {
    const assistantFrame = JSON.stringify({
      type: "assistant",
      message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "The answer is 42." }] },
    });
    const resultFrame = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "The answer is 42.",
    });
    const accumulator = new AgentStreamAccumulator("claude");

    assert.deepEqual(accumulator.update(assistantFrame), [{ kind: "text", text: "The answer is 42." }]);
    assert.deepEqual(accumulator.update(`${assistantFrame}\n${resultFrame}`), [
      { kind: "text", text: "The answer is 42." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("drops a historical replacement-corrupted Claude result when the assistant frame is intact", () => {
    const intact = "如果你是想自己做模组/插件，从哪一步开始。这里还有一段足够长的上下文，用来确认终态结果确实是同一份回复。";
    const corrupted = "如果你是想自己做模组/插件，从哪一步���始。这里还有一段足够长的上下文，用来确认终态结果确实是同一份回复。";
    const assistantFrame = JSON.stringify({
      type: "assistant",
      message: { id: "msg_utf8", role: "assistant", content: [{ type: "text", text: intact }] },
    });
    const resultFrame = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: corrupted,
    });
    const accumulator = new AgentStreamAccumulator("claude");

    assert.deepEqual(accumulator.update(assistantFrame), [{ kind: "text", text: intact }]);
    assert.deepEqual(accumulator.update(`${assistantFrame}\n${resultFrame}`), [
      { kind: "text", text: intact },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("uses the canonical full parse once a Claude result closes the transcript", () => {
    const streamed = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完整的中文回复。" } },
    });
    const assistant = JSON.stringify({
      type: "assistant",
      message: { id: "msg_terminal", role: "assistant", content: [{ type: "text", text: "完整的中文回复。" }] },
    });
    const result = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "完整的中文回复。",
    });
    const raw = `${streamed}\n${assistant}\n${result}`;
    const accumulator = new AgentStreamAccumulator("claude");

    accumulator.update(`${streamed}\n${assistant}`);
    assert.deepEqual(accumulator.update(raw), parseAgentStream("claude", raw));
  });

  it("keeps a Claude result-only reply that differs from the streamed text", () => {
    const turn = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Streamed prefix" } },
      }),
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "Streamed prefix" }] },
      }),
    ].join("\n");
    const resultFrame = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Streamed prefix — with the cloud-only suffix.",
    });
    const accumulator = new AgentStreamAccumulator("claude");
    accumulator.update(turn);

    assert.deepEqual(accumulator.update(`${turn}\n${resultFrame}`), [
      { kind: "text", text: "Streamed prefix" },
      { kind: "text", text: "Streamed prefix — with the cloud-only suffix." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("keeps identical text blocks in consecutive Claude result-only turns", () => {
    const turn = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Same answer." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Same answer." }),
    ].join("\n");

    assert.deepEqual(parseAgentStream("claude", `${turn}\n${turn}`), [
      { kind: "text", text: "Same answer." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
      { kind: "text", text: "Same answer." },
      { kind: "narration", key: "agent_stream.claude_finished", params: { tone: "good" } },
    ]);
  });

  it("preserves leading whitespace in Codex agent messages", () => {
    const raw = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "  indented first line\nsecond line" },
    });

    assert.deepEqual(parseAgentStream("codex", raw), [
      { kind: "text", text: "  indented first line\nsecond line" },
    ]);
  });

  it("preserves leading whitespace in Pi assistant messages", () => {
    const raw = JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "  indented first line" }] },
    });

    assert.deepEqual(parseAgentStream("pi", raw), [
      { kind: "text", text: "  indented first line" },
    ]);
  });

  it("preserves leading whitespace in Kimi assistant messages", () => {
    const raw = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "  indented first line" }],
    });

    assert.deepEqual(parseAgentStream("kimi", raw), [
      { kind: "text", text: "  indented first line" },
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
