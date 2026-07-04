"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assignTask, createTask, listTaskArtifacts, startTask, updateTask } from "../api";
import { artifactRawHref } from "../lib/artifactPreview";
import { Drawer } from "./admin/Drawer";
import { AgentStateBadge } from "./AgentStateBadge";
import { useArtifactViewer } from "./ArtifactViewerProvider";
import { PriorityBadge } from "./PriorityBadge";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type AgentName, type ArtifactIndexItem, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask, type TaskPriority, type TaskStatus } from "../types";
import { ActionAddPerson, ActionCalendar, ActionSearch, ActionStart, ModeAsk, ViewBoard, ViewList } from "./icons";
import { agentReadyForTask, discussionAgentsForTask, dueTone, filterTasks, TASK_PRIORITIES, TASK_STATUSES, tasksByStatus, type BacklogFilters } from "../lib/backlog";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";

interface BacklogPageProps {
  tasks: RelayTask[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
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

type BacklogView = "board" | "list";

const VIEW_STORAGE_KEY = "relay-web.backlogView";

function readView(): BacklogView {
  if (typeof window === "undefined") return "board";
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

function writeView(view: BacklogView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* storage unavailable — view falls back to default next load */
  }
}

const ACTIVE_STATUSES: TaskStatus[] = ["assigned", "running", "waiting_for_human", "review"];


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
        <div className="backlog-filter-search-wrap">
          <ActionSearch size={15} aria-hidden="true" />
          <input
            className="backlog-filter-search"
            name="backlog-query"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={filters.query}
            placeholder={t("backlog.search")}
            aria-label={t("backlog.search")}
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
            <button
              type="button"
              className="backlog-filter-clear"
              onClick={() => onChange(initialFilters)}
            >
              {t("backlog.clear_filters")}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="backlog-filter-secondary">
          <select
            name="backlog-status-filter"
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
            name="backlog-priority-filter"
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
            name="backlog-agent-filter"
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
            name="backlog-assignee-filter"
            autoComplete="off"
            value={filters.assignee}
            placeholder={t("backlog.assignee_filter")}
            aria-label={t("backlog.assignee_filter")}
            onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
          />
          <select
            name="backlog-due-filter"
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
  canDiscuss,
  onEdit,
  onAssign,
  onStart,
  onDiscuss,
  onOpenThread,
  onToggleBlock,
  onDone,
}: {
  task: RelayTask;
  session?: RelaySession;
  ready: boolean;
  canDiscuss: boolean;
  onEdit: () => void;
  onAssign: (agent: AgentName) => void;
  onStart: () => void;
  onDiscuss: () => void;
  onOpenThread: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);

  return (
    <article className="backlog-task group" data-priority={task.priority}>
      <div className="backlog-task-badges">
        <PriorityBadge priority={task.priority} />
        <AgentStateBadge agent={task.assignedAgent} ready={ready} />
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
      <div className="backlog-task-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <select
            name={`task-${task.id}-agent-card`}
            value={task.assignedAgent ?? ""}
            aria-label={t("backlog.assign_agent")}
            onChange={(event) => {
              const agent = event.target.value as AgentName;
              if (agent) onAssign(agent);
            }}
          >
            <option value="">{t("backlog.agent_team")}</option>
            {AGENT_NAMES.map((agent) => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
          <button
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={(!task.assignedAgent && !canDiscuss) || task.status === "running" || task.status === "done"}
            aria-label={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
            title={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </button>
          <button
            type="button"
            className="backlog-action-icon"
            onClick={onDiscuss}
            disabled={!canDiscuss || task.status === "running" || task.status === "done"}
            aria-label={t("backlog.discuss")}
            title={t("backlog.discuss")}
          >
            <ModeAsk size={14} />
          </button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <button type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</button>
          </div>
        ) : null}
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <button
            type="button"
            className={task.status === "blocked" ? undefined : "backlog-action-block"}
            onClick={onToggleBlock}
          >
            {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          </button>
          <button type="button" className="backlog-action-done" onClick={onDone}>{t("backlog.done")}</button>
        </div>
      </div>
    </article>
  );
}

function BacklogViewToggle({ view, onChange }: { view: BacklogView; onChange: (view: BacklogView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle" role="group" aria-label={t("backlog.view")}>
      <button
        type="button"
        className="backlog-view-btn"
        data-active={view === "board" ? "true" : "false"}
        aria-pressed={view === "board"}
        aria-label={t("backlog.view_board")}
        title={t("backlog.view_board")}
        onClick={() => onChange("board")}
      >
        <ViewBoard size={15} />
      </button>
      <button
        type="button"
        className="backlog-view-btn"
        data-active={view === "list" ? "true" : "false"}
        aria-pressed={view === "list"}
        aria-label={t("backlog.view_list")}
        title={t("backlog.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={15} />
      </button>
    </div>
  );
}

function BacklogTaskRow({
  task,
  session,
  ready,
  canDiscuss,
  onEdit,
  onAssign,
  onStart,
  onDiscuss,
  onOpenThread,
  onToggleBlock,
  onDone,
}: {
  task: RelayTask;
  session?: RelaySession;
  ready: boolean;
  canDiscuss: boolean;
  onEdit: () => void;
  onAssign: (agent: AgentName) => void;
  onStart: () => void;
  onDiscuss: () => void;
  onOpenThread: () => void;
  onToggleBlock: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tone = dueTone(task);

  return (
    <article className="backlog-row group" role="listitem" data-status={task.status} data-priority={task.priority}>
      <div className="backlog-row-lead">
        <span className="backlog-row-dot" aria-hidden="true" />
        <button type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</button>
      </div>
      <span className="backlog-row-status">{t(`backlog.statuses.${task.status}`)}</span>
      <div className="backlog-row-tags">
        <PriorityBadge priority={task.priority} />
        <AgentStateBadge agent={task.assignedAgent} ready={ready} />
      </div>
      <span className="backlog-row-assignee" translate="no">@{task.assigneeEmployeeId ?? task.ownerEmployeeId ?? t("backlog.unassigned")}</span>
      <span className={cn("backlog-row-due", tone !== "neutral" && tone)}>
        <ActionCalendar size={13} />
        {task.dueDate || t("backlog.no_due")}
      </span>
      <div className="backlog-row-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <select
            name={`task-${task.id}-agent-row`}
            value={task.assignedAgent ?? ""}
            aria-label={t("backlog.assign_agent")}
            onChange={(event) => {
              const agent = event.target.value as AgentName;
              if (agent) onAssign(agent);
            }}
          >
            <option value="">{t("backlog.agent_team")}</option>
            {AGENT_NAMES.map((agent) => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
          <button
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={(!task.assignedAgent && !canDiscuss) || task.status === "running" || task.status === "done"}
            aria-label={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
            title={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </button>
          <button
            type="button"
            className="backlog-action-icon"
            onClick={onDiscuss}
            disabled={!canDiscuss || task.status === "running" || task.status === "done"}
            aria-label={t("backlog.discuss")}
            title={t("backlog.discuss")}
          >
            <ModeAsk size={14} />
          </button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <button type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</button>
          </div>
        ) : null}
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <button
            type="button"
            className={task.status === "blocked" ? undefined : "backlog-action-block"}
            onClick={onToggleBlock}
          >
            {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          </button>
          <button type="button" className="backlog-action-done" onClick={onDone}>{t("backlog.done")}</button>
        </div>
      </div>
    </article>
  );
}

function taskArtifactDate(value: string | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function TaskDrawerArtifacts({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation();
  const { open } = useArtifactViewer();
  const [artifacts, setArtifacts] = useState<ArtifactIndexItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setArtifacts(null);
    setFailed(false);
    listTaskArtifacts(taskId, controller.signal)
      .then((response) => setArtifacts(response.artifacts))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [taskId]);

  return (
    <section className="task-drawer-artifacts" aria-label={t("backlog.artifacts")}>
      <h3 className="task-drawer-artifacts-title">
        {t("backlog.artifacts")}
        {artifacts && artifacts.length > 0 ? (
          <span className="task-drawer-artifacts-count mono">{artifacts.length}</span>
        ) : null}
      </h3>
      {failed ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.artifacts_error")}</p>
      ) : artifacts === null ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.artifacts_loading")}</p>
      ) : artifacts.length === 0 ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.artifacts_empty")}</p>
      ) : (
        <ul className="task-drawer-artifact-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id} className="task-drawer-artifact">
              <button
                type="button"
                className="task-drawer-artifact-main"
                onClick={() => open(artifact, artifact.sessionId, artifacts ?? [artifact])}
                title={t("artifact.view_named", { title: artifact.title })}
              >
                <span className={`artifact-kind-tag is-${artifact.kind}`}>
                  {t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind })}
                </span>
                <span className="task-drawer-artifact-name">{artifact.title}</span>
                <span className="task-drawer-artifact-meta mono">
                  {taskArtifactDate(artifact.createdAt, i18n.language)}
                </span>
              </button>
              <a
                className="task-drawer-artifact-download"
                href={artifactRawHref(artifact.sessionId, artifact.id)}
                target="_blank"
                rel="noreferrer"
                download={artifact.title}
              >
                {t("backlog.artifact_download")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const title = form.id ? t("backlog.edit_task") : t("backlog.new_task");

  return (
    <Drawer
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={title}
      subtitle={form.id ?? t("backlog.new_task_id")}
      variant="light"
      width={420}
      closeLabel={t("dialog.cancel")}
      ariaLabel={title}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form task-board-drawer-form" onSubmit={onSubmit}>
        <label className="adm-field">
          <span>{t("backlog.title_field")}</span>
          <Input
            name="task-title"
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("backlog.description")}</span>
          <Textarea
            name="task-description"
            value={form.description}
            rows={5}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
          />
        </label>
        <div className="task-drawer-form-grid">
          <label className="adm-field">
            <span>{t("backlog.priority")}</span>
            <select
              name="task-priority"
              value={form.priority}
              onChange={(event) => onChange({ ...form, priority: event.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</option>
              ))}
            </select>
          </label>
          <label className="adm-field">
            <span>{t("backlog.status")}</span>
            <select
              name="task-status"
              value={form.status}
              onChange={(event) => onChange({ ...form, status: event.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>{t(`backlog.statuses.${status}`)}</option>
              ))}
            </select>
          </label>
          <label className="adm-field">
            <span>{t("backlog.due")}</span>
            <Input
              name="task-due-date"
              type="date"
              value={form.dueDate}
              onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
            />
          </label>
          <label className="adm-field">
            <span>{t("backlog.agent")}</span>
            <select
              name="task-agent"
              value={form.assignedAgent}
              onChange={(event) => onChange({ ...form, assignedAgent: event.target.value as "" | AgentName })}
            >
              <option value="">{t("backlog.agent_team")}</option>
              {AGENT_NAMES.map((agent) => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="adm-field">
          <span>{t("backlog.assignee")}</span>
          <div className="task-drawer-assignee">
            <ActionAddPerson size={15} aria-hidden="true" />
            <Input
              name="task-assignee"
              list="backlog-employees"
              value={form.assigneeEmployeeId}
              onChange={(event) => onChange({ ...form, assigneeEmployeeId: event.target.value })}
              className="h-auto min-h-0 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:shadow-none"
            />
            <datalist id="backlog-employees">
              {employees.map((employee) => <option key={employee} value={employee} />)}
            </datalist>
          </div>
        </label>
        <div className="adm-form-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" disabled={saving || !form.title.trim()}>
            {saving ? t("admin.saving") : t("dialog.confirm")}
          </Button>
        </div>
      </form>
      {form.id ? <TaskDrawerArtifacts taskId={form.id} /> : null}
    </Drawer>
  );
}

export function BacklogPage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation }: BacklogPageProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<BacklogFilters>(initialFilters);
  const [view, setView] = useState<BacklogView>(readView);
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

  async function mutate(action: () => Promise<unknown>) {
    try {
      await action();
      await onRefresh();
    } catch {
      // task mutations fail silently; the board refreshes on the next poll.
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
      await onRefresh();
    } catch {
      // form submit errors are silent; the drawer stays open for retry.
    } finally {
      setSaving(false);
    }
  }

  function linkedSession(task: RelayTask): RelaySession | undefined {
    const latest = task.linkedSessionIds.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  function changeView(next: BacklogView) {
    setView(next);
    writeView(next);
  }

  function taskHandlers(task: RelayTask, session?: RelaySession) {
    const discussionAgents = discussionAgentsForTask(task, nodes);
    return {
      onEdit: () => editTask(task),
      onAssign: (agent: AgentName) => void mutate(() => assignTask(task.id, agent)),
      onStart: () => void mutate(async () => {
        const result = task.assignedAgent
          ? await startTask(task.id)
          : await startTask(task.id, {
            assignments: discussionAgents.map((agent) => ({ agent, mode: "ask" })),
          });
        if (!task.assignedAgent && result.session) onOpenConversation(result.session.id);
      }),
      onDiscuss: () => void mutate(async () => {
        if (discussionAgents.length === 0) return;
        const result = await startTask(task.id, {
          assignments: discussionAgents.map((agent) => ({ agent, mode: "ask" })),
        });
        if (result.session) onOpenConversation(result.session.id);
      }),
      onOpenThread: () => session && onOpenConversation(session.id),
      onToggleBlock: () => void mutate(
        () => updateTask(task.id, { status: task.status === "blocked" ? "backlog" : "blocked" }),
      ),
      onDone: () => void mutate(() => updateTask(task.id, { status: "done" })),
    };
  }

  return (
    <section className="backlog-page" data-density="compact" aria-label={t("backlog.title")}>
      <PageHeader
        title={t("backlog.title")}
        count={t("backlog.sub", { count: tasks.length })}
        actions={
          <TaskBoardHeaderActions
            leading={<BacklogViewToggle view={view} onChange={changeView} />}
            refreshLabel={t("nav.refresh")}
            createLabel={t("backlog.new_task")}
            isRefreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            onCreate={() => setForm(emptyForm(currentUser))}
          />
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
      ) : view === "list" ? (
        <div className="backlog-rows" role="list" aria-label={t("backlog.title")}>
          <div className="backlog-rows-head" aria-hidden="true">
            <span className="backlog-rows-head-cell backlog-rows-head-lead">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status">{t("backlog.status")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags">{t("backlog.col_labels")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due">{t("backlog.due")}</span>
          </div>
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            const discussionAgents = discussionAgentsForTask(task, nodes);
            return (
              <BacklogTaskRow
                key={task.id}
                task={task}
                session={session}
                ready={agentReadyForTask(task, nodes)}
                canDiscuss={discussionAgents.length > 0}
                {...taskHandlers(task, session)}
              />
            );
          })}
        </div>
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
                  const session = linkedSession(task);
                  const discussionAgents = discussionAgentsForTask(task, nodes);
                  return (
                    <BacklogTaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      ready={agentReadyForTask(task, nodes)}
                      canDiscuss={discussionAgents.length > 0}
                      {...taskHandlers(task, session)}
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
