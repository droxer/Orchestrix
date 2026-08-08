import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTaskCreateIntentChannel, TASK_CREATE_INTENT_EVENT } from "../src/lib/taskCreateIntent.js";

describe("task create intent channel", () => {
  it("delivers the event to a mounted listener and clears the flag", () => {
    const channel = createTaskCreateIntentChannel(new EventTarget());
    let fired = 0;
    const unsubscribe = channel.subscribe(() => {
      fired += 1;
      assert.equal(channel.consume(), true, "listener sees the pending intent");
    });
    channel.queue();
    assert.equal(fired, 1);
    assert.equal(channel.consume(), false, "the intent was consumed exactly once");
    unsubscribe();
  });

  it("keeps the intent for a consumer that mounts after the event", () => {
    // The cross-route path: `c` pressed outside the backlog queues the intent
    // before navigation mounts the page that will consume it.
    const channel = createTaskCreateIntentChannel(new EventTarget());
    channel.queue();
    channel.queue();
    assert.equal(channel.consume(), true);
    assert.equal(channel.consume(), false, "two queues still consume once");
  });

  it("stops notifying after unsubscribe", () => {
    const target = new EventTarget();
    const channel = createTaskCreateIntentChannel(target);
    let fired = 0;
    const unsubscribe = channel.subscribe(() => { fired += 1; });
    unsubscribe();
    channel.queue();
    assert.equal(fired, 0);
    // …but the flag is still there for a later mount.
    assert.equal(channel.consume(), true);
  });

  it("exposes a stable event name", () => {
    assert.equal(TASK_CREATE_INTENT_EVENT, "relay:task-create-intent");
  });
});
