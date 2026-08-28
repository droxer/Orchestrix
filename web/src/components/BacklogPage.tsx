"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useTeams } from "../hooks/useTeams";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  ActionAdd,
  ActionApprove,
  ActionCalendar,
  ActionStart,
  ActionStop,
  ICON,
  NavAgents,
  NavRefresh,
  ViewBoard,
  ViewList,
} from "./icons";
import { agentReadyForTask, canDiscussTask, discussionAgentsForTask, filterTasks, isTaskStatus, TASK_STATUSES, tasksByStatus } from "../lib/backlog";
import { readDraggedTaskId, TASK_DRAG_MEDIA_TYPE, taskDropRejection } from "../lib/taskDrag";
import { emptyBacklogForm, taskAssignmentMutationFields, taskBoardFormsEqual, taskStartMutationInput, type BacklogTaskFormState } from "../lib/taskBoardForm";
import { TaskDrawer } from "./task-board/TaskDrawer";
import { InlineTaskCreate } from "./task-board/InlineTaskCreate";
import { taskCreateIntent } from "../lib/taskCreateIntent";
import { PageHeader } from "./PageHeader";
import { BoardEmpty } from "./BoardEmpty";
import { TaskBoardHeaderActions } from "./TaskBoardHeaderActions";
import { isTaskAssigneeCurrentUser, taskAssigneeDisplayName, teamReady } from "../lib/taskAssignment";
import { type CurrentUser, type DaemonNodeMonitorRecord, type RelaySession, type RelayTaskListItem, type TaskStatus } from "../types";
import { useEmployeeNames } from "../hooks/useEmployeeNames";
import { useEdgeAutoScroll } from "../hooks/useEdgeAutoScroll";
import { useTouchTaskDrag } from "../hooks/useTouchTaskDrag";
import { laneStatusAtPoint, type DragPoint } from "../lib/touchDrag";
import { writeViewPreference } from "../lib/viewPreference";
import { Button } from "@/components/ui/button";


interface BacklogPageProps {
  tasks: RelayTaskListItem[];
  sessions: RelaySession[];
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
}

import {
  ACTIVE_STATUSES,
  activeFilterCount,
  VIEW_STORAGE_KEY,
  initialFilters,
  parseBacklogView,
  TASK_STATUS_SHAPE,
  type BacklogView,
} from "./task-board/backlogVocabulary";
import { BacklogStats, BacklogFiltersBar, BacklogViewToggle } from "./task-board/BacklogChrome";
import { BacklogTaskCard, BacklogTaskRow } from "./task-board/BacklogRecords";





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
  const [assignmentFocus, setAssignmentFocus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<TaskStatus | null>(null);
  // The lane whose inline create field is open, if any. Also the target
  // status for an inline create committed from the list view.
  const [inlineCreateStatus, setInlineCreateStatus] = useState<TaskStatus | null>(null);
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

  // The `c` chord and the palette's "New task" land here: the event path
  // covers an already-mounted board, the one-shot flag covers the navigation
  // that mounts it. Inline creation always seeds the backlog lane.
  useEffect(() => {
    const channel = taskCreateIntent();
    if (!channel) return;
    const openInlineCreate = () => {
      if (channel.consume()) setInlineCreateStatus("backlog");
    };
    openInlineCreate();
    return channel.subscribe(openInlineCreate);
  }, []);

  // Rapid-entry commit: on success the field stays open (Linear's card
  // creation rhythm); on failure the mutation's toast speaks and the text
  // stays put for a retry.
  async function submitInlineCreate(title: string): Promise<boolean> {
    if (!inlineCreateStatus) return false;
    try {
      await createTaskMutation.mutateAsync({ title, status: inlineCreateStatus });
      return true;
    } catch {
      return false;
    }
  }

  function openTaskForm(next: BacklogTaskFormState) {
    setForm(next);
    setFormBaseline(next);
    setDrawerOpen(true);
  }

  // Quick-assign entry from a card/row: same drawer, focus on the picker.
  function assignTask(task: RelayTaskListItem) {
    setAssignmentFocus(true);
    editTask(task);
  }

  // The drawer calls this after its exit animation completes — only then is
  // the form released, so every exit (save, delete, discard) animates out.
  function releaseTaskForm() {
    setForm(null);
    setFormBaseline(null);
    setAssignmentFocus(false);
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
    // The cursor must agree with the drop: a lane that refuses the drop (own
    // lane, or any rejection) reports "none", never a move it won't honour.
    const refused = draggedTask.status === status || Boolean(taskDropRejection(draggedTask, status));
    event.dataTransfer.dropEffect = refused ? "none" : "move";
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
      .map((agent) => ({ agentId: agent.id, agent: agent.executorKind }));
    return {
      onEdit: () => editTask(task),
      onAssign: () => assignTask(task),
      onStart: () => void startTaskMutation.mutate(
        taskStartMutationInput(task, discussionAssignments),
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
    <section id="backlog-panel" className="backlog-page" data-view={view} aria-label={t("backlog.title")} tabIndex={-1}>
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

      {backlogTasks.length > 0 ? (
        <>
          <BacklogStats tasks={backlogTasks} />
          <BacklogFiltersBar filters={filters} agents={logicalAgents} onChange={setFilters} />
        </>
      ) : null}

      {showEmptyBoard ? (
        (() => {
          const filtered = backlogTasks.length > 0 && !hasFilterResults;
          return (
            <BoardEmpty
              title={filtered ? t("backlog.no_match_title") : t("backlog.no_tasks_title")}
              body={filtered ? t("backlog.no_match_body") : t("backlog.no_tasks_body")}
              createLabel={filtered ? undefined : t("backlog.new_task")}
              onCreate={filtered ? undefined : () => openTaskForm(emptyBacklogForm(currentUser))}
              clearLabel={filtered ? t("backlog.clear_filters") : undefined}
              onClear={filtered ? () => setFilters(initialFilters) : undefined}
            />
          );
        })()
      ) : view === "list" ? (
        <div className="backlog-rows" role="table" data-density="compact" aria-label={t("backlog.title")}>
          <div className="backlog-rows-head" role="row">
            <span className="backlog-rows-head-cell backlog-rows-head-dot" role="columnheader" />
            <span className="backlog-rows-head-cell backlog-rows-head-lead" role="columnheader">{t("backlog.col_task")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status" role="columnheader">{t("backlog.status")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags" role="columnheader">{t("backlog.priority")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee" role="columnheader">{t("backlog.assignee")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due" role="columnheader">{t("backlog.due")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions" role="columnheader">{t("backlog.actions")}</span>
          </div>
          {inlineCreateStatus ? (
            <div className="backlog-inline-create-row" role="row">
              <InlineTaskCreate
                onSubmit={submitInlineCreate}
                onClose={() => setInlineCreateStatus(null)}
              />
            </div>
          ) : null}
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
                <span className="backlog-lane-count tnum">{grouped[status].length}</span>
              </header>
              <div className="backlog-task-list">
                {grouped[status].length === 0 && inlineCreateStatus !== status ? (
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
                {inlineCreateStatus === status ? (
                  <InlineTaskCreate
                    onSubmit={submitInlineCreate}
                    onClose={() => setInlineCreateStatus(null)}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    type="button"
                    className="backlog-lane-add"
                    onClick={() => setInlineCreateStatus(status)}
                  >
                    <ActionAdd size={ICON.sm} />
                    <span>{t("backlog.new_task")}</span>
                  </Button>
                )}
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
          initialFocus={assignmentFocus ? "assignment" : "title"}
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
