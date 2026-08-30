"use client";

import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionCalendar, ActionStart, ICON, NavAgents } from "../icons";
import { PriorityBadge } from "../PriorityBadge";
import { StateMark } from "../StateMark";
import { ROUTINE_STATE_SHAPE, RoutineStateBadge } from "../RoutineStateBadge";
import { TaskAssignee, TaskExecutionBadge } from "../TaskAssignee";
import { TaskSelectCheckbox } from "./TaskSelection";
import { formatNextRunDate } from "./RoutineChrome";
import { routineDueTone, type RoutineState } from "../../lib/routine";
import { hrefForRoute } from "../../lib/appRoute";
import type { RelaySession, RelayTaskListItem } from "../../types";

/* One routine, drawn three ways: the board card, the list row, and the meta
   header inside its drawer. Card and row are deliberately the same record in
   two densities — keep their badge order and action group in step. */

export function RoutineStartButton({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      variant="icon"
      size="icon-sm"
      tinted
      type="button"
      className="backlog-action-icon"
      onClick={onStart}
      disabled={disabled}
      aria-label={t("backlog.start")}
      title={t("backlog.start")}
    >
      <ActionStart size={ICON.sm} />
    </Button>
  );
}

export function RoutineAssignButton({ onAssign }: { onAssign: () => void }) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      type="button"
      className="backlog-action-icon"
      onClick={onAssign}
      aria-label={t("backlog.assign_task")}
      title={t("backlog.assign_task")}
    >
      <NavAgents size={ICON.sm} />
    </Button>
  );
}

export function RoutineCard({
  task,
  state,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  selected,
  onToggleSelect,
  onEdit,
  onAssign,
  onStart,
}: {
  task: RelayTaskListItem;
  state: RoutineState;
  session?: RelaySession;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);
  const startDisabled = (!task.assignedAgentId && !task.assignedTeamId) || !task.routineEnabled;

  // `data-routine-state`, not `data-status`: a routine definition never moves
  // through the board, so its `status` field is a constant and styling on it
  // paints every card the same.
  return (
    <article className="routine-card backlog-task list-virtual" data-priority={task.priority} data-routine-state={state} data-selected={selected ? "true" : undefined}>
      <div className="backlog-task-badges">
        <TaskSelectCheckbox
          className="backlog-select-box"
          checked={selected}
          label={t("routine.select_routine", { title: task.title })}
          onCheckedChange={onToggleSelect}
        />
        <RoutineStateBadge state={state} />
        <PriorityBadge priority={task.priority} />
        <TaskExecutionBadge task={task} ready={ready} displayName={agentDisplayName} />
      </div>
      <Button variant="ghost" type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</Button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        <span>{t(`routine.types.${task.routineType ?? "task"}`)} · {t(`routine.cadences.${task.routineCadence ?? "weekly"}`)}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        {assigneeIsSelf ? null : (
          <>
            <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} showAgent={false} />
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
          </>
        )}
        <span className={cn("backlog-due", tone !== "neutral" && tone)}>
          <ActionCalendar size={ICON.sm} />
          {task.routineNextRunDate ? formatNextRunDate(task.routineNextRunDate) : t("routine.no_next_run")}
        </span>
        {session ? (
          <>
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
            <span>{t("backlog.linked")}</span>
          </>
        ) : null}
      </div>
      <div className="backlog-task-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <RoutineAssignButton onAssign={onAssign} />
          <RoutineStartButton disabled={startDisabled} onStart={onStart} />
        </div>
      </div>
    </article>
  );
}

export function RoutineRow({
  task,
  state,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  selected,
  onToggleSelect,
  onEdit,
  onAssign,
  onStart,
}: {
  task: RelayTaskListItem;
  state: RoutineState;
  session?: RelaySession;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);
  const startDisabled = (!task.assignedAgentId && !task.assignedTeamId) || !task.routineEnabled;

  return (
    <article className="backlog-row group list-virtual" role="row" data-routine-state={state} data-priority={task.priority} data-selected={selected ? "true" : undefined}>
      <span className="backlog-row-select-cell" role="cell">
        <TaskSelectCheckbox
          className="backlog-select-box"
          checked={selected}
          label={t("routine.select_routine", { title: task.title })}
          onCheckedChange={onToggleSelect}
        />
      </span>
      <span className="backlog-row-dot-cell" aria-hidden="true">
        <StateMark shape={ROUTINE_STATE_SHAPE[state]} />
      </span>
      <div className="backlog-row-lead" role="cell">
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
      </div>
      <span className="backlog-row-status" role="cell">{t(`routine.states.${state}`)}</span>
      <div className="backlog-row-tags" role="cell">
        <PriorityBadge priority={task.priority} />
      </div>
      <span className="backlog-row-assignee" role="cell">
        <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} assigneeIsSelf={assigneeIsSelf} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} />
      </span>
      <span className={cn("backlog-row-due", tone !== "neutral" && tone)} role="cell">
        <ActionCalendar size={ICON.sm} />
        {task.routineNextRunDate ? formatNextRunDate(task.routineNextRunDate) : t("routine.no_next_run")}
      </span>
      <div className="backlog-row-actions" role="cell" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <RoutineAssignButton onAssign={onAssign} />
          <RoutineStartButton disabled={startDisabled} onStart={onStart} />
        </div>
      </div>
    </article>
  );
}

export function RoutineDrawerMeta({
  task,
  state,
  session,
  onOpenThread,
}: {
  task: RelayTaskListItem;
  state: RoutineState;
  session?: RelaySession;
  onOpenThread: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const lastActivity = task.lastActivity;

  return (
    <section className="task-drawer-meta" aria-label={t("routine.meta")}>
      <div className="task-drawer-meta-row">
        <RoutineStateBadge state={state} />
        {session ? (
          <a
            data-slot="link-button"
            href={hrefForRoute("main", session.id)}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onOpenThread(session.id);
            }}
          >
            {t("backlog.open_thread")}
          </a>
        ) : null}
      </div>
      <p className="task-drawer-meta-activity">
        {lastActivity ? lastActivity.message : t("routine.no_activity")}
      </p>
    </section>
  );
}
