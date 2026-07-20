import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LocalTaskStore, materializeTaskEvents } from "../src/index.js";

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
