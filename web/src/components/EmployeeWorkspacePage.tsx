"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getWorkspaceBrief, listWorkspaceFiles, readWorkspaceFile } from "../api";
import type {
  ArtifactIndexItem,
  CurrentUser,
  EmployeeAgent,
  WorkspaceFileContentResponse,
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
} from "../types";
import { NavRefresh, WorkspaceFile, WorkspaceFolder } from "./icons";
import { PageHeader } from "./PageHeader";
import { ArtifactBody } from "./artifact/ArtifactBody";
import { CodeView, isHtmlFile, isMarkdownFile, isRenderableFile, languageForFile } from "./CodeView";
import { Markdown } from "./Markdown";
import { useUrlSearchState } from "../hooks/useUrlSearchState";

interface EmployeeWorkspacePageProps {
  employeeId: string;
  agent: EmployeeAgent | undefined;
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
}

// One active selection drives the preview pane: an artifact (rendered with the
// shared ArtifactBody) or a workspace file (rendered from its fetched content).
type Selection =
  | { type: "artifact"; artifact: ArtifactIndexItem }
  | { type: "file"; path: string; name: string };

// The browse pane folds artifacts + files into one column with a tab switcher,
// leaving the preview pane the dominant share of the width.
type BrowseTab = "artifacts" | "files";
const parseBrowseTab = (value: string | null): BrowseTab => value === "files" ? "files" : "artifacts";
const parseString = (value: string | null): string => value ?? "";

const WORKSPACE_BRIEF_POLL_MS = 3000;

function compactDate(value: string | undefined, locale: string): string {
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

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function EmployeeWorkspacePage({
  employeeId,
  agent,
  currentUser,
  isRefreshing,
  onRefresh,
  onOpenConversation,
}: EmployeeWorkspacePageProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [filePath, setFilePath] = useUrlSearchState("workspacePath", "", parseString, (value) => value || null);
  const [browseTab, setBrowseTab] = useUrlSearchState("workspaceTab", "artifacts" as BrowseTab, parseBrowseTab, (value) => value);
  const [selectedKey, setSelectedKey] = useUrlSearchState("workspaceItem", "", parseString, (value) => value || null);
  const previousScopeId = useRef(`${employeeId}:${agent?.id ?? ""}`);

  const query = useQuery({
    queryKey: ["workspace-brief", employeeId],
    enabled: Boolean(employeeId),
    refetchInterval: WORKSPACE_BRIEF_POLL_MS,
    queryFn: ({ signal }) => getWorkspaceBrief({ employeeId, agentId: agent?.id }, signal),
  });
  const fileQuery = useQuery({
    queryKey: ["workspace-files", employeeId, filePath],
    enabled: Boolean(employeeId),
    queryFn: ({ signal }) => listWorkspaceFiles({ employeeId, agentId: agent?.id, path: filePath }, signal),
  });
  const selectedFilePath = selected?.type === "file" ? selected.path : "";
  const contentQuery = useQuery({
    queryKey: ["workspace-file", employeeId, selectedFilePath],
    enabled: Boolean(employeeId) && selected?.type === "file",
    queryFn: ({ signal }) => readWorkspaceFile({ employeeId, agentId: agent?.id, path: selectedFilePath }, signal),
  });

  const brief = query.data;
  const initialLoading = query.isLoading && !brief;
  const loadError = !brief && query.error
    ? query.error instanceof Error ? query.error.message : String(query.error)
    : "";
  const displayName = agent?.displayName ?? t("workspace.no_agent");

  // Each agent is a distinct product workspace, even when several agents share
  // the same employee-owned filesystem behind the control-plane boundary.
  useEffect(() => {
    const scopeId = `${employeeId}:${agent?.id ?? ""}`;
    if (previousScopeId.current === scopeId) return;
    previousScopeId.current = scopeId;
    setFilePath("");
    setSelected(null);
    setSelectedKey("");
    setBrowseTab("artifacts");
  }, [agent?.id, employeeId, setBrowseTab, setFilePath, setSelectedKey]);

  useEffect(() => {
    if (!selectedKey) {
      setSelected(null);
      return;
    }
    if (selectedKey.startsWith("artifact:")) {
      const artifact = brief?.artifacts.find((item) => item.id === selectedKey.slice(9));
      if (artifact) setSelected({ type: "artifact", artifact });
      return;
    }
    if (selectedKey.startsWith("file:")) {
      const path = selectedKey.slice(5);
      setSelected({ type: "file", path, name: path.split("/").at(-1) || path });
    }
  }, [brief?.artifacts, selectedKey]);

  async function refreshWorkspace(): Promise<void> {
    await Promise.all([query.refetch(), fileQuery.refetch(), onRefresh()]);
  }

  function openDirectory(path: string): void {
    setFilePath(path);
  }

  function selectWorkspaceItem(selection: Selection): void {
    setSelected(selection);
    setSelectedKey(selection.type === "artifact" ? `artifact:${selection.artifact.id}` : `file:${selection.path}`);
  }

  function moveBrowseTab(event: KeyboardEvent<HTMLButtonElement>, next: BrowseTab): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home"
      ? "artifacts"
      : event.key === "End"
        ? "files"
        : next;
    setBrowseTab(target);
    requestAnimationFrame(() => document.getElementById(`workspace-tab-${target}`)?.focus());
  }

  return (
    <section id="workspace-panel" className="workspace-page" aria-label={t("workspace.title")} tabIndex={-1}>
      <PageHeader
        title={t("workspace.title")}
        count={brief ? t("workspace.sub", { employee: displayName }) : t("workspace.loading")}
        actions={(
          <button
            type="button"
            className="workspace-icon-btn"
            aria-label={t("nav.refresh")}
            disabled={isRefreshing || query.isFetching}
            onClick={() => void refreshWorkspace()}
          >
            <NavRefresh size={16} />
          </button>
        )}
      />

      {initialLoading ? (
        <WorkspaceLoading />
      ) : loadError ? (
        <WorkspaceError message={loadError} onRetry={() => void query.refetch()} />
      ) : (
        <div className="workspace-inspect">
          <div className="workspace-metric-strip" aria-label={t("workspace.metrics")}>
            <MetricItem label={t("workspace.metric_runs")} value={brief?.metrics.activeRunCount ?? 0} />
            <MetricItem label={t("workspace.metric_tasks")} value={brief?.metrics.activeTaskCount ?? 0} />
            <MetricItem label={t("workspace.metric_sessions")} value={brief?.metrics.sessionCount ?? 0} />
            <MetricItem label={t("workspace.metric_artifacts")} value={brief?.metrics.artifactCount ?? 0} />
          </div>

          <div className="workspace-panes">
            <section className="workspace-pane workspace-pane-browse" aria-label={t("workspace.browse")}>
              <div className="workspace-tabs" role="tablist" aria-label={t("workspace.browse")}>
                <button
                  type="button"
                  role="tab"
                  id="workspace-tab-artifacts"
                  aria-selected={browseTab === "artifacts"}
                  aria-controls="workspace-tabpanel-artifacts"
                  tabIndex={browseTab === "artifacts" ? 0 : -1}
                  className={`workspace-tab${browseTab === "artifacts" ? " is-active" : ""}`}
                  onClick={() => setBrowseTab("artifacts")}
                  onKeyDown={(event) => moveBrowseTab(event, "files")}
                >
                  {t("workspace.artifacts")}
                  <span className="workspace-tab-count mono">{brief?.artifacts.length ?? 0}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="workspace-tab-files"
                  aria-selected={browseTab === "files"}
                  aria-controls="workspace-tabpanel-files"
                  tabIndex={browseTab === "files" ? 0 : -1}
                  className={`workspace-tab${browseTab === "files" ? " is-active" : ""}`}
                  onClick={() => setBrowseTab("files")}
                  onKeyDown={(event) => moveBrowseTab(event, "artifacts")}
                >
                  {t("workspace.files")}
                </button>
              </div>

              {browseTab === "artifacts" ? (
                <div
                  className="workspace-pane-body"
                  role="tabpanel"
                  id="workspace-tabpanel-artifacts"
                  aria-labelledby="workspace-tab-artifacts"
                >
                  {brief?.artifacts.length ? (
                    <ul className="workspace-pick-list">
                      {brief.artifacts.map((artifact) => {
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
                  ) : (
                    <EmptyText text={t("workspace.no_artifacts")} />
                  )}
                </div>
              ) : (
                <div role="tabpanel" id="workspace-tabpanel-files" aria-labelledby="workspace-tab-files" className="workspace-tabpanel-files">
                  <div className="workspace-files-bar">
                    <span className="workspace-files-path mono" title={fileQuery.data?.workspacePath}>
                      /{filePath}
                    </span>
                  </div>
                  <FilesPane
                    data={fileQuery.data}
                    error={fileQuery.error}
                    isLoading={fileQuery.isLoading}
                    path={filePath}
                    selectedPath={selectedFilePath}
                    onOpenDirectory={openDirectory}
                    onSelectFile={(entry) => selectWorkspaceItem({ type: "file", path: entry.path, name: entry.name })}
                  />
                </div>
              )}
            </section>

            <section className="workspace-pane workspace-pane-preview" aria-label={t("workspace.preview")}>
              <PaneHeader
                title={selected ? (selected.type === "artifact" ? selected.artifact.title : selected.name) : t("workspace.preview")}
              />
              <div className="workspace-pane-body workspace-preview-body">
                {!selected ? (
                  <EmptyText text={t("workspace.select_to_preview")} />
                ) : selected.type === "artifact" ? (
                  <ArtifactBody artifact={selected.artifact} sessionId={selected.artifact.sessionId} />
                ) : (
                  <FilePreview
                    name={selected.name}
                    data={contentQuery.data}
                    isLoading={contentQuery.isLoading}
                    error={contentQuery.isError ? contentQuery.error : null}
                  />
                )}
                {selected?.type === "artifact" ? (
                  <button
                    type="button"
                    className="workspace-preview-open"
                    onClick={() => onOpenConversation(selected.artifact.sessionId)}
                  >
                    {t("workspace.open_thread")}
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function MetricItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="workspace-metric-item">
      <strong className="mono">{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function PaneHeader({ title, count, meta }: { title: string; count?: number; meta?: ReactNode }) {
  return (
    <header className="workspace-pane-head">
      <h3>{title}</h3>
      {count !== undefined ? <span className="mono">{count}</span> : null}
      {meta ?? null}
    </header>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="workspace-empty">{text}</p>;
}

function FilesPane({
  data,
  error,
  isLoading,
  path,
  selectedPath,
  onOpenDirectory,
  onSelectFile,
}: {
  data?: WorkspaceFilesResponse;
  error: unknown;
  isLoading: boolean;
  path: string;
  selectedPath: string;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (entry: WorkspaceFileEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const entries = data?.entries ?? [];
  const message = error instanceof Error ? error.message : error ? String(error) : "";

  return (
    <div className="workspace-pane-body">
      {path ? (
        <button type="button" className="workspace-file-up" onClick={() => onOpenDirectory(parentPath(path))}>
          {t("workspace.parent_directory")}
        </button>
      ) : null}

      {isLoading ? (
        <EmptyText text={t("workspace.loading_files")} />
      ) : message ? (
        <EmptyText text={message} />
      ) : data && !data.exists ? (
        <EmptyText text={t("workspace.files_unavailable")} />
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
        <EmptyText text={t("workspace.no_files")} />
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
        {isDirectory ? entry.kind : formatBytes(entry.bytes) || entry.kind} · {compactDate(entry.updatedAt, locale)}
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
  data?: WorkspaceFileContentResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  // Presentation files (Markdown, HTML) have a rendered preview in addition to
  // their highlighted source; everything else is source-only.
  const renderable = isRenderableFile(name);
  const [rendered, setRendered] = useState(renderable);
  // Re-sync the view mode when the selection changes to a different file kind.
  useEffect(() => {
    setRendered(renderable);
  }, [name, renderable]);

  if (isLoading) {
    return <p className="artifact-viewer-status">{t("workspace.loading_preview")}</p>;
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
  return (
    <div className="artifact-viewer-body">
      {renderable ? (
        <div className="code-view-toolbar" role="group" aria-label={t("workspace.view_mode")}>
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
      {showRendered && isMarkdownFile(name) ? (
        <Markdown text={data.content} />
      ) : showRendered && isHtmlFile(name) ? (
        <HtmlPreview html={data.content} title={name} />
      ) : (
        <CodeView code={data.content} language={languageForFile(name)} />
      )}
      {data.truncated ? (
        <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes) })}</p>
      ) : null}
    </div>
  );
}

// Renders untrusted workspace HTML inside a fully sandboxed iframe: no
// scripts, no same-origin access, no form submission — the document can only
// lay itself out for visual preview.
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

function WorkspaceLoading() {
  const { t } = useTranslation();
  return (
    <div className="workspace-inspect" aria-busy="true" aria-label={t("workspace.loading")}>
      <div className="workspace-metric-strip">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="workspace-skeleton workspace-skeleton-metric" />
        ))}
      </div>
      <div className="workspace-panes">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="workspace-pane workspace-skeleton-pane">
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
    <div className="workspace-inspect">
      <div className="workspace-error" role="alert">
        <span className="workspace-eyebrow">{t("workspace.load_failed")}</span>
        <p>{message}</p>
        <button type="button" className="workspace-error-action" onClick={onRetry}>
          {t("workspace.retry")}
        </button>
      </div>
    </div>
  );
}
