"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { AgentStateBadge } from "./AgentStateBadge";
import { PriorityBadge } from "./PriorityBadge";
import { cn } from "@/lib/utils";
import { AGENT_NAMES, type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTask, type TaskStatus } from "../types";
import { ActionApprove, ActionCalendar, ActionSearch, ActionStart, ActionStop, ModeAsk, NavConversations, NavRefresh, ViewBoard, ViewList } from "./icons";
import { agentReadyForTask, discussionAgentsForTask, dueTone, filterTasks, TASK_PRIORITIES, TASK_STATUSES, tasksByStatus, type BacklogFilters } from "../lib/backlog";
import { emptyBacklogForm, taskBoardFormsEqual, type BacklogTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";
import { TaskAssignee } from "./TaskAssignee";
import { readViewPreference, writeViewPreference } from "../lib/viewPreference";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { Button } from "./ui/button";

interface BacklogPageProps {
  tasks: RelayTask[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
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

function parseBacklogFilters(value: string | null): BacklogFilters {
  if (!value) return initialFilters;
  try {
    return { ...initialFilters, ...JSON.parse(value) } as BacklogFilters;
  } catch {
    return initialFilters;
  }
}

function serializeBacklogFilters(value: BacklogFilters): string | null {
  return JSON.stringify(value) === JSON.stringify(initialFilters) ? null : JSON.stringify(value);
}

function parseBacklogView(value: string | null): BacklogView {
  return BACKLOG_VIEWS.includes(value as BacklogView)
    ? value as BacklogView
    : readViewPreference(VIEW_STORAGE_KEY, "list", BACKLOG_VIEWS);
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
          <Button variant="ghost"
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
          </Button>
          {activeCount > 0 ? (
            <Button variant="ghost"
              type="button"
              className="backlog-filter-clear"
              onClick={() => onChange(initialFilters)}
            >
              {t("backlog.clear_filters")}
            </Button>
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
      <Button variant="ghost" type="button" className="backlog-task-title" onClick={onEdit}>{task.title}</Button>
      {task.description ? <p className="backlog-description">{task.description}</p> : null}
      <div className="backlog-meta">
        <TaskAssignee task={task} ready={ready} unassignedLabel={t("backlog.unassigned")} showAgent={false} />
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
          <Button variant="ghost"
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={(!task.assignedAgent && !canDiscuss) || task.status === "running" || task.status === "done"}
            aria-label={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
            title={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </Button>
          <Button variant="ghost"
            type="button"
            className="backlog-action-icon"
            onClick={onDiscuss}
            disabled={!canDiscuss || task.status === "running" || task.status === "done"}
            aria-label={t("backlog.discuss")}
            title={t("backlog.discuss")}
          >
            <ModeAsk size={14} />
          </Button>
        </div>
        {session ? (
          <div className="backlog-action-group">
            <Button variant="ghost" type="button" onClick={onOpenThread}>{t("backlog.open_thread")}</Button>
          </div>
        ) : null}
        <div className="backlog-action-group" aria-label={t("backlog.actions_state")}>
          <Button variant="ghost"
            type="button"
            className={task.status === "blocked" ? undefined : "backlog-action-block"}
            onClick={onToggleBlock}
          >
            {task.status === "blocked" ? t("backlog.reopen") : t("backlog.block")}
          </Button>
          <Button variant="ghost" type="button" className="backlog-action-done" onClick={onDone}>{t("backlog.done")}</Button>
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
  session,
  ready,
  canDiscuss,
  onEdit,
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
        <Button variant="ghost" type="button" className="backlog-row-title" onClick={onEdit}>{task.title}</Button>
      </div>
      <span className="backlog-row-status">{t(`backlog.statuses.${task.status}`)}</span>
      <div className="backlog-row-tags">
        <PriorityBadge priority={task.priority} />
      </div>
      <span className="backlog-row-assignee">
        <TaskAssignee task={task} ready={ready} unassignedLabel={t("backlog.unassigned")} />
      </span>
      <span className={cn("backlog-row-due", tone !== "neutral" && tone)}>
        <ActionCalendar size={13} />
        {task.dueDate || t("backlog.no_due")}
      </span>
      <div className="backlog-row-actions" role="group" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <Button variant="ghost"
            type="button"
            className="backlog-action-primary backlog-action-icon"
            onClick={onStart}
            disabled={(!task.assignedAgent && !canDiscuss) || task.status === "running" || task.status === "done"}
            aria-label={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
            title={task.assignedAgent ? t("backlog.start") : t("backlog.start_team")}
          >
            <ActionStart size={14} />
          </Button>
          <Button variant="ghost"
            type="button"
            className="backlog-action-icon"
            onClick={onDiscuss}
            disabled={!canDiscuss || task.status === "running" || task.status === "done"}
            aria-label={t("backlog.discuss")}
            title={t("backlog.discuss")}
          >
            <ModeAsk size={14} />
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

export function BacklogPage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenConversation }: BacklogPageProps) {
  const { agents: logicalAgents } = useEmployeeAgents(currentUser.employeeId);
  const { t } = useTranslation();
  const {
    startTaskMutation,
    updateTaskMutation,
    createTaskMutation,
  } = useRelayMutations();
  const [filters, setFilters] = useUrlSearchState("backlogFilters", initialFilters, parseBacklogFilters, serializeBacklogFilters);
  const [view, setView] = useUrlSearchState("backlogView", parseBacklogView(null), parseBacklogView, (value) => value);
  const [form, setForm] = useState<BacklogTaskFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<BacklogTaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const formDirty = Boolean(form && formBaseline && !taskBoardFormsEqual(form, formBaseline));
  const confirmDiscardChanges = useUnsavedChangesGuard(formDirty && !saving);
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

  function openTaskForm(next: BacklogTaskFormState) {
    setForm(next);
    setFormBaseline(next);
  }

  async function closeTaskForm() {
    if (saving) return;
    if (!(await confirmDiscardChanges())) return;
    setForm(null);
    setFormBaseline(null);
  }

  function editTask(task: RelayTask) {
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
        assigneeEmployeeId: form.assigneeEmployeeId.trim(),
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

  function linkedSession(task: RelayTask): RelaySession | undefined {
    const latest = task.linkedSessionIds.at(-1);
    return latest ? sessions.find((session) => session.id === latest) : undefined;
  }

  function changeView(next: BacklogView) {
    setView(next);
    writeViewPreference(VIEW_STORAGE_KEY, next);
  }

  function taskHandlers(task: RelayTask, session?: RelaySession) {
    const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
    const discussionAssignments = logicalAgents
      .filter((agent) => agent.enabled && agent.availability === "ready")
      .map((agent) => ({ agentId: agent.id, agent: agent.executorKind, mode: "ask" as const }));
    const fallbackDiscussionAssignments = discussionAgents.map((agent) => ({ agent, mode: "ask" as const }));
    return {
      onEdit: () => editTask(task),
      onStart: () => void startTaskMutation.mutate(
        task.assignedAgent
          ? { taskId: task.id }
          : { taskId: task.id, assignments: discussionAssignments.length > 0 ? discussionAssignments : fallbackDiscussionAssignments },
        {
          onSuccess: (result) => {
            if (!task.assignedAgent && result.session) onOpenConversation(result.session.id);
          },
        },
      ),
      onDiscuss: () => void startTaskMutation.mutate(
        {
          taskId: task.id,
          assignments: discussionAssignments.length > 0 ? discussionAssignments : fallbackDiscussionAssignments,
        },
        {
          onSuccess: (result) => {
            if (result.session) onOpenConversation(result.session.id);
          },
        },
      ),
      onOpenThread: () => session && onOpenConversation(session.id),
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
        kicker={t("nav.backlog")}
        title={t("backlog.title")}
        count={t("backlog.sub", { count: tasks.length })}
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
              onCreate={filtered ? undefined : () => openTaskForm(emptyBacklogForm(currentUser))}
            />
          );
        })()
      ) : view === "list" ? (
        <div className="backlog-rows" role="list" aria-label={t("backlog.title")}>
          <div className="backlog-rows-head" aria-hidden="true">
            <span className="backlog-rows-head-cell backlog-rows-head-lead">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status">{t("backlog.status")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags">{t("backlog.priority")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due">{t("backlog.due")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions">{t("backlog.actions")}</span>
          </div>
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
            return (
              <BacklogTaskRow
                key={task.id}
                task={task}
                session={session}
                ready={agentReadyForTask(task, nodes, logicalAgents)}
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
                  const discussionAgents = discussionAgentsForTask(task, nodes, logicalAgents);
                  return (
                    <BacklogTaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      ready={agentReadyForTask(task, nodes, logicalAgents)}
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
        <TaskDrawer
          form={form}
          employees={employees}
          logicalAgents={logicalAgents}
          saving={saving}
          title={form.id ? t("backlog.edit_task") : t("backlog.new_task")}
          subtitle={form.id ?? t("backlog.new_task_id")}
          employeeDatalistId="backlog-employees"
          onClose={() => { void closeTaskForm(); }}
          onChange={(next) => {
            if (next.variant === "backlog") setForm(next);
          }}
          onSubmit={(event) => void submitTask(event)}
        />
      ) : null}
    </section>
  );
}
