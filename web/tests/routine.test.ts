import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterRoutineTasks, latestRoutineSession, routineDueTone, type RoutineFilters } from "../src/lib/routine.js";
import type { RelaySession, RelayTask } from "../src/types.js";

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
    assignedAgentId: input.assignedAgentId,
    sourceRoutineId: input.sourceRoutineId,
    scheduledFor: input.scheduledFor,
    occurrenceIds: input.occurrenceIds,
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
      task({ id: "a", title: "Daily health check", isRoutine: true, routineType: "job", routineCadence: "daily", routineEnabled: true, routineNextRunDate: "2026-06-24", assignedAgent: "codex", assignedAgentId: "agent_health", assigneeEmployeeId: "alice" }),
      task({ id: "b", title: "Weekly report", isRoutine: true, routineType: "task", routineCadence: "weekly", routineEnabled: true, routineNextRunDate: "2026-06-30", assignedAgent: "claude", assigneeEmployeeId: "bob" }),
      task({ id: "c", title: "Plain backlog item", isRoutine: false, assignedAgent: "codex", assigneeEmployeeId: "alice" }),
    ];

    const result = filterRoutineTasks(tasks, {
      ...baseFilters,
      query: "health",
      type: "job",
      cadence: "daily",
      agent: "agent_health",
      assignee: "ali",
      state: "due",
    }, "2026-06-24");

    assert.deepEqual(result.map((item) => item.id), ["a"]);
  });
});

describe("latestRoutineSession", () => {
  it("opens the newest automatically scheduled occurrence session through structured lineage", () => {
    const routine = task({
      id: "routine-a",
      title: "Daily check",
      isRoutine: true,
      occurrenceIds: ["occurrence-old", "occurrence-new"],
    });
    const tasks = [
      routine,
      task({ id: "occurrence-new", title: "New", sourceRoutineId: routine.id, scheduledFor: "2026-07-21", linkedSessionIds: ["session-new"] }),
      task({ id: "occurrence-old", title: "Old", sourceRoutineId: routine.id, scheduledFor: "2026-07-20", linkedSessionIds: ["session-old"] }),
    ];
    const sessions = [
      { id: "session-old" } as RelaySession,
      { id: "session-new" } as RelaySession,
    ];

    assert.equal(latestRoutineSession(routine, tasks, sessions)?.id, "session-new");
  });
});

describe("routineDueTone", () => {
  it("uses enabled state and next-run dates independently from backlog status", () => {
    assert.equal(routineDueTone(task({ id: "a", title: "A", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-23" }), "2026-06-24"), "bad");
    assert.equal(routineDueTone(task({ id: "b", title: "B", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-24" }), "2026-06-24"), "warn");
    assert.equal(routineDueTone(task({ id: "c", title: "C", isRoutine: true, routineEnabled: false, routineNextRunDate: "2026-06-23" }), "2026-06-24"), "neutral");
    assert.equal(routineDueTone(task({ id: "d", title: "D", isRoutine: true, routineEnabled: true, routineNextRunDate: "2026-06-23", status: "done" }), "2026-06-24"), "bad");
  });
});
