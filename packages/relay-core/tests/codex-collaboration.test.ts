import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CodexCollaborationStream } from "../src/codex-collaboration.js";
import { initialAgentState, runAgentNode } from "../src/index.js";

describe("CodexCollaborationStream", () => {
  it("normalizes app-server collaboration lifecycle notifications", () => {
    const stream = new CodexCollaborationStream();
    const events = stream.feed(`${JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "call-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "root-thread",
          receiverThreadIds: ["child-thread"],
          prompt: "Review the protocol",
          model: "gpt-5.4",
          reasoningEffort: "high",
          agentsStates: {
            "child-thread": { status: "running", message: "Inspecting events" },
          },
        },
      },
    })}\n`);

    assert.deepEqual(events, [{
      id: "call-1",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "root-thread",
      receiverThreadIds: ["child-thread"],
      prompt: "Review the protocol",
      model: "gpt-5.4",
      reasoningEffort: "high",
      agentsStates: {
        "child-thread": { status: "running", message: "Inspecting events" },
      },
    }]);
  });

  it("emits normalized collaboration events through the agent event seam", async () => {
    const collaborations: unknown[] = [];
    const jsonLine = JSON.stringify({
      type: "item.completed",
      item: {
        type: "collab_agent_tool_call",
        id: "call-2",
        tool: "wait",
        status: "completed",
        sender_thread_id: "root-thread",
        receiver_thread_ids: ["child-thread"],
        agents_states: { "child-thread": { status: "completed", message: "Done" } },
      },
    });

    await runAgentNode("codex", "action", initialAgentState("Coordinate work"), {
      runId: "run-1",
      eventSink: {
        agentOutput: () => undefined,
        agentCollaboration: (_runId, _agent, event) => { collaborations.push(event); },
      },
      execStream: async (_cmd, _args, options) => {
        options?.stdoutRenderer?.(`${jsonLine.slice(0, 40)}`);
        options?.stdoutRenderer?.(`${jsonLine.slice(40)}\n`);
        return { exit_code: 0, stdout: `${jsonLine}\n`, stderr: "" };
      },
    });

    assert.deepEqual(collaborations, [{
      id: "call-2",
      tool: "wait",
      status: "completed",
      senderThreadId: "root-thread",
      receiverThreadIds: ["child-thread"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { "child-thread": { status: "completed", message: "Done" } },
    }]);
  });

  it("normalizes the Codex 0.138 exec JSON collaboration shape", () => {
    const stream = new CodexCollaborationStream();
    const events = stream.feed(`${JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "collab_tool_call",
        tool: "spawn_agent",
        status: "completed",
        sender_thread_id: "root-thread",
        receiver_thread_ids: ["child-thread"],
        prompt: "",
        model: null,
        reasoning_effort: null,
        agents_states: {
          "child-thread": { status: "pending_init", message: null },
        },
      },
    })}\n`);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.tool, "spawnAgent");
    assert.deepEqual(events[0]?.receiverThreadIds, ["child-thread"]);
    assert.deepEqual(events[0]?.agentsStates, {
      "child-thread": { status: "pendingInit", message: null },
    });
  });
});
