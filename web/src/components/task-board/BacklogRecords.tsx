"use client";

import { type DragEvent, type ReactNode, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { PriorityBadge } from "../PriorityBadge";
import { cn } from "@/lib/utils";
import { type RelaySession, type RelayTaskListItem } from "../../types";
import {
  ActionApprove,
  ActionCalendar,
  ActionStart,
  ActionStop,
  ICON,
  NavAgents,
  NavRefresh,
} from "../icons";
import { dueTone } from "../../lib/backlog";
import { taskRef } from "../../lib/taskRef";
import { TaskAssignee, TaskExecutionBadge } from "../TaskAssignee";
import { Button } from "@/components/ui/button";
import { StateMark } from "../StateMark";
import { SortableColumnHeader } from "@/components/ui/SortableColumnHeader";
import type { SortState } from "../../lib/listSort";

/** The columns the backlog list can order by. Mirrors `backlogSortColumns`. */
export type BacklogSortKey = "title" | "status" | "priority" | "assignee" | "due";

import { TaskSelectCheckbox } from "./TaskSelection";
import { TASK_STATUS_SHAPE } from "./backlogVocabulary";
import { formatDueDate } from "./BacklogChrome";
import { TaskDueCell } from "./TaskDueCell";

/**
 * The two ways a task renders: as a card on the board and as a row in the
 * list. Split out of a 971-line BacklogPage.tsx.
 *
 * They live together because they are one record shown two ways — the same
 * status shape, the same assignee chip, the same due-date treatment — and
 * keeping them side by side is what stops the board and the list drifting
 * into two different vocabularies for one task.
 */

export function BacklogTaskCard({
  task,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  canDiscuss,
  selected,
  onToggleSelect,
  dragging,
  onDragStart,
  onDragEnd,
  onTouchStart,
  onEdit,
  onAssign,
  onStart,
  onToggleBlock,
  onDone,
}: {
  task: RelayTaskListItem;
  session?: RelaySession;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  canDiscuss: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onEdit: () => void;
  onAssign: () => void;
  onStart: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);
  const startDisabled =
    (!task.assignedAgentId && !task.assignedTeamId && !canDiscuss) ||
    task.status === "running" ||
    task.status === "done";

  return (
    <article
      className="backlog-task group list-virtual"
      data-priority={task.priority}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
    >
      <div className="backlog-task-badges">
        <TaskSelectCheckbox
          className="backlog-select-box"
          checked={selected}
          label={t("backlog.select_task", { title: task.title })}
          onCheckedChange={onToggleSelect}
        />
        <PriorityBadge priority={task.priority} />
        <TaskExecutionBadge task={task} ready={ready} displayName={agentDisplayName} />
      </div>
      <Button variant="ghost" type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</Button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        {assigneeIsSelf ? null : (
          <>
            <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} showAgent={false} />
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
          </>
        )}
        <span className={cn("backlog-due", tone !== "neutral" && tone)}>
          <ActionCalendar size={ICON.sm} />
          {task.dueDate ? formatDueDate(task.dueDate) : t("backlog.no_due")}
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
          <Button variant="outline"
            type="button"
            className="backlog-action-icon"
            onClick={onAssign}
            disabled={task.status === "running" || task.status === "done"}
            aria-label={t("backlog.assign_task")}
            title={t("backlog.assign_task")}
          >
            <NavAgents size={ICON.sm} />
          </Button>
          <Button variant={startDisabled ? "ghost" : "default"}
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={startDisabled}
            aria-label={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
            title={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={ICON.sm} />
          </Button>
        </div>
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="outline"
            type="button"
            className={task.status === "blocked" ? undefined : "backlog-action-block"}
            onClick={onToggleBlock}
          >
            {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          </Button>
          <Button variant="outline" type="button" className="backlog-action-done" onClick={onDone} disabled={task.status === "done"}>{t("backlog.done")}</Button>
        </div>
      </div>
    </article>
  );
}
/**
 * The column header row, repeated once per group.
 *
 * Repeated rather than hoisted above the whole list because a group band
 * interrupts the columns: a single sticky header six bands up stops naming
 * the row under the reader's eye. Each group is therefore its own
 * `role="table"` with its own header — the sort state is shared, so every
 * copy carries the same caret and clicking any of them reorders all groups.
 */
export function BacklogRowsHead({
  sort,
  onSort,
  selectAll,
}: {
  sort: SortState<BacklogSortKey> | null;
  onSort: (key: BacklogSortKey) => void;
  selectAll: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="backlog-rows-head" role="row">
      <span className="backlog-rows-head-cell backlog-rows-head-select" role="columnheader">{selectAll}</span>
      <span className="backlog-rows-head-cell backlog-rows-head-dot" role="columnheader" />
      <span className="backlog-rows-head-cell backlog-rows-head-ref" role="columnheader">{t("backlog.col_ref")}</span>
      <SortableColumnHeader
        className="backlog-rows-head-cell backlog-rows-head-lead"
        label={t("backlog.col_task")}
        sortKey="title"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        className="backlog-rows-head-cell backlog-rows-head-tags"
        label={t("backlog.priority")}
        sortKey="priority"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        className="backlog-rows-head-cell backlog-rows-head-due"
        label={t("backlog.due")}
        sortKey="due"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        className="backlog-rows-head-cell backlog-rows-head-assignee"
        label={t("backlog.assignee")}
        sortKey="assignee"
        sort={sort}
        onSort={onSort}
      />
      {/* Actions is not a column of data — there is nothing to order by. */}
      <span className="backlog-rows-head-cell backlog-rows-head-actions" role="columnheader">{t("backlog.actions")}</span>
    </div>
  );
}

export function BacklogTaskRow({
  task,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  canDiscuss,
  selected,
  onToggleSelect,
  onEdit,
  onAssign,
  onStart,
  onToggleBlock,
  onDone,
}: {
  task: RelayTaskListItem;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  canDiscuss: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onStart: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);
  const startDisabled =
    (!task.assignedAgentId && !task.assignedTeamId && !canDiscuss) ||
    task.status === "running" ||
    task.status === "done";

  return (
    <article className="backlog-row group list-virtual" role="row" data-status={task.status} data-priority={task.priority} data-selected={selected ? "true" : undefined}>
      <span className="backlog-row-select-cell" role="cell">
        <TaskSelectCheckbox
          className="backlog-select-box"
          checked={selected}
          label={t("backlog.select_task", { title: task.title })}
          onCheckedChange={onToggleSelect}
        />
      </span>
      <span className="backlog-row-dot-cell" aria-hidden="true">
        <StateMark shape={TASK_STATUS_SHAPE[task.status]} />
      </span>
      <span className="backlog-row-ref code" role="cell">{taskRef(task.id)}</span>
      <div className="backlog-row-lead" role="cell">
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
      </div>
      <div className="backlog-row-tags" role="cell">
        <PriorityBadge priority={task.priority} />
      </div>
      <span className="backlog-row-due" role="cell">
        <TaskDueCell
          date={task.dueDate}
          tone={tone}
          format={formatDueDate}
          emptyLabel={t("backlog.add_due")}
          onEdit={onEdit}
        />
      </span>
      <span className="backlog-row-assignee" role="cell">
        <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} assigneeIsSelf={assigneeIsSelf} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} />
      </span>
      <div className="backlog-row-actions" role="cell" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <Button variant="outline"
            type="button"
            className="backlog-action-icon"
            onClick={onAssign}
            disabled={task.status === "running" || task.status === "done"}
            aria-label={t("backlog.assign_task")}
            title={t("backlog.assign_task")}
          >
            <NavAgents size={ICON.sm} />
          </Button>
          <Button variant={startDisabled ? "ghost" : "default"}
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={startDisabled}
            aria-label={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
            title={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={ICON.sm} />
          </Button>
        </div>
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="outline"
            type="button"
            className={cn("backlog-action-icon", task.status !== "blocked" && "backlog-action-block")}
            onClick={onToggleBlock}
            aria-label={task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
            title={task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          >
            {task.status === "blocked" ? <NavRefresh size={ICON.sm} /> : <ActionStop size={ICON.sm} />}
          </Button>
          <Button variant="outline"
            type="button"
            className="backlog-action-icon backlog-action-done"
            onClick={onDone}
            disabled={task.status === "done"}
            aria-label={t("backlog.done")}
            title={t("backlog.done")}
          >
            <ActionApprove size={ICON.sm} />
          </Button>
        </div>
      </div>
    </article>
  );
}
