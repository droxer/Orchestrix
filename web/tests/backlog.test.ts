import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentReadyForTask, dueTone, filterTasks, tasksByStatus, type BacklogFilters } from "../src/lib/backlog.js";
import type { DaemonNodeMonitorRecord, RelayTask } from "../src/types.js";

const baseFilters: BacklogFilters = {
  query: "",
  status: "all",
  priority: "all",
  agent: "all",
  assignee: "",
  due: "all",
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

function node(input: Partial<DaemonNodeMonitorRecord> & { id: string }): DaemonNodeMonitorRecord {
  return {
    id: input.id,
    employeeId: input.employeeId ?? "alice",
    status: input.status ?? "ready",
    online: input.online ?? true,
    agents: input.agents ?? { claude: "ready", pi: "ready", codex: "ready", kimi: "ready" },
    disabledAgents: input.disabledAgents,
    activeRuns: input.activeRuns ?? [],
    queuedCommandCount: input.queuedCommandCount ?? 0,
  } as DaemonNodeMonitorRecord;
}

describe("filterTasks", () => {
  it("filters by status priority agent assignee and due state", () => {
    const tasks = [
      task({ id: "a", title: "Ship board", status: "assigned", priority: "high", assignedAgent: "codex", assigneeEmployeeId: "alice", dueDate: "2026-06-20" }),
      task({ id: "b", title: "Polish copy", status: "backlog", priority: "low", assignedAgent: "claude", assigneeEmployeeId: "bob", dueDate: "2026-06-26" }),
    ];

    const result = filterTasks(tasks, {
      ...baseFilters,
      query: "ship",
      status: "assigned",
      priority: "high",
      agent: "codex",
      assignee: "ali",
      due: "overdue",
    }, "2026-06-24");

    assert.deepEqual(result.map((item) => item.id), ["a"]);
  });

  it("groups every task status", () => {
    const grouped = tasksByStatus([
      task({ id: "a", title: "A", status: "backlog" }),
      task({ id: "b", title: "B", status: "done" }),
    ]);

    assert.equal(grouped.backlog.length, 1);
    assert.equal(grouped.done.length, 1);
    assert.equal(grouped.running.length, 0);
  });
});

describe("agentReadyForTask", () => {
  it("requires matching employee, ready node, enabled agent, and ready agent health", () => {
    const backlogTask = task({ id: "a", title: "A", assignedAgent: "codex", assigneeEmployeeId: "alice" });

    assert.equal(agentReadyForTask(backlogTask, [node({ id: "n1", employeeId: "alice" })]), true);
    assert.equal(agentReadyForTask(backlogTask, [node({ id: "n2", employeeId: "bob" })]), false);
    assert.equal(agentReadyForTask(backlogTask, [node({ id: "n3", employeeId: "alice", disabledAgents: ["codex"] })]), false);
  });
});

describe("dueTone", () => {
  it("marks overdue and today due dates", () => {
    assert.equal(dueTone(task({ id: "a", title: "A", dueDate: "2026-06-23" }), "2026-06-24"), "bad");
    assert.equal(dueTone(task({ id: "b", title: "B", dueDate: "2026-06-24" }), "2026-06-24"), "warn");
    assert.equal(dueTone(task({ id: "c", title: "C", dueDate: "2026-06-23", status: "done" }), "2026-06-24"), "neutral");
  });
});
