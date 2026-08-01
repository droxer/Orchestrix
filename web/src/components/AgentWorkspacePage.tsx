"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getWorkspaceBrief, listAgentWorkspaceFiles, readAgentWorkspaceFile } from "../api";
import type {
  EmployeeAgent,
  AgentWorkspaceFileResponse,
  WorkspaceFileEntry,
  AgentWorkspaceFilesResponse,
} from "../types";
import { agentLabel } from "../lib/plan";
import { isWorkspaceRetryableError, workspaceFilesEmptyState, workspaceHomeStatus } from "../lib/workspaceHome";
import { NavRefresh, ActionRemove, WorkspaceFile, WorkspaceFolder } from "./icons";
import { AgentMark } from "./AgentMark";
import { IdentityMonogram } from "./IdentityMonogram";
import { compactDate } from "../lib/workspaceFormat";
import {
  ActivitiesSkeleton,
  WorkspaceActivities,
  WorkspaceEmpty,
  WorkspaceError,
  WorkspaceLoading,
} from "./workspace/WorkspacePrimitives";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui/button";
import { CodeView, isHtmlFile, isMarkdownFile, isRenderableFile, languageForFile } from "./CodeView";
import { Markdown } from "./Markdown";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { ProfileImage } from "./ProfileImagePicker";
import { agentAvailabilityTone } from "../lib/adminHelpers";
import { describeAgentPlacements } from "../lib/agentPlacements";
import { AgentPlacementBadge } from "./AgentPlacementBadge";

export type WorkspacePageTab = "profile" | "workspace" | "activities";

const PAGE_TABS: readonly WorkspacePageTab[] = ["profile", "workspace", "activities"];

interface AgentWorkspacePageProps {
  agent: EmployeeAgent;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
  canEditMeta?: boolean;
}

type FileSelection = { path: string; name: string };

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
      {count !== undefined ? <span className="tnum">{count}</span> : null}
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
                <span className="workspace-path-segment is-current code" title={segment.path}>{segment.label}</span>
              ) : (
                <button
                  type="button"
                  className="workspace-path-segment code"
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

export function WorkspaceFilesBrowser({
  agentId,
  fixedScope,
  emptyMark,
  refreshVersion = 0,
}: {
  agentId: string;
  fixedScope?: WorkspaceFileScope;
  emptyMark?: ReactNode;
  refreshVersion?: number;
}) {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useUrlSearchState("path", "", parseString, (value) => value || null);
  const [selectedKey, setSelectedKey] = useUrlSearchState("item", "", parseString, (value) => value || null);
  const [selectableScope, setSelectableScope] = useUrlSearchState(
    "scope",
    "personal" as WorkspaceFileScope,
    parseFileScope,
    (value) => value === "personal" ? null : value,
  );
  const [snapshotBannerDismissed, setSnapshotBannerDismissed] = useState(false);
  const fileScope = fixedScope ?? selectableScope;
  const selectedPath = selectedKey.startsWith("file:") ? selectedKey.slice(5) : "";
  const selected: FileSelection | null = selectedPath
    ? { path: selectedPath, name: selectedPath.split("/").at(-1) || selectedPath }
    : null;
  const fileQuery = useQuery({
    queryKey: ["agent-workspace", agentId, fileScope, filePath, refreshVersion],
    queryFn: ({ signal }) => listAgentWorkspaceFiles({
      agentId,
      path: filePath,
      scope: fileScope === "shared" ? "shared" : undefined,
    }, signal),
    enabled: Boolean(agentId),
  });
  const contentQuery = useQuery({
    queryKey: ["agent-workspace-file", agentId, fileScope, selectedPath, refreshVersion],
    enabled: Boolean(agentId && selectedPath),
    queryFn: ({ signal }) => readAgentWorkspaceFile({
      agentId,
      path: selectedPath,
      scope: fileScope === "shared" ? "shared" : undefined,
    }, signal),
  });
  const homeStatus = workspaceHomeStatus(fileQuery.data, snapshotBannerDismissed);

  useEffect(() => {
    setSnapshotBannerDismissed(false);
  }, [agentId, fileScope]);

  function openDirectory(path: string): void {
    setFilePath(path);
    setSelectedKey("");
  }

  function switchFileScope(next: WorkspaceFileScope): void {
    if (next === fileScope) return;
    setSelectableScope(next);
    setFilePath("");
    setSelectedKey("");
  }

  if (!agentId) {
    return <WorkspaceEmpty title={t("workspace.files_unavailable")} mark={emptyMark ?? <WorkspaceFile size={18} />} announce />;
  }

  return (
    <div className={`workspace-panes${selected ? "" : " is-browse-only"}`}>
      <section className="workspace-pane workspace-pane-browse" aria-label={t("workspace.tab_files")}>
        <div className="workspace-tabpanel-files">
          {!fixedScope && fileScope === "personal" && homeStatus.kind === "snapshot-banner" ? (
            <SnapshotBanner onDismiss={() => setSnapshotBannerDismissed(true)} />
          ) : null}
          {!fixedScope ? (
            <div className="workspace-scope-toggle">
              <span className="workspace-scope-options" role="radiogroup" aria-label={t("workspace.scope_label")}>
                {(["personal", "shared"] as const).map((scopeOption) => (
                  <Button
                    key={scopeOption}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="workspace-scope-chip"
                    role="radio"
                    data-active={fileScope === scopeOption ? "true" : "false"}
                    aria-checked={fileScope === scopeOption}
                    onClick={() => switchFileScope(scopeOption)}
                  >
                    {scopeOption === "personal" ? t("workspace.scope_personal") : t("workspace.scope_shared")}
                  </Button>
                ))}
              </span>
              <span className="workspace-scope-hint">
                {fileScope === "shared" ? t("workspace.scope_shared_hint") : t("workspace.scope_personal_hint")}
              </span>
            </div>
          ) : (
            <div className="workspace-scope-toggle" aria-label={t("workspace.scope_label")}>
              <span className="workspace-scope-hint">{t("workspace.scope_shared_hint")}</span>
            </div>
          )}
          <div className="workspace-files-bar">
            <WorkspacePathBreadcrumb path={filePath} onNavigate={openDirectory} />
            {homeStatus.kind === "live" ? (
              <span className="workspace-home-status">
                <span className="workspace-status-pip tone-good" aria-hidden="true" />
                {t("workspace.source_live")}
                {homeStatus.nodeId ? <span className="workspace-home-node code">{homeStatus.nodeId}</span> : null}
              </span>
            ) : null}
            {homeStatus.kind === "snapshot-chip" ? (
              <span className="workspace-home-status">
                <span className="workspace-status-pip tone-warn" aria-hidden="true" />
                {t("workspace.source_snapshot")}
              </span>
            ) : null}
          </div>
          <FilesPane
            data={fileQuery.data}
            error={fileQuery.error}
            isLoading={fileQuery.isLoading}
            path={filePath}
            scope={fileScope}
            selectedPath={selectedPath}
            onOpenDirectory={openDirectory}
            onSelectFile={(entry) => setSelectedKey(`file:${entry.path}`)}
            onRetry={() => void fileQuery.refetch()}
          />
        </div>
      </section>

      {selected ? (
        <section className="workspace-pane workspace-pane-preview" aria-label={t("workspace.preview")}>
          <PaneHeader
            title={selected.name}
            actions={(
              <>
                <span className="workspace-preview-file-type code">{languageForFile(selected.name)}</span>
                <Button
                  variant="ghost"
                  type="button"
                  size="icon"
                  className="workspace-preview-close"
                  aria-label={t("workspace.close_preview")}
                  title={t("workspace.close_preview")}
                  onClick={() => setSelectedKey("")}
                >
                  <ActionRemove size={14} aria-hidden="true" />
                </Button>
              </>
            )}
          />
          <div className="workspace-pane-body workspace-preview-body">
            <FilePreview
              name={selected.name}
              data={contentQuery.data}
              isLoading={contentQuery.isLoading}
              error={contentQuery.isError ? contentQuery.error : null}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function AgentWorkspacePage({
  agent,
  isRefreshing,
  onRefresh,
  onOpenThread,
  canEditMeta = false,
}: AgentWorkspacePageProps) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useUrlSearchState("tab", "activities" as WorkspacePageTab, parsePageTab, (value) => value === "activities" ? null : value, "push");
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0);

  const query = useQuery({
    queryKey: ["agent-workspace-brief", agent.id],
    refetchInterval: pageTab === "activities" ? WORKSPACE_BRIEF_POLL_MS : false,
    queryFn: ({ signal }) => getWorkspaceBrief({ agentId: agent.id }, signal),
    enabled: pageTab === "activities",
  });
  const brief = query.data;
  const activitiesLoading = pageTab === "activities" && query.isLoading && !brief;
  const activitiesError = pageTab === "activities" && !brief && query.error
    ? query.error instanceof Error ? query.error.message : String(query.error)
    : "";
  const displayName = agent.displayName;

  async function refreshWorkspace(): Promise<void> {
    if (pageTab === "workspace") setWorkspaceRefreshVersion((current) => current + 1);
    await Promise.all([
      pageTab === "activities" ? query.refetch() : Promise.resolve(),
      onRefresh(),
    ]);
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
    if (tab === "workspace") return t("workspace.tab_workspace");
    return t("workspace.tab_activities");
  }

  const placementDescriptions = describeAgentPlacements(agent.placements);
  const primaryPlacement = placementDescriptions.find(
    ({ placement }) => placement.desiredState === "active",
  ) ?? placementDescriptions[0];

  function pageTabCount(tab: WorkspacePageTab): number | undefined {
    if (tab === "activities" && brief) return brief.metrics.sessionCount || undefined;
    return undefined;
  }

  return (
    <section
      id="agent-workspace-panel"
      className="workspace-page"
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
                fallback={<IdentityMonogram name={displayName} size={10} />}
              />
            </span>
            {displayName}
          </span>
        )}
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
                  {count !== undefined ? <span className="workspace-page-tab-count tnum">{count}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        actions={(
          <>
            <div className="workspace-header-strip">
              <span
                className="workspace-header-chip"
                translate="no"
              >
                <span className="sr-only">{t("admin.v2.agent_runtime")}: </span>
                <AgentMark agent={agent.executorKind} size={13} />
                <span className="workspace-header-chip-name">{agentLabel(agent.executorKind)}</span>
              </span>
              {primaryPlacement ? (
                <AgentPlacementBadge description={primaryPlacement} showSandbox />
              ) : (
                <span className="workspace-header-chip workspace-header-chip--empty">
                  {t("admin.v2.no_runtime_placement")}
                </span>
              )}
              <span className={`workspace-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
                {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nav.refresh")}
              disabled={isRefreshing || (pageTab === "activities" && query.isFetching)}
              onClick={() => void refreshWorkspace()}
            >
              <NavRefresh size={16} className={isRefreshing || (pageTab === "activities" && query.isFetching) ? "spin" : undefined} />
            </Button>
          </>
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
          <ActivitiesSkeleton panelId="workspace-page-panel-activities" labelledBy="workspace-page-tab-activities" metricCount={3} />
        ) : activitiesError ? (
          <WorkspaceError
            message={activitiesError}
            eyebrow={t("workspace.load_failed")}
            onRetry={() => void query.refetch()}
            panelId="workspace-page-panel-activities"
            labelledBy="workspace-page-tab-activities"
          />
        ) : (
          <WorkspaceActivities
            brief={brief}
            panelId="workspace-page-panel-activities"
            labelledBy="workspace-page-tab-activities"
            emptyPulse
            onOpenThread={onOpenThread}
          />
        )
      ) : pageTab === "workspace" ? (
        <div
          className="workspace-inspect"
          role="tabpanel"
          id="workspace-page-panel-workspace"
          aria-labelledby="workspace-page-tab-workspace"
        >
          <WorkspaceFilesBrowser
            agentId={agent.id}
            emptyMark={<AgentMark agent={agent.executorKind} size={18} />}
            refreshVersion={workspaceRefreshVersion}
          />
        </div>
      ) : null}
    </section>
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
  const { t } = useTranslation();
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
  selected,
  onOpenDirectory,
  onSelectFile,
}: {
  entry: WorkspaceFileEntry;
  selected: boolean;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (entry: WorkspaceFileEntry) => void;
}) {
  const { t, i18n } = useTranslation();
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
      <span className="workspace-pick-meta tnum">
        {isDirectory
          ? t("workspace.kind_directory")
          : formatBytes(entry.bytes, i18n.language) || t("workspace.kind_file")}
        {" · "}
        {compactDate(entry.updatedAt, i18n.language)}
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
