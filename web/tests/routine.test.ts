import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterRoutineTasks, routineDueTone, type RoutineFilters } from "../src/lib/routine.js";
import type { RelayTask } from "../src/types.js";

const baseFilters: RoutineFilters = {
  query: "",
  type: "all",
  cadence: "all",
  agent: "all",
  assignee: "",
  state: "all",
};

function task(input: Partial<RelayTask> & { id: string; title: string }): RelayTask {
  return {
    id: input.id,
    title: input.title,
    description: input.description ?? "",
    priority: input.priority ?? "normal",
    status: input.status ?? "backlog",
    ownerEmployeeId: input.ownerEmployeeId ?? "alice",
    assigneeEmployeeId: input.assigneeEmployeeId,
    dueDate: input.dueDate,
    isRoutine: input.isRoutine ?? false,
    routineType: input.routineType,
    routineCadence: input.routineCadence,
    routineNextRunDate: input.routineNextRunDate,
    routineEnabled: input.routineEnabled ?? false,
    assignedAgent: input.assignedAgent,
    linkedSessionIds: input.linkedSessionIds ?? [],
    activity: input.activity ?? [],
    createdAt: input.createdAt ?? "2026-06-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-01T00:00:00.000Z",
    events: input.events ?? [],
  } as RelayTask;
}

describe("filterRoutineTasks", () => {
  it("keeps only routine tasks and filters by routine metadata", () => {
    const tasks = [
      task({ id: "a", title: "Daily health check", isRoutine: true, routineType: "job", routineCadence: "daily", routineEnabled: true, routineNextRunDate: "2026-06-24", assignedAgent: "codex", assigneeEmployeeId: "alice" }),
      task({ id: "b", title: "Weekly report", isRoutine: true, routineType: "task", routineCadence: "weekly", routineEnabled: true, routineNextRunDate: "2026-06-30", assignedAgent: "claude", assigneeEmployeeId: "bob" }),
      task({ id: "c", title: "Plain backlog item", isRoutine: false, assignedAgent: "codex", assigneeEmployeeId: "alice" }),
    ];

    const result = filterRoutineTasks(tasks, {
      ...baseFilters,
      query: "health",
      type: "job",
      cadence: "daily",
      agent: "codex",
      assignee: "ali",
      state: "due",
    }, "2026-06-24");

    assert.deepEqual(result.map((item) => item.id), ["a"]);
  });
});

describe("routineDueTone", () => {
  it("uses routine next-run dates and ignores disabled or done routines", () => {
    assert.equal(routineDueTone(task({ id: "a", title: "A", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-23" }), "2026-06-24"), "bad");
    assert.equal(routineDueTone(task({ id: "b", title: "B", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-24" }), "2026-06-24"), "warn");
    assert.equal(routineDueTone(task({ id: "c", title: "C", isRoutine: true, routineEnabled: false, routineNextRunDate: "2026-06-23" }), "2026-06-24"), "neutral");
    assert.equal(routineDueTone(task({ id: "d", title: "D", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-23", status: "done" }), "2026-06-24"), "neutral");
  });
});
