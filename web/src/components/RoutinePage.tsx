"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useDialogs } from "@/components/ui/DialogProvider";
import { AgentStateBadge } from "./AgentStateBadge";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "./PriorityBadge";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask } from "../types";
import { ActionApprove, ActionCalendar, ActionStart, ActionStop, NavConversations, NavRefresh, ViewGrid, ViewList } from "./icons";
import { agentReadyForTask } from "../lib/backlog";
import { TaskAssignee } from "./TaskAssignee";
import { readViewPreference, writeViewPreference } from "../lib/viewPreference";
import { filterRoutineTasks, routineDueTone, TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, type RoutineFilters } from "../lib/routine";
import { emptyRoutineForm, taskBoardFormsEqual, type RoutineTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { Button } from "./ui/button";
import { FiltersBar } from "./FiltersBar";

interface RoutinePageProps {
  tasks: RelayTask[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
}

const initialFilters: RoutineFilters = {
  query: "",
  type: "all",
  cadence: "all",
  agent: "all",
  assignee: "",
  state: "all",
};

type RoutineView = "card" | "list";

const ROUTINE_VIEW_STORAGE_KEY = "relay-web.routineView";
const ROUTINE_VIEWS: readonly RoutineView[] = ["card", "list"];

function parseRoutineFilters(value: string | null): RoutineFilters {
  if (!value) return initialFilters;
  try {
    return { ...initialFilters, ...JSON.parse(value) } as RoutineFilters;
  } catch {
    return initialFilters;
  }
}

function serializeRoutineFilters(value: RoutineFilters): string | null {
  return JSON.stringify(value) === JSON.stringify(initialFilters) ? null : JSON.stringify(value);
}

function parseRoutineView(value: string | null): RoutineView {
  return ROUTINE_VIEWS.includes(value as RoutineView)
    ? value as RoutineView
    : readViewPreference(ROUTINE_VIEW_STORAGE_KEY, "list", ROUTINE_VIEWS);
}

function activeFilterCount(filters: RoutineFilters): number {
  let count = 0;
  if (filters.type !== "all") count += 1;
  if (filters.cadence !== "all") count += 1;
  if (filters.agent !== "all") count += 1;
  if (filters.assignee.trim()) count += 1;
  if (filters.state !== "all") count += 1;
  return count;
}

function RoutineStats({ tasks }: { tasks: RelayTask[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const enabled = tasks.filter((task) => task.routineEnabled).length;
    const due = tasks.filter((task) => routineDueTone(task) !== "neutral").length;
    const running = tasks.filter((task) => task.status === "running" || task.status === "review").length;
    return { total: tasks.length, enabled, due, running };
  }, [tasks]);

  return (
    <p className="backlog-stats" aria-label={t("routine.metrics")}>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_enabled")}</span>
        <span className="backlog-stat-value tone-active">{stats.enabled}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_due")}</span>
        <span className={cn("backlog-stat-value", stats.due > 0 && "tone-overdue")}>{stats.due}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_running")}</span>
        <span className="backlog-stat-value">{stats.running}</span>
      </span>
    </p>
  );
}

function formatNextRunDate(value: string): string {
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

function RoutineFiltersBar({ filters, onChange }: { filters: RoutineFilters; onChange: (next: RoutineFilters) => void }) {
  const { t } = useTranslation();

  return (
    <FiltersBar
      ariaLabel={t("routine.filters")}
      searchName="routine-query"
      searchLabel={t("routine.search")}
      query={filters.query}
      onQueryChange={(query) => onChange({ ...filters, query })}
      activeCount={activeFilterCount(filters)}
      onClear={() => onChange(initialFilters)}
    >
      <select name="routine-type-filter" value={filters.type} aria-label={t("routine.type")} onChange={(event) => onChange({ ...filters, type: event.target.value as RoutineFilters["type"] })}>
        <option value="all">{t("routine.all_types")}</option>
        {TASK_ROUTINE_TYPES.map((type) => <option key={type} value={type}>{t(`routine.types.${type}`)}</option>)}
      </select>
      <select name="routine-cadence-filter" value={filters.cadence} aria-label={t("routine.cadence")} onChange={(event) => onChange({ ...filters, cadence: event.target.value as RoutineFilters["cadence"] })}>
        <option value="all">{t("routine.all_cadences")}</option>
        {TASK_ROUTINE_CADENCES.map((cadence) => <option key={cadence} value={cadence}>{t(`routine.cadences.${cadence}`)}</option>)}
      </select>
      <select name="routine-agent-filter" value={filters.agent} aria-label={t("backlog.agent")} onChange={(event) => onChange({ ...filters, agent: event.target.value as RoutineFilters["agent"] })}>
        <option value="all">{t("backlog.all_agents")}</option>
        {AGENT_NAMES.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
      </select>
      <input name="routine-assignee-filter" autoComplete="off" spellCheck={false} value={filters.assignee} placeholder={t("backlog.assignee_filter")} aria-label={t("backlog.assignee_filter")} onChange={(event) => onChange({ ...filters, assignee: event.target.value })} />
      <select name="routine-state-filter" value={filters.state} aria-label={t("routine.state")} onChange={(event) => onChange({ ...filters, state: event.target.value as RoutineFilters["state"] })}>
        <option value="all">{t("routine.all_states")}</option>
        <option value="enabled">{t("routine.enabled")}</option>
        <option value="disabled">{t("routine.disabled")}</option>
        <option value="due">{t("routine.due")}</option>
        <option value="unscheduled">{t("routine.unscheduled")}</option>
      </select>
    </FiltersBar>
  );
}

function RoutineCard({
  task,
  session,
  ready,
  onEdit,
  onStart,
  onOpenThread,
  onToggleBlock,
  onDone,
}: {
  task: RelayTask;
  session?: RelaySession;
  ready: boolean;
  onEdit: () => void;
  onStart: () => void;
  onOpenThread: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);

  return (
    <article className="routine-card backlog-task list-virtual" data-priority={task.priority} data-status={task.status}>
      <div className="backlog-task-badges">
        <Badge variant={task.routineEnabled ? "success" : "neutral"}>{task.routineEnabled ? t("routine.enabled") : t("routine.disabled")}</Badge>
        <PriorityBadge priority={task.priority} />
        <AgentStateBadge agent={task.assignedAgent} ready={ready} />
      </div>
      <Button variant="ghost" type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</Button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        <span>{t(`routine.types.${task.routineType ?? "task"}`)} · {t(`routine.cadences.${task.routineCadence ?? "weekly"}`)}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <TaskAssignee task={task} ready={ready} unassignedLabel={t("backlog.unassigned")} showAgent={false} />
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span className={cn("backlog-due", tone !== "neutral" && tone)}>
          <ActionCalendar size={13} />
          {task.routineNextRunDate ? formatNextRunDate(task.routineNextRunDate) : t("routine.no_next_run")}
        </span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <TaskStatusBadge status={task.status} />
        {session ? (
          <>
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
            <span>{t("backlog.linked")}</span>
          </>
        ) : null}
      </div>
      <div className="backlog-task-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <Button variant="default"
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart} disabled={!task.assignedAgent || !task.routineEnabled || task.status === "running" || task.status === "done"} aria-label={t("backlog.start")} title={t("backlog.start")}>
            <ActionStart size={14} />
          </Button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <Button variant="ghost" type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</Button>
          </div>
        ) : null}
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="ghost" type="button" className={task.status === "blocked" ? undefined : "backlog-action-block"} onClick={onToggleBlock}>{task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}</Button>
          <Button variant="ghost" type="button" className="backlog-action-done" onClick={onDone}>{t("backlog.done")}</Button>
        </div>
      </div>
    </article>
  );
}

function RoutineViewToggle({ view, onChange }: { view: RoutineView; onChange: (view: RoutineView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle" role="group" aria-label={t("routine.view")}>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "card" ? "true" : "false"}
        aria-pressed={view === "card"}
        aria-label={t("routine.view_card")}
        title={t("routine.view_card")}
        onClick={() => onChange("card")}
      >
        <ViewGrid size={15} />
      </Button>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "list" ? "true" : "false"}
        aria-pressed={view === "list"}
        aria-label={t("routine.view_list")}
        title={t("routine.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={15} />
      </Button>
    </div>
  );
}

function RoutineRow({
  task,
  session,
  ready,
  onEdit,
  onStart,
  onOpenThread,
  onToggleBlock,
  onDone,
}: {
  task: RelayTask;
  session?: RelaySession;
  ready: boolean;
  onEdit: () => void;
  onStart: () => void;
  onOpenThread: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);

  return (
    <article className="backlog-row group list-virtual" role="listitem" data-status={task.status} data-priority={task.priority}>
      <div className="backlog-row-lead">
        <span className="backlog-row-dot" aria-hidden="true" />
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
      </div>
      <span className="backlog-row-status">{task.routineEnabled ? t("routine.enabled") : t("routine.disabled")}</span>
      <div className="backlog-row-tags">
        <PriorityBadge priority={task.priority} />
      </div>
      <span className="backlog-row-assignee">
        <TaskAssignee task={task} ready={ready} unassignedLabel={t("backlog.unassigned")} />
      </span>
      <span className={cn("backlog-row-due", tone !== "neutral" && tone)}>
        <ActionCalendar size={13} />
        {task.routineNextRunDate ? formatNextRunDate(task.routineNextRunDate) : t("routine.no_next_run")}
      </span>
      <div className="backlog-row-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <Button variant="default"
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={!task.assignedAgent || !task.routineEnabled || task.status === "running" || task.status === "done"}
            aria-label={t("backlog.start")}
            title={t("backlog.start")}
          >
            <ActionStart size={14} />
          </Button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <Button variant="ghost"
              type="button"
              className="backlog-action-icon"
              onClick={onOpenThread}
              aria-label={t("backlog.open_thread")}
              title={t("backlog.open_thread")}
            >
              <NavConversations size={14} />
            </Button>
          </div>
        ) : null}
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

function RoutineDrawerMeta({
  task,
  session,
  onOpenThread,
}: {
  task: RelayTask;
  session?: RelaySession;
  onOpenThread: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const lastActivity = task.activity.at(-1);

  return (
    <section className="task-drawer-meta" aria-label={t("routine.meta")}>
      <div className="task-drawer-meta-row">
        <TaskStatusBadge status={task.status} />
        <Badge variant={task.routineEnabled ? "success" : "neutral"}>
          {task.routineEnabled ? t("routine.enabled") : t("routine.disabled")}
        </Badge>
        {session ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => onOpenThread(session.id)}>
            {t("backlog.open_thread")}
          </Button>
        ) : null}
      </div>
      <p className="task-drawer-meta-activity">
        {lastActivity ? lastActivity.message : t("routine.no_activity")}
      </p>
    </section>
  );
}

export function RoutinePage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation }: RoutinePageProps) {
  const { agents: logicalAgents } = useEmployeeAgents(currentUser.employeeId);
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const {
    startTaskMutation,
    updateTaskMutation,
    createTaskMutation,
    deleteTaskMutation,
  } = useRelayMutations();
  const [filters, setFilters] = useUrlSearchState("routineFilters", initialFilters, parseRoutineFilters, serializeRoutineFilters);
  const [view, setView] = useUrlSearchState("routineView", parseRoutineView(null), parseRoutineView, (value) => value);
  const [form, setForm] = useState<RoutineTaskFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<RoutineTaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const formDirty = Boolean(form && formBaseline && !taskBoardFormsEqual(form, formBaseline));
  const confirmDiscardChanges = useUnsavedChangesGuard(formDirty && !saving && !deleting);
  const routineTasks = useMemo(() => tasks.filter((task) => task.isRoutine), [tasks]);
  const filteredTasks = useMemo(() => filterRoutineTasks(tasks, filters), [tasks, filters]);
  const employees = useMemo(() => {
    const values = new Set<string>();
    for (const task of tasks) {
      if (task.assigneeEmployeeId) values.add(task.assigneeEmployeeId);
      if (task.ownerEmployeeId) values.add(task.ownerEmployeeId);
    }
    for (const node of nodes) if (node.employeeId) values.add(node.employeeId);
    if (currentUser.employeeId) values.add(currentUser.employeeId);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [currentUser.employeeId, nodes, tasks]);

  function changeView(next: RoutineView) {
    setView(next);
    writeViewPreference(ROUTINE_VIEW_STORAGE_KEY, next);
  }

  function openRoutineForm(next: RoutineTaskFormState) {
    setForm(next);
    setFormBaseline(next);
  }

  async function closeRoutineForm() {
    if (saving || deleting) return;
    if (!(await confirmDiscardChanges())) return;
    setForm(null);
    setFormBaseline(null);
  }

  function editTask(task: RelayTask) {
    openRoutineForm({
      variant: "routine",
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeEmployeeId: task.assigneeEmployeeId ?? task.ownerEmployeeId ?? currentUser.employeeId ?? currentUser.username,
      assignedAgent: task.assignedAgent ?? "",
      assignedAgentId: task.assignedAgentId ?? "",
      routineType: task.routineType ?? "task",
      routineCadence: task.routineCadence ?? "weekly",
      routineNextRunDate: task.routineNextRunDate ?? "",
      routineEnabled: task.routineEnabled,
    });
  }

  async function submitRoutine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        priority: form.priority,
        assigneeEmployeeId: form.assigneeEmployeeId.trim(),
        isRoutine: true,
        routineType: form.routineType,
        routineCadence: form.routineCadence,
        routineEnabled: form.routineEnabled,
        ...(form.routineCadence === "custom"
          ? { routineNextRunDate: form.routineNextRunDate }
          : {}),
        ...(form.assignedAgent ? { assignedAgent: form.assignedAgent } : {}),
        ...(form.assignedAgentId ? { assignedAgentId: form.assignedAgentId } : {}),
      };
      if (form.id) await updateTaskMutation.mutateAsync({ taskId: form.id, input: payload });
      else await createTaskMutation.mutateAsync(payload);
      setForm(null);
      setFormBaseline(null);
    } catch {
      // mutation onError surfaces a toast; keep the drawer open for retry.
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoutine() {
    if (!form?.id || deleting) return;
    const confirmed = await confirm({
      title: t("routine.delete_title"),
      message: t("routine.delete_body", { title: form.title }),
      confirmLabel: t("backlog.delete_task"),
      cancelLabel: t("dialog.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteTaskMutation.mutateAsync({ taskId: form.id });
      setForm(null);
      setFormBaseline(null);
    } catch {
      // mutation onError surfaces a toast; keep the drawer open for retry.
    } finally {
      setDeleting(false);
    }
  }

  function linkedSession(task: RelayTask): RelaySession | undefined {
    const latest = task.linkedSessionIds.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  const editingTask = form?.id ? tasks.find((task) => task.id === form.id) : undefined;
  const editingSession = editingTask ? linkedSession(editingTask) : undefined;

  function routineHandlers(task: RelayTask, session?: RelaySession) {
    return {
      onEdit: () => editTask(task),
      onStart: () => void startTaskMutation.mutate({ taskId: task.id }),
      onOpenThread: () => session && onOpenConversation(session.id),
      onToggleBlock: () => void updateTaskMutation.mutate({
        taskId: task.id,
        input: { status: task.status === "blocked" ? "backlog" : "blocked" },
      }),
      onDone: () => void updateTaskMutation.mutate({ taskId: task.id, input: { status: "done" } }),
    };
  }

  return (
    <section id="routine-panel" className="routine-page backlog-page" aria-label={t("routine.title")} tabIndex={-1}>
      <PageHeader
        kicker={t("nav.routine")}
        title={t("routine.title")}
        count={t("routine.sub", { count: routineTasks.length })}
        actions={
          <TaskBoardHeaderActions
            leading={<RoutineViewToggle view={view} onChange={changeView} />}
            refreshLabel={t("nav.refresh")}
            createLabel={t("routine.new")}
            isRefreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            onCreate={() => openRoutineForm(emptyRoutineForm(currentUser))}
          />
        }
      />

      <RoutineStats tasks={routineTasks} />
      <RoutineFiltersBar filters={filters} onChange={setFilters} />

      {filteredTasks.length === 0 ? (
        <BoardEmpty
          title={routineTasks.length === 0 ? t("routine.no_routines_title") : t("routine.no_match_title")}
          body={routineTasks.length === 0 ? t("routine.no_routines_body") : t("routine.no_match_body")}
          createLabel={routineTasks.length === 0 ? t("routine.new") : undefined}
          onCreate={routineTasks.length === 0 ? () => openRoutineForm(emptyRoutineForm(currentUser)) : undefined}
        />
      ) : view === "list" ? (
        <div className="backlog-rows" role="list" aria-label={t("routine.title")}>
          <div className="backlog-rows-head" aria-hidden="true">
            <span className="backlog-rows-head-cell backlog-rows-head-lead">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status">{t("routine.state")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags">{t("backlog.priority")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due">{t("routine.next_run")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions">{t("backlog.actions")}</span>
          </div>
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            return (
              <RoutineRow
                key={task.id}
                task={task}
                session={session}
                ready={agentReadyForTask(task, nodes, logicalAgents)}
                {...routineHandlers(task, session)}
              />
            );
          })}
        </div>
      ) : (
        <div className="routine-list">
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            return (
              <RoutineCard
                key={task.id}
                task={task}
                session={session}
                ready={agentReadyForTask(task, nodes, logicalAgents)}
                {...routineHandlers(task, session)}
              />
            );
          })}
        </div>
      )}

      {form ? (
        <TaskDrawer
          form={form}
          employees={employees}
          logicalAgents={logicalAgents}
          saving={saving}
          deleting={deleting}
          title={form.id ? t("routine.edit") : t("routine.new")}
          subtitle={form.id
            ? `${t(`routine.types.${form.routineType}`)} · ${t(`routine.cadences.${form.routineCadence}`)}`
            : t("routine.new_routine_id")}
          employeeDatalistId="routine-employees"
          meta={editingTask ? (
            <RoutineDrawerMeta
              task={editingTask}
              session={editingSession}
              onOpenThread={onOpenConversation}
            />
          ) : undefined}
          onClose={() => { void closeRoutineForm(); }}
          onChange={(next) => {
            if (next.variant === "routine") setForm(next);
          }}
          onSubmit={(event) => void submitRoutine(event)}
          onDelete={form.id ? () => { void deleteRoutine(); } : undefined}
        />
      ) : null}
    </section>
  );
}
