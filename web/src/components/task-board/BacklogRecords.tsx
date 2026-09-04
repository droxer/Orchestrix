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
import { taskResultLine } from "../../lib/taskResult";
import { RoutineOriginBadge } from "./RoutineOriginBadge";
import { taskRef } from "../../lib/taskRef";
import { TaskReference } from "./TaskReference";
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
import { TableCell, TableHead, TableRow } from "@/components/ui/table";

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
  routineTitle,
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
  starting,
  onToggleBlock,
  onDone,
}: {
  task: RelayTaskListItem;
  session?: RelaySession;
  /** Title of the routine this task was promoted from, when it was. */
  routineTitle?: string;
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
  starting: boolean;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);
  const startDisabled =
    (!task.assignedAgentId && !task.assignedTeamId && !canDiscuss) ||
    task.status === "running" ||
    task.status === "done";
  const result = taskResultLine(task, session);

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
        <RoutineOriginBadge task={task} routineTitle={routineTitle} />
        <TaskReference taskId={task.id} />
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
        {result ? (
          <>
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
            {/* The card carries no status text of its own, so the result names
                the outcome. The list row's dot already does, and so does not. */}
            <span className="backlog-result">
              <StateMark shape={TASK_STATUS_SHAPE[result.status]} />
              {t(`backlog.statuses.${result.status}`)}
            </span>
            {result.hasFiles ? (
              <>
                <span className="backlog-meta-sep" aria-hidden="true">·</span>
                <span className="backlog-result-files tnum">
                  {t("backlog.result_files", { count: result.fileCount })}
                </span>
              </>
            ) : null}
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
            loading={starting}
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
    <TableRow className="backlog-rows-head">
      <TableHead className="backlog-rows-head-cell backlog-rows-head-select">{selectAll}</TableHead>
      <TableHead className="backlog-rows-head-cell backlog-rows-head-dot" />
      <TableHead className="backlog-rows-head-cell backlog-rows-head-ref">{t("backlog.col_ref")}</TableHead>
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
      {/* Files come from the linked session, not the task record, so there is
          no task field to order rows by. */}
      <TableHead className="backlog-rows-head-cell backlog-rows-head-result">{t("backlog.col_result")}</TableHead>
      {/* Actions is not a column of data — there is nothing to order by. */}
      <TableHead className="backlog-rows-head-cell backlog-rows-head-actions">{t("backlog.actions")}</TableHead>
    </TableRow>
  );
}

export function BacklogTaskRow({
  task,
  session,
  routineTitle,
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
  starting,
  onToggleBlock,
  onDone,
}: {
  task: RelayTaskListItem;
  session?: RelaySession;
  /** Title of the routine this task was promoted from, when it was. */
  routineTitle?: string;
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
  starting: boolean;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);
  const result = taskResultLine(task, session);
  const startDisabled =
    (!task.assignedAgentId && !task.assignedTeamId && !canDiscuss) ||
    task.status === "running" ||
    task.status === "done";

  return (
    <TableRow render={<article />} className="backlog-row group list-virtual" data-status={task.status} data-priority={task.priority} data-selected={selected ? "true" : undefined}>
      <TableCell className="backlog-row-select-cell">
        <TaskSelectCheckbox
          className="backlog-select-box"
          checked={selected}
          label={t("backlog.select_task", { title: task.title })}
          onCheckedChange={onToggleSelect}
        />
      </TableCell>
      <span className="backlog-row-dot-cell" aria-hidden="true">
        <StateMark shape={TASK_STATUS_SHAPE[task.status]} />
      </span>
      <TableCell className="backlog-row-ref code">{taskRef(task.id)}</TableCell>
      <TableCell render={<div />} className="backlog-row-lead">
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
        <RoutineOriginBadge task={task} routineTitle={routineTitle} />
      </TableCell>
      <TableCell render={<div />} className="backlog-row-tags">
        <PriorityBadge priority={task.priority} />
      </TableCell>
      <TableCell className="backlog-row-due">
        <TaskDueCell
          date={task.dueDate}
          tone={tone}
          format={formatDueDate}
          emptyLabel={t("backlog.add_due")}
          onEdit={onEdit}
        />
      </TableCell>
      <TableCell className="backlog-row-assignee">
        <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} assigneeIsSelf={assigneeIsSelf} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} />
      </TableCell>
      <TableCell className="backlog-row-result">
        {/* The row's status dot already names the outcome; restating it here
            would spend a column on a fact the row has made twice. */}
        {result?.hasFiles ? (
          <span className="backlog-result-files tnum">
            {t("backlog.result_files", { count: result.fileCount })}
          </span>
        ) : null}
      </TableCell>
      <TableCell render={<div />} className="backlog-row-actions" aria-label={t("backlog.actions")}>
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
            loading={starting}
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
      </TableCell>
    </TableRow>
  );
}
