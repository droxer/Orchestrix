import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addressableThreadAgents,
  teamRosterForThread,
} from "../src/lib/threadRuntime.js";

const agent = (id: string, deletedAt?: string) => ({ id, displayName: id, ...(deletedAt ? { deletedAt } : {}) });

describe("addressable thread agents", () => {
  const agents = [agent("builder"), agent("lead"), agent("stranger"), agent("gone", "2026-01-01")];

  it("keeps every agent when the thread has no roster", () => {
    assert.deepEqual(
      addressableThreadAgents(agents, null).map((item) => item.id),
      ["builder", "lead", "stranger", "gone"],
    );
  });

  it("narrows a roster thread to its members, lead first", () => {
    assert.deepEqual(
      addressableThreadAgents(agents, {
        leadAgentId: "lead",
        memberAgentIds: ["builder", "lead"],
      }).map((item) => item.id),
      ["lead", "builder"],
    );
  });

  it("drops roster ids the agent list cannot name", () => {
    assert.deepEqual(
      addressableThreadAgents(agents, {
        leadAgentId: "lead",
        memberAgentIds: ["lead", "gone", "vanished"],
      }).map((item) => item.id),
      ["lead"],
    );
  });

  it("offers no targets while a team roster is unavailable", () => {
    const roster = teamRosterForThread("deleted-team", []);

    assert.deepEqual(
      addressableThreadAgents(agents, roster).map((item) => item.id),
      [],
    );
  });

  it("orders members even without a lead", () => {
    assert.deepEqual(
      addressableThreadAgents(agents, {
        leadAgentId: null,
        memberAgentIds: ["stranger", "builder"],
      }).map((item) => item.id),
      ["stranger", "builder"],
    );
  });
});
