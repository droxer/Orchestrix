import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFrameScheduler, type FrameSchedulerHost } from "../src/lib/frameScheduler.js";

type Pending = { id: number; callback: (time: number) => void };

function host(): FrameSchedulerHost & {
  frames: Pending[];
  timers: Pending[];
  runFrame: () => void;
  runTimer: () => void;
} {
  const frames: Pending[] = [];
  const timers: Pending[] = [];
  let nextId = 1;
  return {
    frames,
    timers,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) frames.splice(index, 1);
    },
    setTimeout(callback) {
      const id = nextId++;
      timers.push({ id, callback: () => callback() });
      return id;
    },
    clearTimeout(id) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    now: () => 1_000,
    runFrame() {
      const frame = frames.shift();
      frame?.callback(1_234);
    },
    runTimer() {
      const timer = timers.shift();
      timer?.callback(0);
    },
  };
}

describe("frameScheduler", () => {
  it("runs the callback on the animation frame and drops the fallback timer", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    const seen: number[] = [];

    schedule.request((time) => seen.push(time));
    environment.runFrame();

    assert.deepEqual(seen, [1_234]);
    assert.equal(environment.timers.length, 0, "the fallback timer must be cleared");
  });

  // A backgrounded tab, a minimized window, and an occluded window all stop
  // producing animation frames. Streamed agent output must still commit, or the
  // whole reply lands in one burst when the page finally repaints.
  it("runs the callback from the fallback timer when no frame ever arrives", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    const seen: number[] = [];

    schedule.request((time) => seen.push(time));
    environment.runTimer();

    assert.deepEqual(seen, [1_000]);
    assert.equal(environment.frames.length, 0, "the pending frame must be cancelled");
  });

  it("runs the callback once when a frame lands after the fallback fired", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    let calls = 0;

    schedule.request(() => {
      calls += 1;
    });
    environment.runTimer();
    environment.runFrame();

    assert.equal(calls, 1);
  });

  it("ignores a second request while one is already pending", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    let calls = 0;

    schedule.request(() => {
      calls += 1;
    });
    schedule.request(() => {
      calls += 1;
    });

    assert.equal(environment.frames.length, 1);
    environment.runFrame();
    assert.equal(calls, 1);
  });

  it("allows a new request after the previous one ran", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    let calls = 0;
    const bump = () => {
      calls += 1;
    };

    schedule.request(bump);
    environment.runFrame();
    schedule.request(bump);
    environment.runFrame();

    assert.equal(calls, 2);
  });

  it("cancels both the frame and the fallback timer", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);
    let calls = 0;

    schedule.request(() => {
      calls += 1;
    });
    schedule.cancel();

    assert.equal(environment.frames.length, 0);
    assert.equal(environment.timers.length, 0);
    environment.runFrame();
    environment.runTimer();
    assert.equal(calls, 0);
  });

  it("reports whether work is pending", () => {
    const environment = host();
    const schedule = createFrameScheduler(environment);

    assert.equal(schedule.pending(), false);
    schedule.request(() => undefined);
    assert.equal(schedule.pending(), true);
    environment.runFrame();
    assert.equal(schedule.pending(), false);
  });
});
