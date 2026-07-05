"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { AgentStateBadge } from "./AgentStateBadge";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "./PriorityBadge";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type AgentName, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask } from "../types";
import { ActionCalendar, ActionSearch, ActionStart } from "./icons";
import { agentReadyForTask } from "../lib/backlog";
import { filterRoutineTasks, routineDueTone, TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, type RoutineFilters } from "../lib/routine";
import { emptyRoutineForm, taskBoardFormsEqual, type RoutineTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";

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
    <div className="backlog-stats" aria-label={t("routine.metrics")}>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_enabled")}</span>
        <span className="backlog-stat-value tone-active">{stats.enabled}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_due")}</span>
        <span className={cn("backlog-stat-value", stats.due > 0 && "tone-overdue")}>{stats.due}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("routine.metric_running")}</span>
        <span className="backlog-stat-value">{stats.running}</span>
      </div>
    </div>
  );
}

function RoutineFiltersBar({ filters, onChange }: { filters: RoutineFilters; onChange: (next: RoutineFilters) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="backlog-filter-bar" aria-label={t("routine.filters")}>
      <div className="backlog-filter-primary">
        <div className="backlog-filter-search-wrap">
          <ActionSearch size={15} aria-hidden="true" />
          <input
            className="backlog-filter-search"
            name="routine-query"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={filters.query}
            placeholder={t("routine.search")}
            aria-label={t("routine.search")}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
          />
        </div>
        <div className="backlog-filter-actions">
          <button
            type="button"
            className="backlog-filter-chip"
            data-active={expanded ? "true" : "false"}
            data-applied={activeCount > 0 ? "true" : "false"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("backlog.hide_filters") : t("backlog.show_filters")}
            {activeCount > 0 ? (
              <span className="backlog-filter-count" aria-hidden="true">{activeCount}</span>
            ) : null}
          </button>
          {activeCount > 0 ? (
            <button type="button" className="backlog-filter-clear" onClick={() => onChange(initialFilters)}>
              {t("backlog.clear_filters")}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="backlog-filter-secondary">
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
          <input name="routine-assignee-filter" autoComplete="off" value={filters.assignee} placeholder={t("backlog.assignee_filter")} aria-label={t("backlog.assignee_filter")} onChange={(event) => onChange({ ...filters, assignee: event.target.value })} />
          <select name="routine-state-filter" value={filters.state} aria-label={t("routine.state")} onChange={(event) => onChange({ ...filters, state: event.target.value as RoutineFilters["state"] })}>
            <option value="all">{t("routine.all_states")}</option>
            <option value="enabled">{t("routine.enabled")}</option>
            <option value="disabled">{t("routine.disabled")}</option>
            <option value="due">{t("routine.due")}</option>
            <option value="unscheduled">{t("routine.unscheduled")}</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

function RoutineCard({
  task,
  session,
  ready,
  onEdit,
  onAssign,
  onStart,
  onOpenThread,
  onToggleBlock,
  onDone,
}: {
  task: RelayTask;
  session?: RelaySession;
  ready: boolean;
  onEdit: () => void;
  onAssign: (agent: AgentName) => void;
  onStart: () => void;
  onOpenThread: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);

  return (
    <article className="routine-card backlog-task" data-priority={task.priority} data-status={task.status}>
      <div className="backlog-task-badges">
        <Badge variant={task.routineEnabled ? "success" : "neutral"}>{task.routineEnabled ? t("routine.enabled") : t("routine.disabled")}</Badge>
        <PriorityBadge priority={task.priority} />
        <AgentStateBadge agent={task.assignedAgent} ready={ready} />
      </div>
      <button type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        <span>{t(`routine.types.${task.routineType ?? "task"}`)} · {t(`routine.cadences.${task.routineCadence ?? "weekly"}`)}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span>@{task.assigneeEmployeeId ?? task.ownerEmployeeId ?? t("backlog.unassigned")}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span className={cn("backlog-due", tone !== "neutral" && tone)}>
          <ActionCalendar size={13} />
          {task.routineNextRunDate || t("routine.no_next_run")}
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
          <select
            name={`routine-${task.id}-agent-card`}
            value={task.assignedAgent ?? ""}
            aria-label={t("backlog.assign_agent")}
            onChange={(event) => {
              const agent = event.target.value as AgentName;
              if (agent) onAssign(agent);
            }}
          >
            <option value="">{t("backlog.no_agent")}</option>
            {AGENT_NAMES.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
          </select>
          <button type="button" className="backlog-action-primary backlog-action-icon" onClick={onStart} disabled={!task.assignedAgent || !task.routineEnabled || task.status === "running" || task.status === "done"} aria-label={t("backlog.start")} title={t("backlog.start")}>
            <ActionStart size={14} />
          </button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <button type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</button>
          </div>
        ) : null}
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <button type="button" className={task.status === "blocked" ? undefined : "backlog-action-block"} onClick={onToggleBlock}>{task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}</button>
          <button type="button" className="backlog-action-done" onClick={onDone}>{t("backlog.done")}</button>
        </div>
      </div>
    </article>
  );
}

export function RoutinePage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation }: RoutinePageProps) {
  const { t } = useTranslation();
  const {
    assignTaskMutation,
    startTaskMutation,
    updateTaskMutation,
    createTaskMutation,
  } = useRelayMutations();
  const [filters, setFilters] = useState<RoutineFilters>(initialFilters);
  const [form, setForm] = useState<RoutineTaskFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<RoutineTaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const formDirty = Boolean(form && formBaseline && !taskBoardFormsEqual(form, formBaseline));
  const confirmDiscardChanges = useUnsavedChangesGuard(formDirty && !saving);
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

  function openRoutineForm(next: RoutineTaskFormState) {
    setForm(next);
    setFormBaseline(next);
  }

  async function closeRoutineForm() {
    if (saving) return;
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
        routineNextRunDate: form.routineNextRunDate,
        routineEnabled: form.routineEnabled,
        ...(form.assignedAgent ? { assignedAgent: form.assignedAgent } : {}),
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

  function linkedSession(task: RelayTask): RelaySession | undefined {
    const latest = task.linkedSessionIds.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  return (
    <section id="routine-panel" className="routine-page backlog-page" aria-label={t("routine.title")} tabIndex={-1}>
      <PageHeader
        title={t("routine.title")}
        count={t("routine.sub", { count: routineTasks.length })}
        actions={
          <TaskBoardHeaderActions
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
      ) : (
        <div className="routine-list">
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            return (
              <RoutineCard
                key={task.id}
                task={task}
                session={session}
                ready={agentReadyForTask(task, nodes)}
                onEdit={() => editTask(task)}
                onAssign={(agent) => void assignTaskMutation.mutate({ taskId: task.id, agent })}
                onStart={() => void startTaskMutation.mutate({ taskId: task.id })}
                onOpenThread={() => session && onOpenConversation(session.id)}
                onToggleBlock={() => void updateTaskMutation.mutate({
                  taskId: task.id,
                  input: { status: task.status === "blocked" ? "backlog" : "blocked" },
                })}
                onDone={() => void updateTaskMutation.mutate({ taskId: task.id, input: { status: "done" } })}
              />
            );
          })}
        </div>
      )}

      {form ? (
        <TaskDrawer
          form={form}
          employees={employees}
          saving={saving}
          title={form.id ? t("routine.edit") : t("routine.new")}
          subtitle={form.id ?? t("routine.new_routine_id")}
          employeeDatalistId="routine-employees"
          onClose={() => { void closeRoutineForm(); }}
          onChange={(next) => {
            if (next.variant === "routine") setForm(next);
          }}
          onSubmit={(event) => void submitRoutine(event)}
        />
      ) : null}
    </section>
  );
}
