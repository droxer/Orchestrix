import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { materializeTaskEvents, relayTaskEvent } from "../src/index.js";
import { LocalTaskStore } from "../src/task-store.js";

function tempStore(): LocalTaskStore {
  return new LocalTaskStore(mkdtempSync(join(tmpdir(), "relay-task-store-")));
}

describe("LocalTaskStore deletion", () => {
  it("hides deleted tasks from lists while keeping the event log readable", async () => {
    const store = tempStore();
    const task = await store.createTask({ title: "Delete me", description: "", priority: "normal" });

    const deleted = await store.deleteTask(task.id);
    assert.ok(deleted.deletedAt);
    assert.equal((await store.listTasks()).length, 0);

    const persisted = await store.getTask(task.id);
    assert.equal(persisted.deletedAt, deleted.deletedAt);
    assert.equal(persisted.events.filter((event) => event.type === "task.deleted").length, 1);
  });

  it("is idempotent and does not append a second task.deleted event", async () => {
    const store = tempStore();
    const task = await store.createTask({ title: "Delete me twice", description: "", priority: "normal" });

    const first = await store.deleteTask(task.id);
    const second = await store.deleteTask(task.id);

    assert.equal(second.deletedAt, first.deletedAt);
    assert.equal(second.events.filter((event) => event.type === "task.deleted").length, 1);
  });

  it("rematerializes deletedAt from the raw event log", async () => {
    const store = tempStore();
    const task = await store.createTask({ title: "Rematerialize", description: "", priority: "normal" });
    await store.deleteTask(task.id);

    const events = (await store.getTask(task.id)).events;
    const rebuilt = materializeTaskEvents(events);
    assert.ok(rebuilt.deletedAt);
  });
});

describe("task team assignment events", () => {
  it("materializes a team-only assignment and clears a prior agent assignment", async () => {
    const store = tempStore();
    const task = await store.createTask({ title: "Team task", description: "", priority: "normal" });
    const assigned = await store.assignTask(task.id, "codex", "agent-1");

    const rebuilt = materializeTaskEvents([
      ...assigned.events,
      relayTaskEvent("task.assigned", task.id, { teamId: "team-1" }),
    ]);

    assert.equal(rebuilt.assignedTeamId, "team-1");
    assert.equal(rebuilt.assignedAgent, undefined);
    assert.equal(rebuilt.assignedAgentId, undefined);
  });
});
