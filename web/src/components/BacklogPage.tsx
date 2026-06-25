"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignTask, createTask, startTask, updateTask } from "../api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type AgentName, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask, type TaskPriority, type TaskStatus, type Tone } from "../types";
import { ActionAddPerson, ActionCalendar, ActionCompose, ActionRemove, ActionSearch, ActionStart, NavRefresh } from "./icons";
import { agentReadyForTask, dueTone, filterTasks, TASK_PRIORITIES, TASK_STATUSES, tasksByStatus, type BacklogFilters } from "../lib/backlog";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { useModalDrawer } from "../hooks/useModalDrawer";

type StatusUpdate = { tone: Tone; message: string };

interface BacklogPageProps {
  tasks: RelayTask[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
  setStatus: (status: StatusUpdate) => void;
}

type TaskFormState = {
  id?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  assigneeEmployeeId: string;
  assignedAgent: "" | AgentName;
};

const emptyForm = (currentUser: CurrentUser): TaskFormState => ({
  title: "",
  description: "",
  priority: "normal",
  status: "backlog",
  dueDate: "",
  assigneeEmployeeId: currentUser.employeeId ?? currentUser.username,
  assignedAgent: "",
});

const initialFilters: BacklogFilters = {
  query: "",
  status: "all",
  priority: "all",
  agent: "all",
  assignee: "",
  due: "all",
};

const ACTIVE_STATUSES: TaskStatus[] = ["assigned", "running", "waiting_for_human", "review"];

const PRIORITY_BADGE: Record<TaskPriority, "danger" | "info" | "neutral"> = {
  high: "danger",
  normal: "info",
  low: "neutral",
};

function activeFilterCount(filters: BacklogFilters): number {
  let count = 0;
  if (filters.status !== "all") count += 1;
  if (filters.priority !== "all") count += 1;
  if (filters.agent !== "all") count += 1;
  if (filters.assignee.trim()) count += 1;
  if (filters.due !== "all") count += 1;
  return count;
}

function BacklogStats({ tasks }: { tasks: RelayTask[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const active = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    const overdue = tasks.filter((task) => dueTone(task) === "bad").length;
    return { total: tasks.length, active, blocked, overdue };
  }, [tasks]);

  return (
    <div className="backlog-stats" aria-label={t("backlog.metrics")}>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_active")}</span>
        <span className="backlog-stat-value tone-active">{stats.active}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_blocked")}</span>
        <span className={cn("backlog-stat-value", stats.blocked > 0 && "tone-blocked")}>{stats.blocked}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_overdue")}</span>
        <span className={cn("backlog-stat-value", stats.overdue > 0 && "tone-overdue")}>{stats.overdue}</span>
      </div>
    </div>
  );
}

function BacklogFiltersBar({
  filters,
  onChange,
}: {
  filters: BacklogFilters;
  onChange: (next: BacklogFilters) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="backlog-filter-bar" aria-label={t("backlog.filters")}>
      <div className="backlog-filter-primary">
        <ActionSearch size={15} aria-hidden="true" />
        <input
          className="backlog-filter-search"
          value={filters.query}
          placeholder={t("backlog.search")}
          aria-label={t("backlog.search")}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
        <button
          type="button"
          className="backlog-filter-chip"
          data-active={expanded ? "true" : "false"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("backlog.hide_filters") : t("backlog.show_filters")}
          {activeCount > 0 ? ` · ${activeCount}` : ""}
        </button>
        {activeCount > 0 ? (
          <button
            type="button"
            className="backlog-filter-chip"
            onClick={() => onChange(initialFilters)}
          >
            {t("backlog.clear_filters")}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="backlog-filter-secondary">
          <select
            value={filters.status}
            aria-label={t("backlog.status")}
            onChange={(event) => onChange({ ...filters, status: event.target.value as BacklogFilters["status"] })}
          >
            <option value="all">{t("backlog.all_statuses")}</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{t(`backlog.statuses.${status}`)}</option>
            ))}
          </select>
          <select
            value={filters.priority}
            aria-label={t("backlog.priority")}
            onChange={(event) => onChange({ ...filters, priority: event.target.value as BacklogFilters["priority"] })}
          >
            <option value="all">{t("backlog.all_priorities")}</option>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</option>
            ))}
          </select>
          <select
            value={filters.agent}
            aria-label={t("backlog.agent")}
            onChange={(event) => onChange({ ...filters, agent: event.target.value as BacklogFilters["agent"] })}
          >
            <option value="all">{t("backlog.all_agents")}</option>
            {AGENT_NAMES.map((agent) => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
          <input
            value={filters.assignee}
            placeholder={t("backlog.assignee_filter")}
            aria-label={t("backlog.assignee_filter")}
            onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
          />
          <select
            value={filters.due}
            aria-label={t("backlog.due")}
            onChange={(event) => onChange({ ...filters, due: event.target.value as BacklogFilters["due"] })}
          >
            <option value="all">{t("backlog.all_due")}</option>
            <option value="overdue">{t("backlog.overdue")}</option>
            <option value="today">{t("backlog.today")}</option>
            <option value="unscheduled">{t("backlog.unscheduled")}</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

function BacklogTaskCard({
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
  const tone = dueTone(task);

  return (
    <article className="backlog-task group" data-priority={task.priority}>
      <div className="backlog-task-badges">
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
          {task.dueDate || t("backlog.no_due")}
        </span>
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
          {AGENT_NAMES.map((agent) => (
            <option key={agent} value={agent}>{agent}</option>
          ))}
        </select>
        <button
          type="button"
          className="backlog-action-primary"
          onClick={onStart}
          disabled={!task.assignedAgent || task.status === "running" || task.status === "done"}
        >
          <ActionStart size={14} />
          {t("backlog.start")}
        </button>
        {session ? (
          <button type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</button>
        ) : null}
        <button type="button" onClick={onToggleBlock}>
          {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
        </button>
        <button type="button" onClick={onDone}>{t("backlog.done")}</button>
      </div>
    </article>
  );
}

function BacklogTaskDrawer({
  form,
  employees,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  form: TaskFormState;
  employees: string[];
  saving: boolean;
  onClose: () => void;
  onChange: (next: TaskFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useModalDrawer<HTMLFormElement>(onClose);

  return (
    <div className="backlog-drawer-shell">
      <button type="button" className="backlog-drawer-scrim" aria-label={t("dialog.cancel")} onClick={onClose} />
      <form
        ref={panelRef}
        className="backlog-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={form.id ? t("backlog.edit_task") : t("backlog.new_task")}
        tabIndex={-1}
        onSubmit={onSubmit}
      >
        <header>
          <div>
            <h2>{form.id ? t("backlog.edit_task") : t("backlog.new_task")}</h2>
            <p>{form.id ?? t("backlog.new_task_id")}</p>
          </div>
          <button type="button" className="backlog-icon-btn" aria-label={t("dialog.cancel")} onClick={onClose}>
            <ActionRemove size={16} />
          </button>
        </header>
        <label>
          <span>{t("backlog.title_field")}</span>
          <input
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          <span>{t("backlog.description")}</span>
          <textarea
            value={form.description}
            rows={5}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
          />
        </label>
        <div className="backlog-form-grid">
          <label>
            <span>{t("backlog.priority")}</span>
            <select
              value={form.priority}
              onChange={(event) => onChange({ ...form, priority: event.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("backlog.status")}</span>
            <select
              value={form.status}
              onChange={(event) => onChange({ ...form, status: event.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>{t(`backlog.statuses.${status}`)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("backlog.due")}</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
            />
          </label>
          <label>
            <span>{t("backlog.agent")}</span>
            <select
              value={form.assignedAgent}
              onChange={(event) => onChange({ ...form, assignedAgent: event.target.value as "" | AgentName })}
            >
              <option value="">{t("backlog.no_agent")}</option>
              {AGENT_NAMES.map((agent) => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>{t("backlog.assignee")}</span>
          <div className="backlog-assignee-input">
            <ActionAddPerson size={15} />
            <input
              list="backlog-employees"
              value={form.assigneeEmployeeId}
              onChange={(event) => onChange({ ...form, assigneeEmployeeId: event.target.value })}
            />
            <datalist id="backlog-employees">
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

export function BacklogPage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation, setStatus }: BacklogPageProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<BacklogFilters>(initialFilters);
  const [form, setForm] = useState<TaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const filteredTasks = useMemo(() => filterTasks(tasks, filters), [tasks, filters]);
  const grouped = useMemo(() => tasksByStatus(filteredTasks), [filteredTasks]);
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

  const hasFilterResults = filteredTasks.length > 0;
  const showEmptyBoard = tasks.length === 0 || !hasFilterResults;

  function editTask(task: RelayTask) {
    setForm({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate ?? "",
      assigneeEmployeeId: task.assigneeEmployeeId ?? task.ownerEmployeeId ?? currentUser.employeeId ?? currentUser.username,
      assignedAgent: task.assignedAgent ?? "",
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
        assigneeEmployeeId: form.assigneeEmployeeId.trim(),
        ...(form.assignedAgent ? { assignedAgent: form.assignedAgent } : {}),
      };
      if (form.id) await updateTask(form.id, payload);
      else await createTask(payload);
      setForm(null);
      setStatus({ tone: "good", message: form.id ? t("backlog.toast_updated") : t("backlog.toast_created") });
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
    <section className="backlog-page" aria-label={t("backlog.title")}>
      <PageHeader
        title={t("backlog.title")}
        count={t("backlog.sub", { count: tasks.length })}
        actions={
          <>
            <button
              type="button"
              className="backlog-icon-btn"
              aria-label={t("nav.refresh")}
              onClick={() => void onRefresh()}
              disabled={isRefreshing}
            >
              <NavRefresh size={16} />
            </button>
            <button type="button" className="backlog-primary" onClick={() => setForm(emptyForm(currentUser))}>
              <ActionCompose size={16} />
              <span>{t("backlog.new_task")}</span>
            </button>
          </>
        }
      />

      <BacklogStats tasks={tasks} />
      <BacklogFiltersBar filters={filters} onChange={setFilters} />

      {showEmptyBoard ? (
        (() => {
          const filtered = tasks.length > 0 && !hasFilterResults;
          return (
            <BoardEmpty
              title={filtered ? t("backlog.no_match_title") : t("backlog.no_tasks_title")}
              body={filtered ? t("backlog.no_match_body") : t("backlog.no_tasks_body")}
              createLabel={filtered ? undefined : t("backlog.new_task")}
              onCreate={filtered ? undefined : () => setForm(emptyForm(currentUser))}
            />
          );
        })()
      ) : (
        <div className="backlog-board">
          {TASK_STATUSES.map((status) => (
            <section key={status} className="backlog-lane" data-status={status} aria-label={t(`backlog.statuses.${status}`)}>
              <header className="backlog-lane-head">
                <span className="backlog-lane-label">{t(`backlog.statuses.${status}`)}</span>
                <span className="backlog-lane-count">{grouped[status].length}</span>
              </header>
              <div className="backlog-task-list">
                {grouped[status].length === 0 ? (
                  <p className="backlog-empty">{t("backlog.empty_lane")}</p>
                ) : grouped[status].map((task) => {
                  const ready = agentReadyForTask(task, nodes);
                  const session = linkedSession(task);
                  return (
                    <BacklogTaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      ready={ready}
                      onEdit={() => editTask(task)}
                      onAssign={(agent) => void mutate(t("backlog.toast_assigned"), () => assignTask(task.id, agent))}
                      onStart={() => void mutate(t("backlog.toast_started"), () => startTask(task.id))}
                      onOpenThread={() => session && onOpenConversation(session.id)}
                      onToggleBlock={() => void mutate(
                        t("backlog.toast_updated"),
                        () => updateTask(task.id, { status: task.status === "blocked" ? "backlog" : "blocked" }),
                      )}
                      onDone={() => void mutate(t("backlog.toast_updated"), () => updateTask(task.id, { status: "done" }))}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {form ? (
        <BacklogTaskDrawer
          form={form}
          employees={employees}
          saving={saving}
          onClose={() => setForm(null)}
          onChange={setForm}
          onSubmit={(event) => void submitTask(event)}
        />
      ) : null}
    </section>
  );
}
