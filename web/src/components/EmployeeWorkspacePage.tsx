"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getWorkspaceBrief, listWorkspaceFiles, readWorkspaceFile } from "../api";
import type {
  ArtifactIndexItem,
  CurrentUser,
  Tone,
  WorkspaceFileContentResponse,
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
} from "../types";
import { NavRefresh, WorkspaceFile, WorkspaceFolder } from "./icons";
import { PageHeader } from "./PageHeader";
import { ArtifactBody } from "./artifact/ArtifactBody";

type StatusUpdate = { tone: Tone; message: string };

interface EmployeeWorkspacePageProps {
  employeeId: string;
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
  setStatus: (status: StatusUpdate) => void;
}

// One active selection drives the preview pane: an artifact (rendered with the
// shared ArtifactBody) or a workspace file (rendered from its fetched content).
type Selection =
  | { type: "artifact"; artifact: ArtifactIndexItem }
  | { type: "file"; path: string; name: string };

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
  currentUser,
  isRefreshing,
  onRefresh,
  onOpenConversation,
  setStatus,
}: EmployeeWorkspacePageProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [filePath, setFilePath] = useState("");

  const query = useQuery({
    queryKey: ["workspace-brief", employeeId],
    enabled: Boolean(employeeId),
    refetchInterval: WORKSPACE_BRIEF_POLL_MS,
    queryFn: ({ signal }) => getWorkspaceBrief({ employeeId }, signal),
  });
  const fileQuery = useQuery({
    queryKey: ["workspace-files", employeeId, filePath],
    enabled: Boolean(employeeId),
    queryFn: ({ signal }) => listWorkspaceFiles({ employeeId, path: filePath }, signal),
  });
  const selectedFilePath = selected?.type === "file" ? selected.path : "";
  const contentQuery = useQuery({
    queryKey: ["workspace-file", employeeId, selectedFilePath],
    enabled: Boolean(employeeId) && selected?.type === "file",
    queryFn: ({ signal }) => readWorkspaceFile({ employeeId, path: selectedFilePath }, signal),
  });

  const brief = query.data;
  const initialLoading = query.isLoading && !brief;
  const loadError = !brief && query.error
    ? query.error instanceof Error ? query.error.message : String(query.error)
    : "";
  const displayName = currentUser.employeeId === employeeId
    ? currentUser.displayName || currentUser.username || employeeId
    : employeeId;

  useEffect(() => {
    if (!query.error) return;
    setStatus({
      tone: "warn",
      message: query.error instanceof Error ? query.error.message : String(query.error),
    });
  }, [query.error, setStatus]);

  // Switching employees resets navigation + selection so the panes never show
  // another employee's path or a stale preview.
  useEffect(() => {
    setFilePath("");
    setSelected(null);
  }, [employeeId]);

  useEffect(() => {
    if (!fileQuery.error) return;
    setStatus({
      tone: "warn",
      message: fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error),
    });
  }, [fileQuery.error, setStatus]);

  async function refreshWorkspace(): Promise<void> {
    await Promise.all([query.refetch(), fileQuery.refetch(), onRefresh()]);
  }

  function openDirectory(path: string): void {
    setFilePath(path);
  }

  return (
    <section className="workspace-page" aria-label={t("workspace.title")}>
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
            <section className="workspace-pane workspace-pane-artifacts" aria-label={t("workspace.artifacts")}>
              <PaneHeader title={t("workspace.artifacts")} count={brief?.artifacts.length ?? 0} />
              <div className="workspace-pane-body">
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
                            onClick={() => setSelected({ type: "artifact", artifact })}
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
            </section>

            <section className="workspace-pane workspace-pane-files" aria-label={t("workspace.files")}>
              <PaneHeader
                title={t("workspace.files")}
                meta={(
                  <span className="workspace-files-path mono" title={fileQuery.data?.workspacePath}>
                    /{filePath}
                  </span>
                )}
              />
              <FilesPane
                data={fileQuery.data}
                error={fileQuery.error}
                isLoading={fileQuery.isLoading}
                path={filePath}
                selectedPath={selectedFilePath}
                onOpenDirectory={openDirectory}
                onSelectFile={(entry) => setSelected({ type: "file", path: entry.path, name: entry.name })}
              />
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
  data,
  isLoading,
  error,
}: {
  data?: WorkspaceFileContentResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
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
  return (
    <div className="artifact-viewer-body">
      <pre className="artifact-plain">{data.content}</pre>
      {data.truncated ? (
        <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes) })}</p>
      ) : null}
    </div>
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
