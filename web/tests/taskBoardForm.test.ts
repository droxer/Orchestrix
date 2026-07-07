import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyBacklogForm,
  emptyRoutineForm,
  taskBoardFormsEqual,
  type BacklogTaskFormState,
  type RoutineTaskFormState,
} from "../src/lib/taskBoardForm.js";
import { hashForAppState, parseAppHash } from "../src/lib/appRoute.js";

describe("taskBoardForm", () => {
  const user = { id: "user-alice", username: "alice", employeeId: "alice", role: "user" as const };

  it("detects equal backlog forms", () => {
    const a = emptyBacklogForm(user);
    const b = { ...a, title: "Ship backlog polish" };
    assert.equal(taskBoardFormsEqual(a, a), true);
    assert.equal(taskBoardFormsEqual(a, b), false);
  });

  it("detects equal routine forms", () => {
    const a = emptyRoutineForm(user, new Date(2026, 6, 7, 9));
    const b: RoutineTaskFormState = { ...a, routineEnabled: false };
    assert.equal(a.routineNextRunDate, "2026-07-07");
    assert.equal(taskBoardFormsEqual(a, a), true);
    assert.equal(taskBoardFormsEqual(a, b), false);
  });

  it("rejects mixed variants", () => {
    const backlog: BacklogTaskFormState = emptyBacklogForm(user);
    const routine: RoutineTaskFormState = emptyRoutineForm(user);
    assert.equal(taskBoardFormsEqual(backlog, routine), false);
  });
});

describe("appRoute hash parsing", () => {
  it("maps work routes and chat sessions", () => {
    assert.deepEqual(parseAppHash("#/backlog"), {
      route: "backlog",
      mobileView: "chat",
      sessionId: null,
    });
    assert.deepEqual(parseAppHash("#/chat/sess-1"), {
      route: "main",
      mobileView: "chat",
      sessionId: "sess-1",
    });
    assert.equal(hashForAppState({ route: "routine", mobileView: "chat", sessionId: null }), "#/routine");
  });
});
