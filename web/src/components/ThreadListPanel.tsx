import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionAdd, ActionCompose, WorkspaceFolder } from "./icons";
import { ThreadRow, type ThreadItem } from "./ThreadRow";
import { groupThreads } from "../lib/threadGroups";
import { projectThreadBuckets } from "../lib/threads";
import type { ProjectRecord, RelaySession } from "../types";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";

// The logged-in employee's own threads. Each row is a session; the list
// is owner-scoped by the backend, so it only ever shows the current employee's
// work. “New thread” starts a fresh thread without archiving the rest.
export function ThreadListPanel({
  threads,
  projects,
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
}: {
  threads: ThreadItem[];
  projects: ProjectRecord[];
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
}) {
  const { t } = useTranslation();

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

  return (
    <aside id="thread-panel" className="thread-panel" aria-label={t("nav.threads")} tabIndex={-1}>
      <div className="conversation-header">
        <div className="conversation-heading">
          <h1>
            {t("project.projects")}
            <small className="tnum conversation-heading-count">
              {threads.length}
            </small>
          </h1>
        </div>
        <div className="conversation-header-actions">
          <Button variant="ghost"
            type="button"
            className="conversation-project-btn"
            aria-label={t("project.create")}
            title={t("project.create")}
            onClick={onCreateProject}
          >
            <ActionAdd size={16} />
          </Button>
          <Button variant="ghost"
            type="button"
            className="conversation-new-btn"
            aria-label={t("thread.new_thread")}
            title={t("thread.new_thread")}
            onClick={() => onNewThread(null)}
          >
            <ActionCompose size={16} />
          </Button>
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
      <section className="conversation-list project-directory" aria-label={t("project.projects")}>
        {hierarchy.projects.map(({ project, threads: projectThreads }) => (
          <section key={project.id} className={`project-folder${selectedProjectId === project.id ? " active" : ""}${project.archivedAt ? " archived" : ""}`}>
            <div className="project-folder-header">
              <button type="button" className="project-folder-select" onClick={() => onSelectProject(project.id)}>
                <WorkspaceFolder size={15} aria-hidden="true" />
                <span>{project.name}</span>
                {project.archivedAt ? <small>{t("project.archived")}</small> : null}
                <span className="project-folder-count tnum">{projectThreads.length}</span>
              </button>
              {!project.archivedAt && project.enabled ? <button
                type="button"
                className="project-folder-new"
                aria-label={t("project.new_thread", { project: project.name })}
                title={t("project.new_thread", { project: project.name })}
                onClick={() => onNewThread(project.id)}
              >
                <ActionCompose size={14} />
              </button> : null}
            </div>
            <div className="project-folder-threads">
              {renderThreads(projectThreads)}
              {projectThreads.length === 0 ? <p className="project-folder-empty">{t("project.no_threads")}</p> : null}
            </div>
          </section>
        ))}
        {hierarchy.unclassified.length > 0 ? (
          <section className={`project-folder${selectedProjectId === null ? " active" : ""}`}>
            <div className="project-folder-header">
              <button type="button" className="project-folder-select" onClick={() => onSelectProject(null)}>
                <WorkspaceFolder size={15} aria-hidden="true" />
                <span>{t("project.unclassified")}</span>
                <span className="project-folder-count tnum">{hierarchy.unclassified.length}</span>
              </button>
              <button
                type="button"
                className="project-folder-new"
                aria-label={t("thread.new_thread")}
                title={t("thread.new_thread")}
                onClick={() => onNewThread(null)}
              >
                <ActionCompose size={14} />
              </button>
            </div>
            <div className="project-folder-threads">{renderThreads(hierarchy.unclassified)}</div>
          </section>
        ) : null}
        {threads.length === 0 && (query.trim() || hierarchy.projects.length === 0) ? (
          <p className="conversation-empty">
            {query.trim() ? t("thread.no_matches") : t("project.no_projects")}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
