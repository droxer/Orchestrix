"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getAgentArtifacts, getWorkspaceBrief, listAgentWorkspaceFiles, readAgentWorkspaceFile } from "../api";
import type {
  ArtifactIndexItem,
  EmployeeAgent,
  AgentWorkspaceFileResponse,
  WorkspaceFileEntry,
  AgentWorkspaceFilesResponse,
  WorkspaceBriefSession,
  WorkspaceBriefTask,
  WorkspaceBriefResponse,
} from "../types";
import { agentLabel } from "../lib/plan";
import { isWorkspaceRetryableError, workspaceFilesEmptyState, workspaceHomeStatus } from "../lib/workspaceHome";
import { NavRefresh, WorkspaceFile, WorkspaceFolder } from "./icons";
import { AgentMark } from "./AgentMark";
import { compactDate, compactDueDate } from "../lib/workspaceFormat";
import { MetricItem, WorkspaceEmpty, WorkspaceLoading } from "./workspace/WorkspacePrimitives";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui/button";
import { ArtifactBody } from "./artifact/ArtifactBody";
import { ArtifactsEmpty } from "./artifact/ArtifactsEmpty";
import { CodeView, isHtmlFile, isMarkdownFile, isRenderableFile, languageForFile } from "./CodeView";
import { Markdown } from "./Markdown";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { ProfileImage } from "./ProfileImagePicker";
import { agentAvailabilityTone } from "../lib/adminHelpers";

export type WorkspacePageTab = "profile" | "workspace" | "artifacts" | "activities";

const PAGE_TABS: readonly WorkspacePageTab[] = ["profile", "workspace", "artifacts", "activities"];

interface AgentWorkspacePageProps {
  agent: EmployeeAgent;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
  canEditMeta?: boolean;
}

// One active selection drives the preview pane: an artifact (rendered with the
// shared ArtifactBody) or a workspace file (rendered from its fetched content).
type Selection =
  | { type: "artifact"; artifact: ArtifactIndexItem }
  | { type: "file"; path: string; name: string };

const parsePageTab = (value: string | null): WorkspacePageTab => {
  if (value === "files") return "workspace";
  return PAGE_TABS.includes(value as WorkspacePageTab) ? value as WorkspacePageTab : "activities";
};
const parseString = (value: string | null): string => value ?? "";

/** Personal home (default) vs the computer's shared workspace root. */
type WorkspaceFileScope = "personal" | "shared";
const parseFileScope = (value: string | null): WorkspaceFileScope => value === "shared" ? "shared" : "personal";

const WORKSPACE_BRIEF_POLL_MS = 3000;

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function formatBytes(bytes: number | null | undefined, locale?: string): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${new Intl.NumberFormat(locale || undefined).format(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)} ${unit}`;
}

function PaneHeader({
  title,
  count,
  meta,
  actions,
}: {
  title: string;
  count?: number;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-pane-head">
      <h2>{title}</h2>
      {count !== undefined ? <span className="mono">{count}</span> : null}
      {meta ?? null}
      {actions ? <div className="workspace-pane-head-actions">{actions}</div> : null}
    </header>
  );
}

function SnapshotBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="workspace-snapshot-banner" role="status">
      <p className="workspace-snapshot-banner-text">{t("workspace.snapshot_banner")}</p>
      <Button variant="ghost" type="button" className="workspace-snapshot-banner-dismiss h-auto" onClick={onDismiss}>
        {t("workspace.dismiss")}
      </Button>
    </div>
  );
}

function WorkspacePathBreadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const parts = path.split("/").filter(Boolean);
  const segments = [{ label: t("workspace.path_root"), path: "" }, ...parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join("/"),
  }))];

  return (
    <nav aria-label={t("workspace.path_label")}>
      <ol className="workspace-path-crumb">
        {segments.map((segment, index) => {
          const isCurrent = index === segments.length - 1;
          return (
            <li key={segment.path || "root"}>
              {index > 0 ? <span className="workspace-path-sep" aria-hidden="true">/</span> : null}
              {isCurrent ? (
                <span className="workspace-path-segment is-current mono" title={segment.path}>{segment.label}</span>
              ) : (
                <button
                  type="button"
                  className="workspace-path-segment mono"
                  title={segment.path}
                  onClick={() => onNavigate(segment.path)}
                >
                  {segment.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AgentWorkspacePage({
  agent,
  isRefreshing,
  onRefresh,
  onOpenThread,
  canEditMeta = false,
}: AgentWorkspacePageProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [filePath, setFilePath] = useUrlSearchState("workspacePath", "", parseString, (value) => value || null);
  const [pageTab, setPageTab] = useUrlSearchState("workspaceTab", "activities" as WorkspacePageTab, parsePageTab, (value) => value === "activities" ? null : value);
  const [selectedKey, setSelectedKey] = useUrlSearchState("workspaceItem", "", parseString, (value) => value || null);
  const [snapshotBannerDismissed, setSnapshotBannerDismissed] = useState(false);
  const previousScopeId = useRef(agent.id);

  const query = useQuery({
    queryKey: ["agent-workspace-brief", agent.id],
    refetchInterval: pageTab === "activities" ? WORKSPACE_BRIEF_POLL_MS : false,
    queryFn: ({ signal }) => getWorkspaceBrief({ agentId: agent.id }, signal),
    enabled: pageTab === "activities",
  });
  const [fileScope, setFileScope] = useUrlSearchState("workspaceScope", "personal" as WorkspaceFileScope, parseFileScope, (value) => value === "personal" ? null : value);
  const fileQuery = useQuery({
    queryKey: ["agent-workspace", agent.id, fileScope, filePath],
    queryFn: ({ signal }) => listAgentWorkspaceFiles({ agentId: agent.id, path: filePath, scope: fileScope === "shared" ? "shared" : undefined }, signal),
    enabled: pageTab === "workspace",
  });
  const homeStatus = workspaceHomeStatus(fileQuery.data, snapshotBannerDismissed);
  const agentArtifactsQuery = useQuery({
    queryKey: ["agent-artifacts", agent.id],
    queryFn: ({ signal }) => getAgentArtifacts(agent.id, signal),
    enabled: pageTab === "artifacts",
  });
  const selectedFilePath = selected?.type === "file" ? selected.path : "";
  const contentQuery = useQuery({
    queryKey: ["agent-workspace-file", agent.id, fileScope, selectedFilePath],
    enabled: selected?.type === "file",
    queryFn: ({ signal }) => readAgentWorkspaceFile({ agentId: agent.id, path: selectedFilePath, scope: fileScope === "shared" ? "shared" : undefined }, signal),
  });

  const brief = query.data;
  const artifacts = agentArtifactsQuery.data?.artifacts ?? [];
  const activitiesLoading = pageTab === "activities" && query.isLoading && !brief;
  const activitiesError = pageTab === "activities" && !brief && query.error
    ? query.error instanceof Error ? query.error.message : String(query.error)
    : "";
  const displayName = agent.displayName;
  const showBrowsePane = pageTab === "artifacts" || pageTab === "workspace";

  useEffect(() => {
    const scopeId = agent.id;
    if (previousScopeId.current === scopeId) return;
    previousScopeId.current = scopeId;
    setFilePath("");
    setSelected(null);
    setSelectedKey("");
    setPageTab("activities");
    setFileScope("personal");
    setSnapshotBannerDismissed(false);
  }, [agent.id, setFilePath, setFileScope, setPageTab, setSelectedKey]);

  useEffect(() => {
    if (pageTab === "profile" || pageTab === "activities") {
      setSelected(null);
      setSelectedKey("");
      return;
    }
    if (pageTab === "artifacts" && selected?.type === "file") {
      setSelected(null);
      setSelectedKey("");
    }
    if (pageTab === "workspace" && selected?.type === "artifact") {
      setSelected(null);
      setSelectedKey("");
    }
  }, [pageTab, selected?.type, setSelectedKey]);

  useEffect(() => {
    if (!selectedKey) {
      setSelected(null);
      return;
    }
    if (selectedKey.startsWith("artifact:")) {
      const artifact = artifacts.find((item) => item.id === selectedKey.slice(9));
      if (artifact) setSelected({ type: "artifact", artifact });
      return;
    }
    if (selectedKey.startsWith("file:")) {
      const path = selectedKey.slice(5);
      setSelected({ type: "file", path, name: path.split("/").at(-1) || path });
    }
  }, [artifacts, selectedKey]);

  async function refreshWorkspace(): Promise<void> {
    await Promise.all([
      pageTab === "activities" ? query.refetch() : Promise.resolve(),
      pageTab === "workspace" ? fileQuery.refetch() : Promise.resolve(),
      pageTab === "artifacts" ? agentArtifactsQuery.refetch() : Promise.resolve(),
      onRefresh(),
    ]);
  }

  function openDirectory(path: string): void {
    setFilePath(path);
  }

  function switchFileScope(next: WorkspaceFileScope): void {
    if (next === fileScope) return;
    setFileScope(next);
    setFilePath("");
    setSelected(null);
    setSelectedKey("");
  }

  function selectWorkspaceItem(selection: Selection): void {
    setSelected(selection);
    setSelectedKey(selection.type === "artifact" ? `artifact:${selection.artifact.id}` : `file:${selection.path}`);
  }

  function movePageTab(event: KeyboardEvent<HTMLButtonElement>, next: WorkspacePageTab): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home"
      ? PAGE_TABS[0]
      : event.key === "End"
        ? PAGE_TABS[PAGE_TABS.length - 1]
        : next;
    setPageTab(target);
    requestAnimationFrame(() => document.getElementById(`workspace-page-tab-${target}`)?.focus());
  }

  function pageTabLabel(tab: WorkspacePageTab): string {
    if (tab === "profile") return t("workspace.tab_profile");
    if (tab === "workspace") return t("workspace.tab_files");
    if (tab === "artifacts") return t("workspace.artifacts");
    return t("workspace.tab_activities");
  }

  const headerSubtitle = pageTab === "profile"
    ? t("workspace.profile_sub", { agent: displayName })
    : t("workspace.header_executor", { executor: agentLabel(agent.executorKind) });

  function pageTabCount(tab: WorkspacePageTab): number | undefined {
    if (tab === "artifacts") return artifacts.length || undefined;
    if (tab === "activities" && brief) return brief.metrics.sessionCount || undefined;
    return undefined;
  }

  return (
    <section
      id="agent-workspace-panel"
      className="workspace-page"
      data-executor={agent.executorKind}
      aria-label={t("workspace.title")}
      tabIndex={-1}
    >
      <PageHeader
        kicker={t("nav.workspace")}
        title={(
          <span className="workspace-header-title">
            <span className="workspace-header-mark" aria-hidden="true">
              <ProfileImage
                src={agent.profileImageUrl}
                alt=""
                fallback={<AgentMark agent={agent.executorKind} size={14} />}
              />
            </span>
            {displayName}
          </span>
        )}
        subtitle={headerSubtitle}
        titleVariant="display"
        layout="stacked"
        toolbar={(
          <div className="workspace-page-tabs" role="tablist" aria-label={t("workspace.sections")}>
            {PAGE_TABS.map((tab, index) => {
              const previous = PAGE_TABS[index - 1] ?? PAGE_TABS[PAGE_TABS.length - 1];
              const next = PAGE_TABS[index + 1] ?? PAGE_TABS[0];
              const count = pageTabCount(tab);
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={`workspace-page-tab-${tab}`}
                  aria-selected={pageTab === tab}
                  aria-controls={pageTab === tab ? `workspace-page-panel-${tab}` : undefined}
                  tabIndex={pageTab === tab ? 0 : -1}
                  className={`workspace-page-tab${pageTab === tab ? " is-active" : ""}`}
                  onClick={() => setPageTab(tab)}
                  onKeyDown={(event) => movePageTab(event, event.key === "ArrowLeft" ? previous : next)}
                >
                  {pageTabLabel(tab)}
                  {count !== undefined ? <span className="workspace-page-tab-count mono">{count}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("nav.refresh")}
            disabled={isRefreshing || (pageTab === "activities" && query.isFetching) || (pageTab === "workspace" && fileQuery.isFetching) || (pageTab === "artifacts" && agentArtifactsQuery.isFetching)}
            onClick={() => void refreshWorkspace()}
          >
            <NavRefresh size={16} className={isRefreshing || (pageTab === "activities" && query.isFetching) || (pageTab === "workspace" && fileQuery.isFetching) || (pageTab === "artifacts" && agentArtifactsQuery.isFetching) ? "spin" : undefined} />
          </Button>
        )}
      />

      {pageTab === "profile" ? (
        <div
          className="workspace-profile"
          role="tabpanel"
          id="workspace-page-panel-profile"
          aria-labelledby="workspace-page-tab-profile"
        >
          <AgentProfilePanel
            agent={agent}
            canEditMeta={canEditMeta}
            variant="workspace"
          />
        </div>
      ) : pageTab === "activities" ? (
        activitiesLoading ? (
          <ActivitiesLoading />
        ) : activitiesError ? (
          <WorkspaceError message={activitiesError} onRetry={() => void query.refetch()} />
        ) : (
          <ActivitiesPane
            agent={agent}
            brief={brief}
            onOpenThread={onOpenThread}
          />
        )
      ) : (
        <div
          className="workspace-inspect"
          role="tabpanel"
          id={`workspace-page-panel-${pageTab}`}
          aria-labelledby={`workspace-page-tab-${pageTab}`}
        >
          {showBrowsePane && pageTab === "artifacts" && !artifacts.length ? (
            /* No artifacts means nothing to preview — the empty state owns
               the whole panel instead of sitting beside a dead preview pane. */
            agentArtifactsQuery.isLoading ? (
              <WorkspaceLoading label={t("workspace.loading")} />
            ) : (
              <ArtifactsEmpty
                title={t("workspace.no_artifacts")}
                hint={t("workspace.empty_artifacts_hint")}
              />
            )
          ) : showBrowsePane ? (
            <div className="workspace-panes">
              <section className="workspace-pane workspace-pane-browse" aria-label={pageTab === "artifacts" ? t("workspace.artifacts") : t("workspace.tab_files")}>
                {pageTab === "artifacts" ? (
                  <div className="workspace-pane-body">
                    <ul className="workspace-pick-list">
                        {artifacts.map((artifact) => {
                          const active = selected?.type === "artifact" && selected.artifact.id === artifact.id;
                          return (
                            <li key={artifact.id}>
                              <button
                                type="button"
                                className={`workspace-pick${active ? " is-active" : ""}`}
                                aria-pressed={active}
                                onClick={() => selectWorkspaceItem({ type: "artifact", artifact })}
                              >
                                <span className={`artifact-kind-tag is-${artifact.kind}`}>
                                  {t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind })}
                                </span>
                                <span className="workspace-pick-title">{artifact.title}</span>
                                <span className="workspace-pick-meta mono">{compactDate(artifact.createdAt, i18n.language)}</span>
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ) : (
                  <div className="workspace-tabpanel-files">
                    {fileScope === "personal" && homeStatus.kind === "snapshot-banner" ? (
                      <SnapshotBanner onDismiss={() => setSnapshotBannerDismissed(true)} />
                    ) : null}
                    <div className="workspace-scope-toggle" role="group" aria-label={t("workspace.scope_label")}>
                      {(["personal", "shared"] as const).map((scopeOption) => (
                        <Button
                          key={scopeOption}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="workspace-scope-chip"
                          data-active={fileScope === scopeOption ? "true" : "false"}
                          aria-pressed={fileScope === scopeOption}
                          onClick={() => switchFileScope(scopeOption)}
                        >
                          {scopeOption === "personal" ? t("workspace.scope_personal") : t("workspace.scope_shared")}
                        </Button>
                      ))}
                      <span className="workspace-scope-hint">
                        {fileScope === "shared" ? t("workspace.scope_shared_hint") : t("workspace.scope_personal_hint")}
                      </span>
                    </div>
                    <div className="workspace-files-bar">
                      <WorkspacePathBreadcrumb path={filePath} onNavigate={openDirectory} />
                      {homeStatus.kind === "live" ? <span className="workspace-home-status workspace-home-status--live">● {t("workspace.source_live")}{homeStatus.nodeId ? <span className="workspace-home-node"> {homeStatus.nodeId}</span> : null}</span> : null}
                      {homeStatus.kind === "snapshot-chip" ? (
                        <span className="workspace-home-status workspace-home-status--snapshot">○ {t("workspace.source_snapshot")}</span>
                      ) : null}
                    </div>
                    <FilesPane
                      data={fileQuery.data}
                      error={fileQuery.error}
                      isLoading={fileQuery.isLoading}
                      path={filePath}
                      scope={fileScope}
                      selectedPath={selectedFilePath}
                      onOpenDirectory={openDirectory}
                      onSelectFile={(entry) => selectWorkspaceItem({ type: "file", path: entry.path, name: entry.name })}
                      onRetry={() => void fileQuery.refetch()}
                    />
                  </div>
                )}
              </section>

              <section className="workspace-pane workspace-pane-preview" aria-label={t("workspace.preview")}>
                <PaneHeader
                  title={selected ? (selected.type === "artifact" ? selected.artifact.title : selected.name) : t("workspace.preview")}
                  actions={selected?.type === "artifact" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenThread(selected.artifact.sessionId)}
                    >
                      {t("workspace.open_thread")}
                    </Button>
                  ) : selected?.type === "file" ? (
                    <span className="workspace-preview-file-type mono">{languageForFile(selected.name)}</span>
                  ) : null}
                />
                <div className="workspace-pane-body workspace-preview-body">
                  {!selected ? (
                    <WorkspaceEmpty
                      title={t("workspace.select_to_preview")}
                      hint={t("workspace.empty_preview_hint")}
                      mark={<AgentMark agent={agent.executorKind} size={18} />}
                    />
                  ) : selected.type === "artifact" ? (
                    <div className="workspace-preview-viewport workspace-preview-viewport--artifact">
                      <div className="artifact-viewer-body">
                        <ArtifactBody artifact={selected.artifact} sessionId={selected.artifact.sessionId} />
                      </div>
                    </div>
                  ) : (
                    <FilePreview
                      name={selected.name}
                      data={contentQuery.data}
                      isLoading={contentQuery.isLoading}
                      error={contentQuery.isError ? contentQuery.error : null}
                    />
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function sessionTitle(session: WorkspaceBriefSession): string {
  return session.title?.trim() || session.taskGoal?.trim() || session.id;
}

function taskTitle(task: WorkspaceBriefTask): string {
  return task.title?.trim() || task.id;
}

/** Sessions carry `SessionStatus`, not `TaskStatus` — `completed`, `failed`,
 *  and `cancelled` have no `backlog.statuses.*` key and used to fall through
 *  to the raw lowercase enum. Label them from the thread vocabulary. */
function sessionStatusLabel(
  status: WorkspaceBriefSession["status"] | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!status) return "";
  return t(`thread.statuses.${status}`, { defaultValue: status });
}

function ActivitiesPane({
  agent,
  brief,
  onOpenThread,
}: {
  agent: EmployeeAgent;
  brief?: WorkspaceBriefResponse;
  onOpenThread: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const metrics = brief?.metrics;
  const activeRuns = brief?.activeRuns ?? [];
  const sessions = brief?.sessions ?? [];
  const tasks = brief?.tasks ?? [];
  const hasActivity = activeRuns.length > 0 || sessions.length > 0 || tasks.length > 0;

  return (
    <div
      className="workspace-inspect workspace-activities"
      role="tabpanel"
      id="workspace-page-panel-activities"
      aria-labelledby="workspace-page-tab-activities"
    >
      <div className="workspace-metric-strip" aria-label={t("workspace.metrics")}>
        <MetricItem
          label={t("workspace.metric_runs")}
          value={metrics?.activeRunCount ?? 0}
          emphasis={(metrics?.activeRunCount ?? 0) > 0}
          live={(metrics?.activeRunCount ?? 0) > 0}
        />
        <MetricItem label={t("workspace.metric_tasks")} value={metrics?.activeTaskCount ?? 0} zero={(metrics?.activeTaskCount ?? 0) === 0} />
        <MetricItem label={t("workspace.metric_sessions")} value={metrics?.sessionCount ?? 0} zero={(metrics?.sessionCount ?? 0) === 0} />
        <MetricItem label={t("workspace.metric_artifacts")} value={metrics?.artifactCount ?? 0} zero={(metrics?.artifactCount ?? 0) === 0} />
        <div className="workspace-metric-item workspace-metric-item--status">
          <span className={`workspace-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
            {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
          </span>
        </div>
      </div>

      <div className="workspace-activity-sections">
        {activeRuns.length ? (
          <ActivitySection title={t("workspace.activity_runs")} count={activeRuns.length} index={0}>
            <ul className="workspace-pick-list">
              {activeRuns.map((run) => (
                <li key={run.runId}>
                  <ActivityRow
                    title={run.taskGoal}
                    meta={[
                      agentLabel(run.agent),
                      t(`mode.${run.mode}`, { defaultValue: run.mode }),
                      compactDate(run.startedAt, i18n.language),
                    ].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(run.sessionId)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}

        {sessions.length ? (
          <ActivitySection title={t("workspace.activity_threads")} count={sessions.length} index={activeRuns.length ? 1 : 0}>
            <ul className="workspace-pick-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <ActivityRow
                    title={sessionTitle(session)}
                    meta={[
                      sessionStatusLabel(session.status, t),
                      session.runCount ? t("workspace.session_runs", { count: session.runCount }) : "",
                      session.artifactCount ? t("workspace.session_artifacts", { count: session.artifactCount }) : "",
                      compactDate(session.updatedAt, i18n.language),
                    ].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(session.id)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}

        {tasks.length ? (
          <ActivitySection
            title={t("workspace.activity_tasks")}
            count={tasks.length}
            index={(activeRuns.length ? 1 : 0) + (sessions.length ? 1 : 0)}
          >
            <ul className="workspace-pick-list">
              {tasks.map((task) => {
                const linkedSessionId = task.linkedSessionIds[0];
                return (
                  <li key={task.id}>
                    <ActivityRow
                      title={taskTitle(task)}
                      meta={[
                        task.status ? t(`backlog.statuses.${task.status}`, { defaultValue: task.status }) : "",
                        task.dueDate ? t("workspace.task_due", { date: compactDueDate(task.dueDate, i18n.language) }) : "",
                        compactDate(task.updatedAt, i18n.language),
                      ].filter(Boolean).join(" · ")}
                      onClick={linkedSessionId ? () => onOpenThread(linkedSessionId) : undefined}
                    />
                  </li>
                );
              })}
            </ul>
          </ActivitySection>
        ) : null}

        {!hasActivity ? (
          <WorkspaceEmpty
            title={t("workspace.no_activity")}
            hint={t("workspace.empty_activity_hint")}
            pulse
            announce
          />
        ) : null}
      </div>
    </div>
  );
}

function ActivitySection({ title, count, index = 0, children }: { title: string; count: number; index?: number; children: ReactNode }) {
  return (
    <section className="workspace-activity-section" style={{ animationDelay: `${40 + index * 80}ms` }}>
      <header className="workspace-activity-head">
        <h2>{title}</h2>
        <span className="mono">{count}</span>
      </header>
      {children}
    </section>
  );
}

function ActivityRow({
  title,
  meta,
  onClick,
}: {
  title: string;
  meta: string;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <div className="workspace-pick workspace-activity-pick is-static">
        <span className="workspace-pick-title">{title}</span>
        <span className="workspace-pick-meta mono">{meta}</span>
      </div>
    );
  }
  return (
    <button type="button" className="workspace-pick workspace-activity-pick" onClick={onClick}>
      <span className="workspace-pick-title">{title}</span>
      <span className="workspace-pick-meta mono">{meta}</span>
    </button>
  );
}

function FilesPane({
  data,
  error,
  isLoading,
  path,
  scope = "personal",
  selectedPath,
  onOpenDirectory,
  onSelectFile,
  onRetry,
}: {
  data?: AgentWorkspaceFilesResponse;
  error: unknown;
  isLoading: boolean;
  path: string;
  scope?: WorkspaceFileScope;
  selectedPath: string;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (entry: WorkspaceFileEntry) => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const entries = data?.entries ?? [];
  const emptyState = workspaceFilesEmptyState(data?.source);
  const sharedUnavailable = scope === "shared" && isWorkspaceRetryableError(error);
  const message = sharedUnavailable
    ? t("workspace.shared_unavailable")
    : error instanceof Error ? error.message : error ? String(error) : "";

  return (
    <div className="workspace-pane-body">
      {path ? (
        <Button variant="ghost" type="button" className="workspace-file-up h-auto justify-start rounded-none" onClick={() => onOpenDirectory(parentPath(path))}>
          {t("workspace.parent_directory")}
        </Button>
      ) : null}

      {isLoading ? (
        <WorkspaceLoading label={t("workspace.loading_files")} />
      ) : message ? (
        <div className="workspace-file-error">
          <WorkspaceEmpty title={message} mark={<WorkspaceFile size={18} />} announce />
          {isWorkspaceRetryableError(error) ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t("workspace.retry")}</Button> : null}
        </div>
      ) : data && !data.exists ? (
        <WorkspaceEmpty title={t("workspace.files_unavailable")} mark={<WorkspaceFile size={18} />} announce />
      ) : entries.length ? (
        <ul className="workspace-pick-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <WorkspaceFileRow
                entry={entry}
                locale={i18n.language}
                selected={selectedPath === entry.path}
                onOpenDirectory={onOpenDirectory}
                onSelectFile={onSelectFile}
              />
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmpty
          title={t(emptyState.titleKey)}
          hint={emptyState.hintKey ? t(emptyState.hintKey) : undefined}
          mark={<WorkspaceFile size={18} />}
          announce
        />
      )}
    </div>
  );
}

function WorkspaceFileRow({
  entry,
  locale,
  selected,
  onOpenDirectory,
  onSelectFile,
}: {
  entry: WorkspaceFileEntry;
  locale: string;
  selected: boolean;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (entry: WorkspaceFileEntry) => void;
}) {
  const isDirectory = entry.kind === "directory";
  return (
    <button
      type="button"
      className={`workspace-pick workspace-file-pick${selected ? " is-active" : ""}`}
      aria-pressed={selected}
      data-kind={entry.kind}
      onClick={() => (isDirectory ? onOpenDirectory(entry.path) : onSelectFile(entry))}
    >
      <span className="workspace-file-icon" aria-hidden="true">
        {isDirectory ? <WorkspaceFolder size={15} /> : <WorkspaceFile size={15} />}
      </span>
      <span className="workspace-pick-title">{entry.name}</span>
      <span className="workspace-pick-meta mono">
        {isDirectory ? entry.kind : formatBytes(entry.bytes, locale) || entry.kind} · {compactDate(entry.updatedAt, locale)}
      </span>
    </button>
  );
}

function FilePreview({
  name,
  data,
  isLoading,
  error,
}: {
  name: string;
  data?: AgentWorkspaceFileResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const { t, i18n } = useTranslation();
  const renderable = isRenderableFile(name);
  const [rendered, setRendered] = useState(renderable);
  useEffect(() => {
    setRendered(renderable);
  }, [name, renderable]);

  if (isLoading) {
    return <WorkspaceLoading label={t("workspace.loading_preview")} />;
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <p className="artifact-viewer-status artifact-viewer-error">{message}</p>;
  }
  if (!data) return null;
  if (data.isBinary) {
    return <p className="artifact-viewer-status">{t("workspace.binary_file")}</p>;
  }
  if (!data.content || !data.content.trim()) {
    return <p className="artifact-viewer-status">{t("workspace.empty_file")}</p>;
  }
  const showRendered = renderable && rendered;
  const bleed = showRendered && (isMarkdownFile(name) || isHtmlFile(name));
  return (
    <div className={`workspace-preview-viewport${bleed ? " is-bleed" : ""}`}>
      {renderable ? (
        <div
          className={`code-view-toolbar${bleed ? " code-view-toolbar--floating" : ""}`}
          role="group"
          aria-label={t("workspace.view_mode")}
        >
          <button
            type="button"
            className={`code-view-toggle${rendered ? " is-active" : ""}`}
            aria-pressed={rendered}
            onClick={() => setRendered(true)}
          >
            {t("workspace.view_rendered")}
          </button>
          <button
            type="button"
            className={`code-view-toggle${rendered ? "" : " is-active"}`}
            aria-pressed={!rendered}
            onClick={() => setRendered(false)}
          >
            {t("workspace.view_source")}
          </button>
        </div>
      ) : null}
      <div className={`artifact-viewer-body${bleed ? " is-bleed" : ""}`}>
        {showRendered && isMarkdownFile(name) ? (
          <Markdown text={data.content} />
        ) : showRendered && isHtmlFile(name) ? (
          <HtmlPreview html={data.content} title={name} />
        ) : (
          <CodeView code={data.content} language={languageForFile(name)} />
        )}
        {data.truncated ? (
          <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes, i18n.language) })}</p>
        ) : null}
      </div>
    </div>
  );
}

function HtmlPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      className="html-preview"
      title={title}
      sandbox=""
      srcDoc={html}
    />
  );
}

function ActivitiesLoading() {
  const { t } = useTranslation();
  return (
    <div
      className="workspace-inspect workspace-activities"
      role="tabpanel"
      id="workspace-page-panel-activities"
      aria-labelledby="workspace-page-tab-activities"
      aria-busy="true"
    >
      <span className="sr-only" role="status">{t("workspace.loading")}</span>
      <div className="workspace-metric-strip">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="workspace-skeleton workspace-skeleton-metric" />
        ))}
      </div>
      <div className="workspace-activity-sections">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="workspace-activity-section workspace-skeleton-pane">
            <div className="workspace-skeleton workspace-skeleton-line" />
            <div className="workspace-skeleton workspace-skeleton-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="workspace-inspect"
      role="tabpanel"
      id="workspace-page-panel-activities"
      aria-labelledby="workspace-page-tab-activities"
    >
      <div className="workspace-error" role="alert">
        <span className="workspace-eyebrow">{t("workspace.load_failed")}</span>
        <p>{message}</p>
        <Button variant="ghost" type="button" className="workspace-error-action h-auto" onClick={onRetry}>
          {t("workspace.retry")}
        </Button>
      </div>
    </div>
  );
}
