"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useTeams } from "../hooks/useTeams";
import { useDialogs } from "@/components/ui/DialogProvider";
import { PriorityBadge } from "./PriorityBadge";
import { cn } from "@/lib/utils";
import { type CurrentUser, type DaemonNodeMonitorRecord, type EmployeeAgent, type RelaySession, type RelayTaskListItem } from "../types";
import { ActionCalendar, ActionStart, ViewGrid, ViewList } from "./icons";
import { agentReadyForTask } from "../lib/backlog";
import { TaskAssignee, TaskExecutionBadge } from "./TaskAssignee";
import { isTaskAssigneeCurrentUser, taskAssigneeDisplayName, teamReady } from "../lib/taskAssignment";
import { useEmployeeNames } from "../hooks/useEmployeeNames";
import { readViewPreference, writeViewPreference } from "../lib/viewPreference";
import { filterRoutineTasks, latestRoutineSession, routineDueTone, routineState, runningRoutineCount, runningRoutineIds, TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, type RoutineFilters, type RoutineState } from "../lib/routine";
import { ROUTINE_STATE_SHAPE, RoutineStateBadge } from "./RoutineStateBadge";
import { StateMark } from "./StateMark";
import { emptyRoutineForm, taskAssignmentMutationFields, taskBoardFormsEqual, type RoutineTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";
import { Button, buttonVariants } from "./ui/button";
import { FiltersBar, FilterSelect } from "./FiltersBar";
import { hrefForRoute } from "../lib/appRoute";

interface RoutinesPageProps {
  tasks: RelayTaskListItem[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
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

function parseRoutineView(value: string | null): RoutineView {
  return ROUTINE_VIEWS.includes(value as RoutineView)
    ? value as RoutineView
    : readViewPreference(ROUTINE_VIEW_STORAGE_KEY, "card", ROUTINE_VIEWS);
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

function RoutineStats({ routines, tasks }: { routines: RelayTaskListItem[]; tasks: RelayTaskListItem[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const enabled = routines.filter((task) => task.routineEnabled).length;
    const due = routines.filter((task) => routineDueTone(task) !== "neutral").length;
    const running = runningRoutineCount(routines, tasks);
    return { total: routines.length, enabled, due, running };
  }, [routines, tasks]);

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

function RoutineFiltersBar({ filters, agents, onChange }: { filters: RoutineFilters; agents: EmployeeAgent[]; onChange: (next: RoutineFilters) => void }) {
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
      <FilterSelect
        name="routine-type-filter"
        label={t("routine.type")}
        value={filters.type}
        onValueChange={(type) => onChange({ ...filters, type })}
        options={[
          { value: "all" as const, label: t("routine.all_types") },
          ...TASK_ROUTINE_TYPES.map((type) => ({ value: type, label: t(`routine.types.${type}`) })),
        ]}
      />
      <FilterSelect
        name="routine-cadence-filter"
        label={t("routine.cadence")}
        value={filters.cadence}
        onValueChange={(cadence) => onChange({ ...filters, cadence })}
        options={[
          { value: "all" as const, label: t("routine.all_cadences") },
          ...TASK_ROUTINE_CADENCES.map((cadence) => ({
            value: cadence,
            label: t(`routine.cadences.${cadence}`),
          })),
        ]}
      />
      <FilterSelect
        name="routine-agent-filter"
        label={t("backlog.agent")}
        value={filters.agent}
        onValueChange={(agent) => onChange({ ...filters, agent })}
        options={[
          { value: "all", label: t("backlog.all_agents") },
          ...agents.map((agent) => ({ value: agent.id, label: agent.displayName })),
        ]}
      />
      <Input name="routine-assignee-filter" autoComplete="off" spellCheck={false} value={filters.assignee} placeholder={t("backlog.assignee_filter")} aria-label={t("backlog.assignee_filter")} onChange={(event) => onChange({ ...filters, assignee: event.target.value })} />
      <FilterSelect
        name="routine-state-filter"
        label={t("routine.state")}
        value={filters.state}
        onValueChange={(state) => onChange({ ...filters, state })}
        options={[
          { value: "all", label: t("routine.all_states") },
          { value: "enabled", label: t("routine.enabled") },
          { value: "disabled", label: t("routine.disabled") },
          { value: "due", label: t("routine.due") },
          { value: "unscheduled", label: t("routine.unscheduled") },
        ]}
      />
    </FiltersBar>
  );
}

function RoutineStartButton({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      type="button"
      className="icon-button icon-button--sm icon-button--tinted backlog-action-icon"
      onClick={onStart}
      disabled={disabled}
      aria-label={t("backlog.start")}
      title={t("backlog.start")}
    >
      <ActionStart size={14} />
    </Button>
  );
}

function RoutineCard({
  task,
  state,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  onEdit,
  onStart,
}: {
  task: RelayTaskListItem;
  state: RoutineState;
  session?: RelaySession;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  onEdit: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);
  const startDisabled = (!task.assignedAgentId && !task.assignedTeamId) || !task.routineEnabled;

  // `data-routine-state`, not `data-status`: a routine definition never moves
  // through the board, so its `status` field is a constant and styling on it
  // paints every card the same.
  return (
    <article className="routine-card backlog-task list-virtual" data-priority={task.priority} data-routine-state={state}>
      <div className="backlog-task-badges">
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
          <ActionCalendar size={13} />
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
          <RoutineStartButton disabled={startDisabled} onStart={onStart} />
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
  state,
  session,
  ready,
  assigneeDisplayName,
  assigneeIsSelf,
  agentDisplayName,
  onEdit,
  onStart,
}: {
  task: RelayTaskListItem;
  state: RoutineState;
  session?: RelaySession;
  ready: boolean;
  assigneeDisplayName?: string;
  assigneeIsSelf?: boolean;
  agentDisplayName?: string;
  onEdit: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const tone = routineDueTone(task);
  const startDisabled = (!task.assignedAgentId && !task.assignedTeamId) || !task.routineEnabled;

  return (
    <article className="backlog-row group list-virtual" role="row" data-routine-state={state} data-priority={task.priority}>
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
        <ActionCalendar size={13} />
        {task.routineNextRunDate ? formatNextRunDate(task.routineNextRunDate) : t("routine.no_next_run")}
      </span>
      <div className="backlog-row-actions" role="cell" aria-label={t("backlog.actions")}>
        <div className="backlog-action-group" aria-label={t("backlog.actions_dispatch")}>
          <RoutineStartButton disabled={startDisabled} onStart={onStart} />
        </div>
      </div>
    </article>
  );
}

function RoutineDrawerMeta({
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

export function RoutinesPage({ tasks, sessions, nodes, currentUser, isRefreshing, onRefresh, onOpenThread }: RoutinesPageProps) {
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
  const [view, setView] = useState<RoutineView>(() => parseRoutineView(null));
  const [form, setForm] = useState<RoutineTaskFormState | null>(null);
  const [formBaseline, setFormBaseline] = useState<RoutineTaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const formDirty = Boolean(form && formBaseline && !taskBoardFormsEqual(form, formBaseline));
  const confirmDiscardChanges = useUnsavedChangesGuard(formDirty && !saving && !deleting);
  const routineTasks = useMemo(() => tasks.filter((task) => task.isRoutine), [tasks]);
  const filteredTasks = useMemo(() => filterRoutineTasks(tasks, filters), [tasks, filters]);
  // Derived once for the whole board: `routineState` then costs a Set lookup
  // per card instead of a full task scan.
  const runningIds = useMemo(() => runningRoutineIds(tasks), [tasks]);
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

  function editTask(task: RelayTaskListItem) {
    openRoutineForm({
      variant: "routine",
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeEmployeeId: task.assigneeEmployeeId ?? task.ownerEmployeeId ?? currentUser.employeeId ?? currentUser.username,
      assignedAgent: task.assignedAgent ?? "",
      assignedAgentId: task.assignedAgentId ?? "",
      assignedTeamId: task.assignedTeamId ?? "",
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
        isRoutine: true,
        routineType: form.routineType,
        routineCadence: form.routineCadence,
        routineEnabled: form.routineEnabled,
        ...(form.routineCadence === "custom"
          ? { routineNextRunDate: form.routineNextRunDate }
          : {}),
        ...taskAssignmentMutationFields(form),
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
      confirmLabel: t("routine.delete_task"),
      cancelLabel: t("dialog.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteTaskMutation.mutateAsync({ taskId: form.id });
      setForm(null);
      setFormBaseline(null);
      announce({ message: t("routine.toast_deleted"), tone: "success" });
    } catch {
      // mutation onError surfaces a toast; keep the drawer open for retry.
    } finally {
      setDeleting(false);
    }
  }

  function linkedSession(task: RelayTaskListItem): RelaySession | undefined {
    return latestRoutineSession(task, tasks, sessions);
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

  const editingTask = form?.id ? tasks.find((task) => task.id === form.id) : undefined;
  const editingSession = editingTask ? linkedSession(editingTask) : undefined;

  function routineHandlers(task: RelayTaskListItem) {
    return {
      onEdit: () => editTask(task),
      onStart: () => void startTaskMutation.mutate({ taskId: task.id }),
    };
  }

  return (
    <section id="routine-panel" className="routine-page backlog-page" aria-label={t("routine.title")} tabIndex={-1}>
      <PageHeader
        kicker={t("nav.workspace")}
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

      <RoutineStats routines={routineTasks} tasks={tasks} />
      <RoutineFiltersBar filters={filters} agents={logicalAgents} onChange={setFilters} />

      {filteredTasks.length === 0 ? (
        <BoardEmpty
          title={routineTasks.length === 0 ? t("routine.no_routines_title") : t("routine.no_match_title")}
          body={routineTasks.length === 0 ? t("routine.no_routines_body") : t("routine.no_match_body")}
          createLabel={routineTasks.length === 0 ? t("routine.new") : undefined}
          onCreate={routineTasks.length === 0 ? () => openRoutineForm(emptyRoutineForm(currentUser)) : undefined}
        />
      ) : view === "list" ? (
        <div className="backlog-rows" role="table" aria-label={t("routine.title")}>
          <div className="backlog-rows-head" role="row">
            <span className="backlog-rows-head-cell backlog-rows-head-dot" role="columnheader" />
            <span className="backlog-rows-head-cell backlog-rows-head-lead" role="columnheader">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status" role="columnheader">{t("routine.state")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags" role="columnheader">{t("backlog.priority")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee" role="columnheader">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due" role="columnheader">{t("routine.next_run")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions" role="columnheader">{t("backlog.actions")}</span>
          </div>
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            const assignment = taskAssignmentDisplay(task);
            return (
              <RoutineRow
                key={task.id}
                task={task}
                state={routineState(task, runningIds)}
                session={session}
                assigneeDisplayName={taskAssigneeDisplayName(task, currentUser, employeeNames)}
                assigneeIsSelf={isTaskAssigneeCurrentUser(task, currentUser)}
                agentDisplayName={assignment.name}
                ready={assignment.ready}
                {...routineHandlers(task)}
              />
            );
          })}
        </div>
      ) : (
        <div className="routine-list">
          {filteredTasks.map((task) => {
            const session = linkedSession(task);
            const assignment = taskAssignmentDisplay(task);
            return (
              <RoutineCard
                key={task.id}
                task={task}
                state={routineState(task, runningIds)}
                session={session}
                assigneeDisplayName={taskAssigneeDisplayName(task, currentUser, employeeNames)}
                assigneeIsSelf={isTaskAssigneeCurrentUser(task, currentUser)}
                agentDisplayName={assignment.name}
                ready={assignment.ready}
                {...routineHandlers(task)}
              />
            );
          })}
        </div>
      )}

      {form ? (
        <TaskDrawer
          form={form}
          logicalAgents={logicalAgents}
          teams={teams}
          saving={saving}
          deleting={deleting}
          title={form.id ? t("routine.edit") : t("routine.new")}
          subtitle={form.id
            ? `${t(`routine.types.${form.routineType}`)} · ${t(`routine.cadences.${form.routineCadence}`)}`
            : t("routine.new_routine_id")}
          meta={editingTask ? (
            <RoutineDrawerMeta
              task={editingTask}
              state={routineState(editingTask, runningIds)}
              session={editingSession}
              onOpenThread={onOpenThread}
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
