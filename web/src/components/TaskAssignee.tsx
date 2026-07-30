import type { CSSProperties } from "react";
import type { LogicalAgentAvailability, RelayTask } from "../types";
import { cn } from "@/lib/utils";
import { AgentStateBadge } from "./AgentStateBadge";
import { IdentityMonogram } from "./IdentityMonogram";
import { identityHue } from "../lib/identity";
import { useTranslation } from "react-i18next";

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

export function TaskAssignee({
  task,
  ready,
  availability,
  unassignedLabel,
  assigneeDisplayName,
  agentDisplayName,
  showAgent = true,
  assigneeIsSelf = false,
}: {
  task: RelayTask;
  ready: boolean;
  availability?: LogicalAgentAvailability;
  unassignedLabel: string;
  assigneeDisplayName?: string;
  agentDisplayName?: string;
  showAgent?: boolean;
  /** On personal views, hide the employee chip when it's the viewer — the
   *  executor glyph carries the assignee instead. */
  assigneeIsSelf?: boolean;
}) {
  const assigned = Boolean(assigneeDisplayName);
  const name = assigneeDisplayName ?? unassignedLabel;

  return (
    <span className="task-assignee" translate="no" data-unassigned={assigned ? "false" : "true"}>
      {assigneeIsSelf ? null : (
        <>
          <span
            className="task-assignee-avatar"
            aria-hidden="true"
            style={{ "--avatar-hue": identityHue(name) } as CSSProperties}
          >
            {assigned ? initialFor(name) : null}
          </span>
          <span className="task-assignee-name">{name}</span>
        </>
      )}
      {showAgent ? <TaskExecutionBadge task={task} ready={ready} availability={availability} displayName={agentDisplayName} /> : null}
    </span>
  );
}

export function TaskExecutionBadge({
  task,
  ready,
  availability,
  displayName,
}: {
  task: RelayTask;
  ready: boolean;
  availability?: LogicalAgentAvailability;
  displayName?: string;
}) {
  const { t } = useTranslation();
  if (task.assignedTeamId) {
    const name = displayName ?? task.assignedTeamId;
    // Mirror AgentStateBadge: the team's default profile image (name monogram
    // on its identity hue) carries identity, the readiness pip carries status
    // (same tri-state mapping — busy = info, pending = warn, never collapsed
    // to bad while healthy), and the full label is sr-only text + tooltip so
    // cards stay scannable.
    const tone = availability
      ? availability === "ready"
        ? "tone-good"
        : availability === "offline"
          ? "tone-bad"
          : availability === "busy"
            ? "tone-info"
            : "tone-warn"
      : ready
        ? "tone-good"
        : "tone-bad";
    const stateLabel = availability
      ? t(`status.${availability}`, { defaultValue: availability })
      : ready
        ? t("backlog.ready")
        : t("backlog.not_ready");
    const label = `${t("teams.assignment_badge", { name })} · ${stateLabel}`;
    return (
      <span className={cn("agent-state", "agent-state--team", tone)} title={label}>
        <IdentityMonogram name={name} size={9} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return <AgentStateBadge agent={task.assignedAgent} ready={ready} availability={availability} name={displayName} />;
}
