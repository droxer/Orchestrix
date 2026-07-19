import type { CSSProperties } from "react";
import type { RelayTask } from "../types";
import { AgentStateBadge } from "./AgentStateBadge";

/**
 * Identity chip for a task's assignee: a hue-derived monogram avatar, the
 * owning employee handle, and — optionally — the assigned agent glyph.
 *
 * The avatar hue is derived deterministically from the name so the same
 * person keeps a stable color across the app. Colors are mixed against theme
 * tokens (transparent tint, `--ink-1` text) so the chip adapts to light
 * and dark themes without hard-coded lightness.
 */

function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

export function TaskAssignee({
  task,
  ready,
  unassignedLabel,
  showAgent = true,
}: {
  task: RelayTask;
  ready: boolean;
  unassignedLabel: string;
  showAgent?: boolean;
}) {
  const employee = task.assigneeEmployeeId ?? task.ownerEmployeeId;
  const name = employee ?? unassignedLabel;

  return (
    <span className="task-assignee" translate="no" data-unassigned={employee ? "false" : "true"}>
      <span
        className="task-assignee-avatar"
        aria-hidden="true"
        style={{ "--avatar-hue": hueFor(name) } as CSSProperties}
      >
        {employee ? initialFor(name) : null}
      </span>
      <span className="task-assignee-name">@{name}</span>
      {showAgent ? <AgentStateBadge agent={task.assignedAgent} ready={ready} /> : null}
    </span>
  );
}
