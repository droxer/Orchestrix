"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignTask, createTask, startTask, updateTask } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type AgentName, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask, type TaskPriority, type TaskRoutineCadence, type TaskRoutineType, type Tone } from "../types";
import { ActionAddPerson, ActionCalendar, ActionCompose, ActionRemove, ActionSearch, ActionStart, NavRefresh } from "./icons";
import { agentReadyForTask, TASK_PRIORITIES } from "../lib/backlog";
import { filterRoutineTasks, routineDueTone, TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, type RoutineFilters } from "../lib/routine";

type StatusUpdate = { tone: Tone; message: string };

interface RoutinePageProps {
  tasks: RelayTask[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
  setStatus: (status: StatusUpdate) => void;
}

type RoutineFormState = {
  id?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeEmployeeId: string;
  assignedAgent: "" | AgentName;
  routineType: TaskRoutineType;
  routineCadence: TaskRoutineCadence;
  routineNextRunDate: string;
  routineEnabled: boolean;
};

const initialFilters: RoutineFilters = {
  query: "",
  type: "all",
  cadence: "all",
  agent: "all",
  assignee: "",
  state: "all",
};

const emptyForm = (currentUser: CurrentUser): RoutineFormState => ({
  title: "",
  description: "",
  priority: "normal",
  assigneeEmployeeId: currentUser.employeeId ?? currentUser.username,
  assignedAgent: "",
  routineType: "task",
  routineCadence: "weekly",
  routineNextRunDate: "",
  routineEnabled: true,
});

const PRIORITY_BADGE: Record<TaskPriority, "danger" | "info" | "neutral"> = {
  high: "danger",
  normal: "info",
  low: "neutral",
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
        <ActionSearch size={15} aria-hidden="true" />
        <input
          className="backlog-filter-search"
          value={filters.query}
          placeholder={t("routine.search")}
          aria-label={t("routine.search")}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
        <button type="button" className="backlog-filter-chip" data-active={expanded ? "true" : "false"} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("backlog.hide_filters") : t("backlog.show_filters")}
          {activeCount > 0 ? ` · ${activeCount}` : ""}
        </button>
        {activeCount > 0 ? <button type="button" className="backlog-filter-chip" onClick={() => onChange(initialFilters)}>{t("backlog.clear_filters")}</button> : null}
      </div>
      {expanded ? (
        <div className="backlog-filter-secondary">
          <select value={filters.type} aria-label={t("routine.type")} onChange={(event) => onChange({ ...filters, type: event.target.value as RoutineFilters["type"] })}>
            <option value="all">{t("routine.all_types")}</option>
            {TASK_ROUTINE_TYPES.map((type) => <option key={type} value={type}>{t(`routine.types.${type}`)}</option>)}
          </select>
          <select value={filters.cadence} aria-label={t("routine.cadence")} onChange={(event) => onChange({ ...filters, cadence: event.target.value as RoutineFilters["cadence"] })}>
            <option value="all">{t("routine.all_cadences")}</option>
            {TASK_ROUTINE_CADENCES.map((cadence) => <option key={cadence} value={cadence}>{t(`routine.cadences.${cadence}`)}</option>)}
          </select>
          <select value={filters.agent} aria-label={t("backlog.agent")} onChange={(event) => onChange({ ...filters, agent: event.target.value as RoutineFilters["agent"] })}>
            <option value="all">{t("backlog.all_agents")}</option>
            {AGENT_NAMES.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
          </select>
          <input value={filters.assignee} placeholder={t("backlog.assignee_filter")} aria-label={t("backlog.assignee_filter")} onChange={(event) => onChange({ ...filters, assignee: event.target.value })} />
          <select value={filters.state} aria-label={t("routine.state")} onChange={(event) => onChange({ ...filters, state: event.target.value as RoutineFilters["state"] })}>
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
    <article className="routine-card backlog-task" data-priority={task.priority}>
      <div className="backlog-task-badges">
        <Badge variant={task.routineEnabled ? "success" : "neutral"}>{task.routineEnabled ? t("routine.enabled") : t("routine.disabled")}</Badge>
        <Badge variant="info">{t(`routine.types.${task.routineType ?? "task"}`)}</Badge>
        <Badge variant="neutral">{t(`routine.cadences.${task.routineCadence ?? "weekly"}`)}</Badge>
        <Badge variant={PRIORITY_BADGE[task.priority]}>{t(`backlog.priorities.${task.priority}`)}</Badge>
        {task.assignedAgent ? (
          <Badge variant={ready ? "success" : "danger"} translate="no">
            {task.assignedAgent} · {ready ? t("backlog.ready") : t("backlog.not_ready")}
          </Badge>
        ) : (
          <Badge variant="neutral">{t("backlog.no_agent")}</Badge>
        )}
      </div>
      <button type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        <span>@{task.assigneeEmployeeId ?? task.ownerEmployeeId ?? t("backlog.unassigned")}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span className={cn("backlog-due", tone !== "neutral" && tone)}>
          <ActionCalendar size={13} />
          {task.routineNextRunDate || t("routine.no_next_run")}
        </span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span>{t(`backlog.statuses.${task.status}`)}</span>
        {session ? (
          <>
            <span className="backlog-meta-sep" aria-hidden="true">·</span>
            <span>{t("backlog.linked")}</span>
          </>
        ) : null}
      </div>
      <div className="backlog-task-actions">
        <select
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
        <button type="button" className="backlog-action-primary" onClick={onStart} disabled={!task.assignedAgent || !task.routineEnabled || task.status === "running" || task.status === "done"}>
          <ActionStart size={14} />
          {t("backlog.start")}
        </button>
        {session ? <button type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</button> : null}
        <button type="button" onClick={onToggleBlock}>{task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}</button>
        <button type="button" onClick={onDone}>{t("backlog.done")}</button>
      </div>
    </article>
  );
}

function RoutineDrawer({
  form,
  employees,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  form: RoutineFormState;
  employees: string[];
  saving: boolean;
  onClose: () => void;
  onChange: (next: RoutineFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="backlog-drawer-shell" role="dialog" aria-modal="true" aria-label={form.id ? t("routine.edit") : t("routine.new")}>
      <button type="button" className="backlog-drawer-scrim" aria-label={t("dialog.cancel")} onClick={onClose} />
      <form className="backlog-drawer" onSubmit={onSubmit}>
        <header>
          <div>
            <h2>{form.id ? t("routine.edit") : t("routine.new")}</h2>
            <p>{form.id ?? t("backlog.new_task_id")}</p>
          </div>
          <button type="button" className="backlog-icon-btn" aria-label={t("dialog.cancel")} onClick={onClose}>
            <ActionRemove size={16} />
          </button>
        </header>
        <label>
          <span>{t("backlog.title_field")}</span>
          <input required value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} />
        </label>
        <label>
          <span>{t("backlog.description")}</span>
          <textarea value={form.description} rows={5} onChange={(event) => onChange({ ...form, description: event.target.value })} />
        </label>
        <div className="backlog-form-grid">
          <label>
            <span>{t("routine.type")}</span>
            <select value={form.routineType} onChange={(event) => onChange({ ...form, routineType: event.target.value as TaskRoutineType })}>
              {TASK_ROUTINE_TYPES.map((type) => <option key={type} value={type}>{t(`routine.types.${type}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("routine.cadence")}</span>
            <select value={form.routineCadence} onChange={(event) => onChange({ ...form, routineCadence: event.target.value as TaskRoutineCadence })}>
              {TASK_ROUTINE_CADENCES.map((cadence) => <option key={cadence} value={cadence}>{t(`routine.cadences.${cadence}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("routine.next_run")}</span>
            <input type="date" value={form.routineNextRunDate} onChange={(event) => onChange({ ...form, routineNextRunDate: event.target.value })} />
          </label>
          <label>
            <span>{t("backlog.priority")}</span>
            <select value={form.priority} onChange={(event) => onChange({ ...form, priority: event.target.value as TaskPriority })}>
              {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("backlog.agent")}</span>
            <select value={form.assignedAgent} onChange={(event) => onChange({ ...form, assignedAgent: event.target.value as "" | AgentName })}>
              <option value="">{t("backlog.no_agent")}</option>
              {AGENT_NAMES.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
            </select>
          </label>
          <label className="routine-toggle">
            <span>{t("routine.enabled")}</span>
            <input type="checkbox" checked={form.routineEnabled} onChange={(event) => onChange({ ...form, routineEnabled: event.target.checked })} />
          </label>
        </div>
        <label>
          <span>{t("backlog.assignee")}</span>
          <div className="backlog-assignee-input">
            <ActionAddPerson size={15} />
            <input list="routine-employees" value={form.assigneeEmployeeId} onChange={(event) => onChange({ ...form, assigneeEmployeeId: event.target.value })} />
            <datalist id="routine-employees">
              {employees.map((employee) => <option key={employee} value={employee} />)}
            </datalist>
          </div>
        </label>
        <footer>
          <button type="button" onClick={onClose}>{t("dialog.cancel")}</button>
          <button type="submit" className="backlog-primary" disabled={saving || !form.title.trim()}>
            {saving ? t("admin.saving") : t("dialog.confirm")}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function RoutinePage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation, setStatus }: RoutinePageProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<RoutineFilters>(initialFilters);
  const [form, setForm] = useState<RoutineFormState | null>(null);
  const [saving, setSaving] = useState(false);
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

  function editTask(task: RelayTask) {
    setForm({
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

  async function mutate(label: string, action: () => Promise<unknown>) {
    try {
      await action();
      setStatus({ tone: "good", message: label });
      await onRefresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    }
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
      if (form.id) await updateTask(form.id, payload);
      else await createTask(payload);
      setForm(null);
      setStatus({ tone: "good", message: form.id ? t("routine.toast_updated") : t("routine.toast_created") });
      await onRefresh();
    } catch (err) {
      setStatus({ tone: "bad", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  function linkedSession(task: RelayTask): RelaySession | undefined {
    const latest = task.linkedSessionIds.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  return (
    <section className="routine-page backlog-page" aria-label={t("routine.title")}>
      <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
        <div className="flex min-w-0 items-baseline gap-sm">
          <h1 className="m-0 text-lg font-semibold leading-[1.25] text-balance text-ink">{t("routine.title")}</h1>
          <span className="mono truncate text-xs font-medium text-muted-foreground">{t("routine.sub", { count: routineTasks.length })}</span>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
          <button type="button" className="backlog-icon-btn" aria-label={t("nav.refresh")} onClick={() => void onRefresh()} disabled={isRefreshing}>
            <NavRefresh size={16} />
          </button>
          <Button className="backlog-primary" onClick={() => setForm(emptyForm(currentUser))}>
            <ActionCompose size={16} />
            <span>{t("routine.new")}</span>
          </Button>
        </div>
      </header>

      <RoutineStats tasks={routineTasks} />
      <RoutineFiltersBar filters={filters} onChange={setFilters} />

      {filteredTasks.length === 0 ? (
        <div className="backlog-board-empty">
          <div className="backlog-board-empty-inner">
            <h3>{routineTasks.length === 0 ? t("routine.no_routines_title") : t("routine.no_match_title")}</h3>
            <p>{routineTasks.length === 0 ? t("routine.no_routines_body") : t("routine.no_match_body")}</p>
            {routineTasks.length === 0 ? (
              <Button className="mt-md" size="sm" onClick={() => setForm(emptyForm(currentUser))}>
                <ActionCompose size={16} />
                {t("routine.new")}
              </Button>
            ) : null}
          </div>
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
                ready={agentReadyForTask(task, nodes)}
                onEdit={() => editTask(task)}
                onAssign={(agent) => void mutate(t("backlog.toast_assigned"), () => assignTask(task.id, agent))}
                onStart={() => void mutate(t("backlog.toast_started"), () => startTask(task.id))}
                onOpenThread={() => session && onOpenConversation(session.id)}
                onToggleBlock={() => void mutate(t("backlog.toast_updated"), () => updateTask(task.id, { status: task.status === "blocked" ? "backlog" : "blocked" }))}
                onDone={() => void mutate(t("backlog.toast_updated"), () => updateTask(task.id, { status: "done" }))}
              />
            );
          })}
        </div>
      )}

      {form ? (
        <RoutineDrawer
          form={form}
          employees={employees}
          saving={saving}
          onClose={() => setForm(null)}
          onChange={setForm}
          onSubmit={(event) => void submitRoutine(event)}
        />
      ) : null}
    </section>
  );
}
