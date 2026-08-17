import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionAdd, ActionCompose, ChevronDownIcon, WorkspaceFolder } from "./icons";
import { ThreadRow, type ThreadItem } from "./ThreadRow";
import { groupThreads } from "../lib/threadGroups";
import { projectThreadBuckets } from "../lib/threads";
import {
  clampThreadListWidth,
  maxThreadListWidth,
  THREAD_LIST_WIDTH_DEFAULT,
  THREAD_LIST_WIDTH_MAX,
  THREAD_LIST_WIDTH_MIN,
} from "../lib/threadList";
import type { DaemonNodeMonitorRecord, ProjectRecord, RelaySession } from "../types";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";

const KEYBOARD_RESIZE_STEP = 16;

/** The chat column, measured to work out how much width the list may still
 *  take. Read straight from the DOM rather than threaded down as a prop: the
 *  grid — not React — owns the column's real width. */
function chatWidth(): number | null {
  if (typeof document === "undefined") return null;
  const chat = document.getElementById("chat-panel");
  return chat ? chat.getBoundingClientRect().width : null;
}

// The logged-in employee's own threads. Each row is a session; the list
// is owner-scoped by the backend, so it only ever shows the current employee's
// work. “New thread” starts a fresh thread without archiving the rest.
export function ThreadListPanel({
  directoryMode,
  threads,
  projects,
  computers,
  query,
  setQuery,
  selectedSessionId,
  selectedProjectId,
  onSelectThread,
  onSelectProject,
  onCreateProject,
  onNewThread,
  onRenameThread,
  onCloseThread,
  width,
  onResize,
  onResizeActive,
}: {
  directoryMode: "threads" | "projects";
  threads: ThreadItem[];
  projects: ProjectRecord[];
  computers: DaemonNodeMonitorRecord[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selectedSessionId: string | undefined;
  selectedProjectId: string | null;
  onSelectThread: (sessionId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onCreateProject: () => void;
  onNewThread: (projectId?: string | null) => void;
  onRenameThread: (session: RelaySession) => void;
  onCloseThread: (sessionId: string) => void;
  width: number;
  onResize: (width: number, commit: boolean) => void;
  onResizeActive: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  // A drag registers listeners outside React; this releases them if the panel
  // unmounts mid-gesture, which would otherwise leak the listeners and strand
  // the shell in its resizing state.
  const releaseDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseDragRef.current?.(), []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    // Ceiling fixed at gesture start: the chat column shrinks as the drag
    // proceeds, so re-measuring per move would let the list walk past it.
    const max = maxThreadListWidth(width, chatWidth());
    handle.setPointerCapture(event.pointerId);
    onResizeActive(true);

    // The list sits left of the chat column, so dragging right (positive
    // delta) grows it — the mirror of the space panel's leftward drag.
    const widthAt = (clientX: number) => clampThreadListWidth(width + (clientX - startX), max);
    const move = (moveEvent: PointerEvent) => onResize(widthAt(moveEvent.clientX), false);
    const finish = (finalX: number | null) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      releaseDragRef.current = null;
      if (finalX !== null) onResize(widthAt(finalX), true);
      onResizeActive(false);
    };
    const up = (upEvent: PointerEvent) => finish(upEvent.clientX);
    // A cancelled gesture (system takeover, touch interruption) never fires
    // pointerup — without this the shell keeps its resizing state forever.
    const cancel = () => finish(null);

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    releaseDragRef.current = () => finish(null);
  }, [onResize, onResizeActive, width]);

  const resizeByKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const max = maxThreadListWidth(width, chatWidth());
    if (event.key === "Home") {
      event.preventDefault();
      onResize(clampThreadListWidth(THREAD_LIST_WIDTH_DEFAULT, max), true);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
    onResize(clampThreadListWidth(width + delta, max), true);
  }, [onResize, width]);

  // A window that narrows while the list is at a custom width can push the
  // chat column under its floor; give the room back rather than leaving the
  // conversation squeezed. Only ever shrinks — maxThreadListWidth is a
  // ceiling, not a target.
  useEffect(() => {
    const onWindowResize = () => {
      const max = maxThreadListWidth(width, chatWidth());
      if (width > max) onResize(max, false);
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [onResize, width]);

  const hierarchy = projectThreadBuckets(threads, projects);

  const renderThreads = (items: ThreadItem[]) => {
    const groups = groupThreads(items);
    const sections = [
      { key: "needsYou", tone: "attn", label: t("thread.group_needs_you"), items: groups.needsYou },
      { key: "running", tone: "run", label: t("thread.group_running"), items: groups.running },
      { key: "idle", tone: "idle", label: t("thread.group_idle"), items: groups.idle },
    ] as const;
    return sections.map((section) => section.items.length > 0 ? (
      <div key={section.key} className="conversation-group" data-tone={section.tone}>
        <div className="conversation-group-label">
          <span>{section.label}</span>
          <span className="conversation-group-count tnum">{section.items.length}</span>
        </div>
        {section.items.map((item) => (
          <ThreadRow
            key={item.session.id}
            item={item}
            selected={selectedSessionId === item.session.id}
            onSelect={onSelectThread}
            onRename={onRenameThread}
            onClose={onCloseThread}
          />
        ))}
      </div>
    ) : null);
  };

  // Threads inside a project render flat: the group headers that make sense
  // for a long unscoped list are pure chrome around one to five rows, so the
  // attention order (needs you → running → idle) is kept but the grouping is
  // dropped and each row carries its own state pip instead.
  const renderProjectThreads = (items: ThreadItem[]) => {
    const groups = groupThreads(items);
    const flat: Array<{ item: ThreadItem; state: "attn" | "run" | "idle" }> = [
      ...groups.needsYou.map((item) => ({ item, state: "attn" as const })),
      ...groups.running.map((item) => ({ item, state: "run" as const })),
      ...groups.idle.map((item) => ({ item, state: "idle" as const })),
    ];
    return flat.map(({ item, state }) => (
      <ThreadRow
        key={item.session.id}
        item={item}
        state={state}
        selected={selectedSessionId === item.session.id}
        onSelect={onSelectThread}
        onRename={onRenameThread}
        onClose={onCloseThread}
      />
    ));
  };

  return (
    <aside id="thread-panel" className="thread-panel" aria-label={t("nav.threads")} tabIndex={-1}>
      <div className="thread-panel-inner">
      <div className="conversation-header">
        <div className="conversation-heading">
          <h1>
            {directoryMode === "projects" ? t("project.projects") : t("nav.threads")}
            <small className="tnum conversation-heading-count">
              {directoryMode === "projects" ? hierarchy.projects.length : threads.length}
            </small>
          </h1>
        </div>
        <div className="conversation-header-actions">
          {directoryMode === "projects" ? (
            <Button variant="ghost"
              type="button"
              className="conversation-project-btn"
              aria-label={t("project.create")}
              title={t("project.create")}
              onClick={onCreateProject}
            >
              <ActionAdd size={16} />
            </Button>
          ) : (
            <Button variant="ghost"
              type="button"
              className="conversation-new-btn"
              aria-label={t("thread.new_thread")}
              title={t("thread.new_thread")}
              onClick={() => onNewThread(null)}
            >
              <ActionCompose size={16} />
            </Button>
          )}
        </div>
      </div>
      <SearchInput
        className="relay-search conversation-search"
        label={t("thread.search_label")}
        name="thread-search"
        placeholder={t("thread.search_placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <section
        // project-directory widens the row gap for folder blocks; in threads
        // mode the list must keep conversation-list's tight single-line gap.
        className={directoryMode === "projects" ? "conversation-list project-directory" : "conversation-list"}
        aria-label={directoryMode === "projects" ? t("project.projects") : t("nav.threads")}
      >
        {directoryMode === "projects" ? hierarchy.projects.map(({ project, threads: projectThreads }) => {
          const expanded = selectedProjectId === project.id || (!project.archivedAt && !collapsedProjects.has(project.id));
          const computerLabel = computers.find((computer) => computer.id === project.computerId)?.displayName
            || project.computerId.replace(/^device:[^:]+:/, "");
          // A collapsed project hides its threads, so the row needs its own
          // signal for "something in here needs a look" — the same attn/run
          // vocabulary as a thread's own state pip, aggregated up one level.
          const projectGroups = groupThreads(projectThreads);
          const projectState: "attn" | "run" | undefined = projectGroups.needsYou.length > 0
            ? "attn"
            : projectGroups.running.length > 0
              ? "run"
              : undefined;
          return (
          <section key={project.id} className={`project-folder${selectedProjectId === project.id ? " active" : ""}${project.archivedAt ? " archived" : ""}${expanded ? " expanded" : " collapsed"}`}>
            <div className="project-folder-header">
              <button
                type="button"
                className="project-folder-toggle"
                aria-label={t(expanded ? "project.collapse" : "project.expand", { project: project.name })}
                aria-expanded={expanded}
                onClick={() => setCollapsedProjects((current) => {
                  const next = new Set(current);
                  if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                  return next;
                })}
              >
                <ChevronDownIcon size={14} />
              </button>
              <button
                type="button"
                className="project-folder-select"
                aria-current={selectedProjectId === project.id ? "page" : undefined}
                title={`${project.name} · ${t("project.member_count", { count: project.members.length })} · ${computerLabel}`}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-folder-icon">
                  <WorkspaceFolder size={15} aria-hidden="true" />
                  {projectState ? (
                    <span className="project-folder-state-dot" data-tone={projectState} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="project-folder-name">{project.name}</span>
                {project.archivedAt ? <small>{t("project.archived")}</small> : null}
                <span className="project-folder-count tnum">{projectThreads.length}</span>
              </button>
            </div>
            {expanded ? <div className="project-folder-threads">
                {renderProjectThreads(projectThreads)}
                {projectThreads.length === 0 ? <p className="project-folder-empty">{t("project.no_threads")}</p> : null}
              </div> : null}
          </section>
        )}) : renderThreads(hierarchy.unclassified)}
        {(directoryMode === "projects" ? hierarchy.projects.length === 0 : threads.length === 0) ? (
          query.trim() ? (
            <p className="conversation-empty">{t("thread.no_matches")}</p>
          ) : (
            <div className="conversation-empty">
              <p>{directoryMode === "projects" ? t("project.no_projects") : t("thread.no_threads")}</p>
              <button
                type="button"
                className="conversation-empty-action"
                onClick={() => (directoryMode === "projects" ? onCreateProject() : onNewThread(null))}
              >
                {directoryMode === "projects" ? t("project.create") : t("thread.new_thread")}
              </button>
            </div>
          )
        ) : null}
      </section>
      </div>
      <div
        className="thread-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("thread.resize_label")}
        aria-valuenow={width}
        aria-valuemin={THREAD_LIST_WIDTH_MIN}
        aria-valuemax={THREAD_LIST_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
    </aside>
  );
}
