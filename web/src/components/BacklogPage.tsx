"use client";

import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useTeams } from "../hooks/useTeams";
import { useDialogs } from "@/components/ui/DialogProvider";
import { PriorityBadge } from "./PriorityBadge";
import { cn } from "@/lib/utils";
import { type CurrentUser, type DaemonNodeMonitorRecord, type EmployeeAgent, type RelaySession, type RelayTaskListItem, type TaskStatus } from "../types";
import { ActionApprove, ActionCalendar, ActionStart, ActionStop, NavRefresh, ViewBoard, ViewList } from "./icons";
import { agentReadyForTask, canDiscussTask, discussionAgentsForTask, dueTone, filterTasks, isTaskStatus, TASK_PRIORITIES, TASK_STATUSES, tasksByStatus, type BacklogFilters } from "../lib/backlog";
import { readDraggedTaskId, TASK_DRAG_MEDIA_TYPE, taskDropRejection } from "../lib/taskDrag";
import { emptyBacklogForm, taskAssignmentMutationFields, taskBoardFormsEqual, type BacklogTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";
import { TaskAssignee, TaskExecutionBadge } from "./TaskAssignee";
import { isTaskAssigneeCurrentUser, taskAssigneeDisplayName, teamReady } from "../lib/taskAssignment";
import { useEmployeeNames } from "../hooks/useEmployeeNames";
import { useEdgeAutoScroll } from "../hooks/useEdgeAutoScroll";
import { useTouchTaskDrag } from "../hooks/useTouchTaskDrag";
import { laneStatusAtPoint, type DragPoint } from "../lib/touchDrag";
import { readViewPreference, writeViewPreference } from "../lib/viewPreference";
import { Button } from "./ui/button";
import { FiltersBar, FilterSelect } from "./FiltersBar";
import { Input } from "./ui/input";
import { StateMark, type StateShape } from "./StateMark";

/**
 * Lifecycle status in the shared shape vocabulary (see StateMark). The row
 * rail and the status column read the same accent, so the 8px mark at the far
 * left and the word 150px away are no longer two unrelated signals.
 */
const TASK_STATUS_SHAPE: Record<TaskStatus, StateShape> = {
  backlog: "dashed",
  assigned: "solid",
  running: "live",
  waiting_for_human: "solid",
  review: "solid",
  blocked: "ring",
  done: "muted",
};

interface BacklogPageProps {
  tasks: RelayTaskListItem[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
}

const initialFilters: BacklogFilters = {
  query: "",
  status: "all",
  priority: "all",
  agent: "all",
  assignee: "",
  due: "all",
};

type BacklogView = "board" | "list";

const VIEW_STORAGE_KEY = "relay-web.backlogView";
const BACKLOG_VIEWS: readonly BacklogView[] = ["board", "list"];

function parseBacklogView(value: string | null): BacklogView {
  return BACKLOG_VIEWS.includes(value as BacklogView)
    ? value as BacklogView
    : readViewPreference(VIEW_STORAGE_KEY, "board", BACKLOG_VIEWS);
}

const ACTIVE_STATUSES: TaskStatus[] = ["assigned", "running", "waiting_for_human", "review"];

// Half the drag chip's max width. The chip is centred on the finger and sits
// above it, so its centre has to stay this far from either screen edge — the
// right edge is exactly where a drag lingers to auto-scroll the board.
const DRAG_GHOST_HALF_WIDTH_PX = 104;

function dragGhostStyle(point: DragPoint): CSSProperties {
  const rightLimit = typeof window === "undefined"
    ? point.x
    : Math.max(window.innerWidth - DRAG_GHOST_HALF_WIDTH_PX, DRAG_GHOST_HALF_WIDTH_PX);
  const x = Math.min(Math.max(point.x, DRAG_GHOST_HALF_WIDTH_PX), rightLimit);
  return { transform: `translate3d(calc(${x}px - 50%), calc(${point.y}px - 220%), 0)` };
}

function activeFilterCount(filters: BacklogFilters): number {
  let count = 0;
  if (filters.status !== "all") count += 1;
  if (filters.priority !== "all") count += 1;
  if (filters.agent !== "all") count += 1;
  if (filters.assignee.trim()) count += 1;
  if (filters.due !== "all") count += 1;
  return count;
}

function BacklogStats({ tasks }: { tasks: RelayTaskListItem[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const active = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    const overdue = tasks.filter((task) => dueTone(task) === "bad").length;
    return { total: tasks.length, active, blocked, overdue };
  }, [tasks]);

  return (
    <p className="backlog-stats" aria-label={t("backlog.metrics")}>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_active")}</span>
        <span className="backlog-stat-value tone-active">{stats.active}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_blocked")}</span>
        <span className={cn("backlog-stat-value", stats.blocked > 0 && "tone-blocked")}>{stats.blocked}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_overdue")}</span>
        <span className={cn("backlog-stat-value", stats.overdue > 0 && "tone-overdue")}>{stats.overdue}</span>
      </span>
    </p>
  );
}

function formatDueDate(value: string): string {
  // Date-only values ("2026-07-19") parse as UTC midnight; construct a local
  // date so the rendered day does not shift with the viewer's timezone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function BacklogFiltersBar({
  filters,
  agents,
  onChange,
}: {
  filters: BacklogFilters;
  agents: EmployeeAgent[];
  onChange: (next: BacklogFilters) => void;
}) {
  const { t } = useTranslation();

  return (
    <FiltersBar
      ariaLabel={t("backlog.filters")}
      searchName="backlog-query"
      searchLabel={t("backlog.search")}
      query={filters.query}
      onQueryChange={(query) => onChange({ ...filters, query })}
      activeCount={activeFilterCount(filters)}
      onClear={() => onChange(initialFilters)}
    >
      <FilterSelect
        name="backlog-status-filter"
        label={t("backlog.status")}
        value={filters.status}
        onValueChange={(status) => onChange({ ...filters, status })}
        options={[
          { value: "all" as const, label: t("backlog.all_statuses") },
          ...TASK_STATUSES.map((status) => ({
            value: status,
            label: t(`backlog.statuses.${status}`),
          })),
        ]}
      />
      <FilterSelect
        name="backlog-priority-filter"
        label={t("backlog.priority")}
        value={filters.priority}
        onValueChange={(priority) => onChange({ ...filters, priority })}
        options={[
          { value: "all" as const, label: t("backlog.all_priorities") },
          ...TASK_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(`backlog.priorities.${priority}`),
          })),
        ]}
      />
      <FilterSelect
        name="backlog-agent-filter"
        label={t("backlog.agent")}
        value={filters.agent}
        onValueChange={(agent) => onChange({ ...filters, agent })}
        options={[
          { value: "all", label: t("backlog.all_agents") },
          ...agents.map((agent) => ({ value: agent.id, label: agent.displayName })),
        ]}
      />
      <Input
        name="backlog-assignee-filter"
        autoComplete="off"
        spellCheck={false}
        value={filters.assignee}
        placeholder={t("backlog.assignee_filter")}
        aria-label={t("backlog.assignee_filter")}
        onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
      />
      <FilterSelect
        name="backlog-due-filter"
        label={t("backlog.due")}
        value={filters.due}
        onValueChange={(due) => onChange({ ...filters, due })}
        options={[
          { value: "all", label: t("backlog.all_due") },
          { value: "overdue", label: t("backlog.overdue") },
          { value: "today", label: t("backlog.today") },
          { value: "unscheduled", label: t("backlog.unscheduled") },
        ]}
      />
    </FiltersBar>
  );
}

function BacklogTaskCard({
  task,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  canDiscuss,
  dragging,
  onDragStart,
  onDragEnd,
  onTouchStart,
  onEdit,
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
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onEdit: () => void;
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
      data-dragging={dragging ? "true" : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
    >
      <div className="backlog-task-badges">
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
          <ActionCalendar size={13} />
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
          <Button variant={startDisabled ? "ghost" : "default"}
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={startDisabled}
            aria-label={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
            title={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </Button>
        </div>
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="ghost"
            type="button"
            className={task.status === "blocked" ? undefined : "backlog-action-block"}
            onClick={onToggleBlock}
          >
            {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          </Button>
          <Button variant="ghost" type="button" className="backlog-action-done" onClick={onDone} disabled={task.status === "done"}>{t("backlog.done")}</Button>
        </div>
      </div>
    </article>
  );
}

function BacklogViewToggle({ view, onChange }: { view: BacklogView; onChange: (view: BacklogView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle" role="group" aria-label={t("backlog.view")}>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "board" ? "true" : "false"}
        aria-pressed={view === "board"}
        aria-label={t("backlog.view_board")}
        title={t("backlog.view_board")}
        onClick={() => onChange("board")}
      >
        <ViewBoard size={15} />
      </Button>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "list" ? "true" : "false"}
        aria-pressed={view === "list"}
        aria-label={t("backlog.view_list")}
        title={t("backlog.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={15} />
      </Button>
    </div>
  );
}

function BacklogTaskRow({
  task,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  canDiscuss,
  onEdit,
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
  onEdit: () => void;
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
    <article className="backlog-row group list-virtual" role="row" data-status={task.status} data-priority={task.priority}>
      <span className="backlog-row-dot-cell" aria-hidden="true">
        <StateMark shape={TASK_STATUS_SHAPE[task.status]} />
      </span>
      <div className="backlog-row-lead" role="cell">
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
      </div>
      <span className="backlog-row-status" role="cell">{t(`backlog.statuses.${task.status}`)}</span>
      <div className="backlog-row-tags" role="cell">
        <PriorityBadge priority={task.priority} />
      </div>
      <span className="backlog-row-assignee" role="cell">
        <TaskAssignee task={task} ready={ready} assigneeDisplayName={assigneeDisplayName} assigneeIsSelf={assigneeIsSelf} agentDisplayName={agentDisplayName} unassignedLabel={t("backlog.unassigned")} />
      </span>
      <span className={cn("backlog-row-due", tone !== "neutral" && tone)} role="cell">
        <ActionCalendar size={13} />
        {task.dueDate ? formatDueDate(task.dueDate) : t("backlog.no_due")}
      </span>
      <div className="backlog-row-actions" role="cell" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <Button variant={startDisabled ? "ghost" : "default"}
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={startDisabled}
            aria-label={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
            title={(task.assignedAgentId || task.assignedTeamId) ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </Button>
        </div>
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="ghost"
            type="button"
            className={cn("backlog-action-icon", task.status !== "blocked" && "backlog-action-block")}
            onClick={onToggleBlock}
            aria-label={task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
            title={task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          >
            {task.status === "blocked" ? <NavRefresh size={14} /> : <ActionStop size={14} />}
          </Button>
          <Button variant="ghost"
            type="button"
            className="backlog-action-icon backlog-action-done"
            onClick={onDone}
            disabled={task.status === "done"}
            aria-label={t("backlog.done")}
            title={t("backlog.done")}
          >
            <ActionApprove size={14} />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function BacklogPage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenThread }: BacklogPageProps) {
  const { agents: logicalAgents } = useEmployeeAgents(currentUser.employeeId);
  const { teams } = useTeams(currentUser.employeeId);
  const employeeNames = useEmployeeNames(currentUser);
  const { t } = useTranslation();
  const { announce, confirm } = useDialogs();
  const {
    startTaskMutation,
    updateTaskMutation,
    createTaskMutation,
    deleteTaskMutation,
  } = useRelayMutations();
  const [filters, setFilters] = useState(initialFilters);
  const [view, setView] = useState<BacklogView>(() => parseBacklogView(null));
  const [form, setForm] = useState<BacklogTaskFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<BacklogTaskFormState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<TaskStatus | null>(null);
  const { track: trackBoardEdge, stop: stopBoardScroll } = useEdgeAutoScroll();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const touchDrag = useTouchTaskDrag({
    onStart: (taskId) => setDraggedTaskId(taskId),
    onMove: (point) => {
      if (boardRef.current) trackBoardEdge(boardRef.current, point.x);
      const status = laneStatusAtPoint(document, point);
      setDropLane(isTaskStatus(status) ? status : null);
    },
    onDrop: () => {
      moveTaskToLane(draggedTaskId, dropLane);
      endTaskDrag();
    },
    onCancel: endTaskDrag,
  });
  const formDirty = Boolean(form && formBaseline && !taskBoardFormsEqual(form, formBaseline));
  const confirmDiscardChanges = useUnsavedChangesGuard(formDirty && !saving && !deleting);
  const backlogTasks = useMemo(() => tasks.filter((task) => !task.isRoutine), [tasks]);
  const filteredTasks = useMemo(() => filterTasks(backlogTasks, filters), [backlogTasks, filters]);
  const grouped = useMemo(() => tasksByStatus(filteredTasks), [filteredTasks]);
  const hasFilterResults = filteredTasks.length > 0;
  const showEmptyBoard = backlogTasks.length === 0 || !hasFilterResults;
  const draggedTask = useMemo(
    () => (draggedTaskId ? backlogTasks.find((task) => task.id === draggedTaskId) ?? null : null),
    [backlogTasks, draggedTaskId],
  );

  function openTaskForm(next: BacklogTaskFormState) {
    setForm(next);
    setFormBaseline(next);
    setDrawerOpen(true);
  }

  // The drawer calls this after its exit animation completes — only then is
  // the form released, so every exit (save, delete, discard) animates out.
  function releaseTaskForm() {
    setForm(null);
    setFormBaseline(null);
  }

  function dismissTaskForm() {
    setDrawerOpen(false);
  }

  async function closeTaskForm() {
    if (!drawerOpen || saving || deleting) return;
    if (!(await confirmDiscardChanges())) return;
    dismissTaskForm();
  }

  function editTask(task: RelayTaskListItem) {
    openTaskForm({
      variant: "backlog",
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate ?? "",
      assigneeEmployeeId: task.assigneeEmployeeId ?? task.ownerEmployeeId ?? currentUser.employeeId ?? currentUser.username,
      assignedAgent: task.assignedAgent ?? "",
      assignedAgentId: task.assignedAgentId ?? "",
      assignedTeamId: task.assignedTeamId ?? "",
    });
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate,
        ...taskAssignmentMutationFields(form),
      };
      if (form.id) await updateTaskMutation.mutateAsync({ taskId: form.id, input: payload });
      else await createTaskMutation.mutateAsync(payload);
      dismissTaskForm();
    } catch {
      // mutation onError surfaces a toast; keep the drawer open for retry.
    } finally {
      setSaving(false);
    }
  }

  async function deleteBacklog() {
    if (!form?.id || deleting) return;
    const confirmed = await confirm({
      title: t("backlog.delete_title"),
      message: t("backlog.delete_body", { title: form.title }),
      confirmLabel: t("backlog.delete_task"),
      cancelLabel: t("dialog.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteTaskMutation.mutateAsync({ taskId: form.id });
      dismissTaskForm();
      announce({ message: t("backlog.toast_deleted"), tone: "success" });
    } catch {
      // mutation onError surfaces a toast; keep the drawer open for retry.
    } finally {
      setDeleting(false);
    }
  }

  function linkedSession(task: RelayTaskListItem): RelaySession | undefined {
    const latest = task.linkedSessionIds?.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  function taskAssignmentDisplay(task: RelayTaskListItem): { name?: string; ready: boolean } {
    const team = teams.find((candidate) => candidate.id === task.assignedTeamId);
    if (team) {
      return {
        name: team.name,
        ready: teamReady(team),
      };
    }
    return {
      name: logicalAgents.find((agent) => agent.id === task.assignedAgentId)?.displayName,
      ready: agentReadyForTask(task, nodes, logicalAgents),
    };
  }

  function changeView(next: BacklogView) {
    setView(next);
    writeViewPreference(VIEW_STORAGE_KEY, next);
  }

  function beginTaskDrag(task: RelayTaskListItem, event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TASK_DRAG_MEDIA_TYPE, task.id);
    event.dataTransfer.setData("text/plain", task.title);
    setDraggedTaskId(task.id);
  }

  function endTaskDrag() {
    stopBoardScroll();
    setDraggedTaskId(null);
    setDropLane(null);
  }

  // The board hides its rightmost lanes on a laptop-width window and the
  // browser does not auto-scroll an overflow container mid-drag, so a card
  // dragged to the edge pulls the board along itself.
  function boardDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedTask) return;
    trackBoardEdge(event.currentTarget, event.clientX);
  }

  function boardDragLeave(event: DragEvent<HTMLDivElement>) {
    // Crossing into a lane or a card also raises dragleave on the board; only
    // a pointer that has left the board entirely should halt the scroll.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    stopBoardScroll();
  }

  // The lane a drop would land in, and whether it would be refused. Only the
  // hovered lane is decorated; a task's own lane stays neutral so hovering
  // back over the origin does not read as an error.
  function laneDropState(status: TaskStatus): "active" | "blocked" | undefined {
    if (!draggedTask || dropLane !== status) return undefined;
    const rejection = taskDropRejection(draggedTask, status);
    if (!rejection) return "active";
    return rejection === "needs_assignment" ? "blocked" : undefined;
  }

  function laneDragOver(status: TaskStatus, event: DragEvent<HTMLElement>) {
    // Without preventDefault the browser never fires `drop` on this element.
    if (!draggedTask) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = draggedTask.status === status ? "none" : "move";
    if (dropLane !== status) setDropLane(status);
  }

  function laneDragLeave(event: DragEvent<HTMLElement>) {
    // dragleave also fires when the pointer crosses into a child card, so keep
    // the lane highlighted until the pointer truly leaves it.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropLane(null);
  }

  // The single commit path for both input methods: HTML5 drops from a mouse
  // and press-and-hold drags from a finger.
  function moveTaskToLane(taskId: string | null, status: TaskStatus | null) {
    const task = taskId && status ? backlogTasks.find((candidate) => candidate.id === taskId) : undefined;
    if (!task || !status) return;
    const rejection = taskDropRejection(task, status);
    if (rejection === "needs_assignment") {
      announce({ message: t("backlog.drop_needs_assignment"), tone: "error" });
      return;
    }
    if (rejection) return;
    updateTaskMutation.mutate({ taskId: task.id, input: { status } }, {
      onSuccess: () => announce({
        message: t("backlog.drop_moved", { title: task.title, status: t(`backlog.statuses.${status}`) }),
        tone: "success",
      }),
    });
  }

  function dropTaskInLane(status: TaskStatus, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const taskId = readDraggedTaskId(event.dataTransfer) ?? draggedTaskId;
    endTaskDrag();
    moveTaskToLane(taskId, status);
  }

  function taskHandlers(task: RelayTaskListItem) {
    const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
    const discussionAssignments = logicalAgents
      .filter((agent) => agent.enabled && agent.availability === "ready")
      .map((agent) => ({ agentId: agent.id, agent: agent.executorKind, mode: "ask" as const }));
    return {
      onEdit: () => editTask(task),
      onStart: () => void startTaskMutation.mutate(
        (task.assignedAgentId || task.assignedTeamId)
          ? { taskId: task.id }
          : { taskId: task.id, assignments: discussionAssignments },
        {
          onSuccess: (result) => {
            if (!task.assignedAgentId && !task.assignedTeamId && result.session) onOpenThread(result.session.id);
          },
        },
      ),
      onToggleBlock: () => void updateTaskMutation.mutate({
        taskId: task.id,
        input: { status: task.status === "blocked" ? "backlog" : "blocked" },
      }),
      onDone: () => void updateTaskMutation.mutate({ taskId: task.id, input: { status: "done" } }),
    };
  }

  return (
    <section id="backlog-panel" className="backlog-page" data-view={view} data-density="compact" aria-label={t("backlog.title")} tabIndex={-1}>
      <PageHeader
        kicker={t("nav.workspace")}
        title={t("backlog.title")}
        count={t("backlog.sub", { count: backlogTasks.length })}
        actions={
          <TaskBoardHeaderActions
            leading={<BacklogViewToggle view={view} onChange={changeView} />}
            refreshLabel={t("nav.refresh")}
            createLabel={t("backlog.new_task")}
            isRefreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            onCreate={() => openTaskForm(emptyBacklogForm(currentUser))}
          />
        }
      />

      <BacklogStats tasks={backlogTasks} />
      <BacklogFiltersBar filters={filters} agents={logicalAgents} onChange={setFilters} />

      {showEmptyBoard ? (
        (() => {
          const filtered = backlogTasks.length > 0 && !hasFilterResults;
          return (
            <BoardEmpty
              title={filtered ? t("backlog.no_match_title") : t("backlog.no_tasks_title")}
              body={filtered ? t("backlog.no_match_body") : t("backlog.no_tasks_body")}
              createLabel={filtered ? undefined : t("backlog.new_task")}
              onCreate={filtered ? undefined : () => openTaskForm(emptyBacklogForm(currentUser))}
            />
          );
        })()
      ) : view === "list" ? (
        <div className="backlog-rows" role="table" aria-label={t("backlog.title")}>
          <div className="backlog-rows-head" role="row">
            <span className="backlog-rows-head-cell backlog-rows-head-dot" role="columnheader" />
            <span className="backlog-rows-head-cell backlog-rows-head-lead" role="columnheader">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status" role="columnheader">{t("backlog.status")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags" role="columnheader">{t("backlog.priority")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee" role="columnheader">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due" role="columnheader">{t("backlog.due")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions" role="columnheader">{t("backlog.actions")}</span>
          </div>
          {filteredTasks.map((task) => {
            const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
            const assignment = taskAssignmentDisplay(task);
            return (
              <BacklogTaskRow
                key={task.id}
                task={task}
                assigneeDisplayName={taskAssigneeDisplayName(task, currentUser, employeeNames)}
                assigneeIsSelf={isTaskAssigneeCurrentUser(task, currentUser)}
                agentDisplayName={assignment.name}
                ready={assignment.ready}
                canDiscuss={canDiscussTask(task) && discussionAgents.length > 0}
                {...taskHandlers(task)}
              />
            );
          })}
        </div>
      ) : (
        <div
          ref={boardRef}
          className="backlog-board"
          data-dragging={draggedTask ? "true" : undefined}
          onDragOver={boardDragOver}
          onDragLeave={boardDragLeave}
        >
          {TASK_STATUSES.map((status) => (
            <section
              key={status}
              className="backlog-lane"
              data-status={status}
              data-drop={laneDropState(status)}
              aria-label={t(`backlog.statuses.${status}`)}
              onDragOver={(event) => laneDragOver(status, event)}
              onDragLeave={laneDragLeave}
              onDrop={(event) => dropTaskInLane(status, event)}
            >
              <header className="backlog-lane-head">
                <span className="backlog-lane-label">{t(`backlog.statuses.${status}`)}</span>
                <span className="backlog-lane-count">{grouped[status].length}</span>
              </header>
              <div className="backlog-task-list">
                {grouped[status].length === 0 ? (
                  <p className="backlog-empty">{t("backlog.empty_lane")}</p>
                ) : grouped[status].map((task) => {
                  const session = linkedSession(task);
                  const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
                  const assignment = taskAssignmentDisplay(task);
                  return (
                    <BacklogTaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      assigneeDisplayName={taskAssigneeDisplayName(task, currentUser, employeeNames)}
                      assigneeIsSelf={isTaskAssigneeCurrentUser(task, currentUser)}
                      agentDisplayName={assignment.name}
                      ready={assignment.ready}
                      canDiscuss={canDiscussTask(task) && discussionAgents.length > 0}
                      dragging={draggedTaskId === task.id}
                      onDragStart={(event) => beginTaskDrag(task, event)}
                      onDragEnd={endTaskDrag}
                      onTouchStart={(event) => touchDrag.onTouchStart(task.id, event)}
                      {...taskHandlers(task)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* A touch drag has no browser-drawn drag image, so the card's identity
          has to follow the finger explicitly. */}
      {touchDrag.point && draggedTask ? (
        <span className="backlog-drag-ghost" aria-hidden="true" style={dragGhostStyle(touchDrag.point)}>
          {draggedTask.title}
        </span>
      ) : null}

      {form ? (
        <TaskDrawer
          open={drawerOpen}
          form={form}
          logicalAgents={logicalAgents}
          teams={teams}
          saving={saving}
          deleting={deleting}
          title={form.id ? t("backlog.edit_task") : t("backlog.new_task")}
          subtitle={form.id ?? t("backlog.new_task_id")}
          onClose={() => { void closeTaskForm(); }}
          onClosed={releaseTaskForm}
          onChange={(next) => {
            if (next.variant === "backlog") setForm(next);
          }}
          onSubmit={(event) => void submitTask(event)}
          onDelete={form.id ? () => { void deleteBacklog(); } : undefined}
        />
      ) : null}
    </section>
  );
}
