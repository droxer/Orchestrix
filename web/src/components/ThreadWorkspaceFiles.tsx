"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  listAgentWorkspaceFiles,
  listProjectWorkspaceFiles,
  readAgentWorkspaceFile,
  readProjectWorkspaceFile,
} from "../api";
import type {
  AgentWorkspaceFileResponse,
  WorkspaceFileEntry,
  AgentWorkspaceFilesResponse,
  ProjectWorkspaceFileResponse,
  ProjectWorkspaceFilesResponse,
  WorkspaceBriefSession,
} from "../types";
import { isWorkspaceRetryableError, preferredWorkspaceThreadId, workspaceFilesEmptyState, workspaceHomeStatus } from "../lib/workspaceHome";
import { ActionRemove, WorkspaceFile, WorkspaceFolder } from "./icons";
import { compactDate } from "../lib/workspaceFormat";
import {
  WorkspaceEmpty,
  WorkspaceLoading,
} from "./workspace/WorkspacePrimitives";
import { Button } from "@/components/ui/button";
import { CodeView, imageMimeForFile, isHtmlFile, isMarkdownFile, isPdfFile, isRenderableFile, languageForFile } from "./CodeView";
import { Markdown } from "./Markdown";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FileSelection = { path: string; name: string };

const parseString = (value: string | null): string => value ?? "";

/** Agent-private files vs the shared root inside the selected Thread workspace. */
type WorkspaceFileScope = "personal" | "shared";
const parseFileScope = (value: string | null): WorkspaceFileScope => value === "shared" ? "shared" : "personal";

type WorkspaceListingResponse = AgentWorkspaceFilesResponse | ProjectWorkspaceFilesResponse;
type WorkspacePreviewResponse = AgentWorkspaceFileResponse | ProjectWorkspaceFileResponse;
type WorkspaceTarget =
  | {
      kind: "thread";
      agentId: string;
      teamId?: string;
      threads: WorkspaceBriefSession[];
      fixedScope?: WorkspaceFileScope;
      refreshVersion: number;
    }
  | { kind: "project"; projectId: string; refreshVersion: number };

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

export function ThreadWorkspaceFiles({
  agentId,
  teamId,
  threads = [],
  fixedScope,
  emptyMark,
  refreshVersion = 0,
}: {
  agentId: string;
  teamId?: string;
  threads?: WorkspaceBriefSession[];
  fixedScope?: WorkspaceFileScope;
  emptyMark?: ReactNode;
  refreshVersion?: number;
}) {
  return (
    <WorkspaceFileBrowser
      target={{
        kind: "thread",
        agentId,
        teamId,
        threads,
        fixedScope,
        refreshVersion,
      }}
      emptyMark={emptyMark}
    />
  );
}

/** Persistent shared project root; unlike a Thread workspace it has no scope
 * or Thread selector and is available before the first conversation exists. */
export function ProjectWorkspaceFiles({
  projectId,
  emptyMark,
  refreshVersion = 0,
}: {
  projectId: string;
  emptyMark?: ReactNode;
  refreshVersion?: number;
}) {
  return (
    <WorkspaceFileBrowser
      target={{ kind: "project", projectId, refreshVersion }}
      emptyMark={emptyMark}
    />
  );
}

function WorkspaceFileBrowser({
  target,
  emptyMark,
}: {
  target: WorkspaceTarget;
  emptyMark?: ReactNode;
}) {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useUrlSearchState("path", "", parseString, (value) => value || null);
  const [selectedKey, setSelectedKey] = useUrlSearchState("item", "", parseString, (value) => value || null);
  const [requestedThreadId, setRequestedThreadId] = useUrlSearchState("thread", "", parseString, (value) => value || null);
  const [selectableScope, setSelectableScope] = useUrlSearchState(
    "scope",
    "personal" as WorkspaceFileScope,
    parseFileScope,
    (value) => value === "personal" ? null : value,
  );
  const [snapshotBannerDismissed, setSnapshotBannerDismissed] = useState(false);
  const threads = target.kind === "thread" ? target.threads : [];
  const selectedThreadId = preferredWorkspaceThreadId(threads, requestedThreadId);
  const fileScope = target.kind === "project" ? "shared" : target.fixedScope ?? selectableScope;
  const targetKey = target.kind === "project"
    ? `project:${target.projectId}`
    : `thread:${target.agentId}:${target.teamId ?? ""}:${selectedThreadId}`;
  const selectedPath = selectedKey.startsWith("file:") ? selectedKey.slice(5) : "";
  const selected: FileSelection | null = selectedPath
    ? { path: selectedPath, name: selectedPath.split("/").at(-1) || selectedPath }
    : null;
  const fileQuery = useQuery({
    queryKey: ["workspace-files", targetKey, fileScope, filePath, target.refreshVersion],
    queryFn: ({ signal }): Promise<WorkspaceListingResponse> => target.kind === "project"
      ? listProjectWorkspaceFiles({ projectId: target.projectId, path: filePath }, signal)
      : listAgentWorkspaceFiles({
          agentId: target.agentId,
          threadId: selectedThreadId,
          teamId: target.teamId,
          path: filePath,
          scope: fileScope === "shared" ? "shared" : undefined,
        }, signal),
    enabled: target.kind === "project" || Boolean(target.agentId && selectedThreadId),
  });
  const contentQuery = useQuery({
    queryKey: ["workspace-file", targetKey, fileScope, selectedPath, target.refreshVersion],
    enabled: Boolean(selectedPath && (target.kind === "project" || (target.agentId && selectedThreadId))),
    queryFn: ({ signal }): Promise<WorkspacePreviewResponse> => target.kind === "project"
      ? readProjectWorkspaceFile({ projectId: target.projectId, path: selectedPath }, signal)
      : readAgentWorkspaceFile({
          agentId: target.agentId,
          threadId: selectedThreadId,
          teamId: target.teamId,
          path: selectedPath,
          scope: fileScope === "shared" ? "shared" : undefined,
        }, signal),
  });
  const homeStatus = workspaceHomeStatus(fileQuery.data, snapshotBannerDismissed);

  useEffect(() => {
    setSnapshotBannerDismissed(false);
  }, [targetKey, fileScope]);

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

  function threadLabel(threadId: string): string {
    const thread = threads.find((candidate) => candidate.id === threadId);
    return thread?.title?.trim() || thread?.taskGoal?.trim() || threadId;
  }

  function switchThread(next: string | null): void {
    if (!next || next === selectedThreadId) return;
    setRequestedThreadId(next);
    setFilePath("");
    setSelectedKey("");
  }

  if (target.kind === "thread" && !target.agentId) {
    return <WorkspaceEmpty title={t("workspace.files_unavailable")} mark={emptyMark ?? <WorkspaceFile size={18} />} announce />;
  }

  return (
    <div className={`workspace-panes${selected ? "" : " is-browse-only"}`}>
      <section className="workspace-pane workspace-pane-browse" aria-label={t("workspace.tab_files")}>
        <div className="workspace-tabpanel-files">
          {/* One toolbar, not four stacked strips. Scope, location, thread, and
              source are what you need before opening a file, so they share one
              line. The thread picker stays in BOTH scopes because the shared
              root and every Agent-private subdirectory belong to that Thread. */}
          <div className="workspace-files-bar">
            {target.kind === "thread" && !target.fixedScope ? (
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
                    title={scopeOption === "personal" ? t("workspace.scope_personal_hint") : t("workspace.scope_shared_hint")}
                    onClick={() => switchFileScope(scopeOption)}
                  >
                    {scopeOption === "personal" ? t("workspace.scope_personal") : t("workspace.scope_shared")}
                  </Button>
                ))}
              </span>
            ) : null}
            <WorkspacePathBreadcrumb path={filePath} onNavigate={openDirectory} />
            <div className="workspace-files-bar-end">
              {target.kind === "thread" && threads.length ? (
                <Select value={selectedThreadId} onValueChange={switchThread}>
                  <SelectTrigger className="workspace-thread-select" aria-label={t("workspace.thread_label")}>
                    {/* The label is passed explicitly: the items only register
                        with Radix once the popover has been opened, so a bare
                        <SelectValue /> printed the raw session id until the
                        first interaction. */}
                    <SelectValue>{threadLabel(selectedThreadId)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {threads.map((thread) => (
                      <SelectItem key={thread.id} value={thread.id}>
                        {threadLabel(thread.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {homeStatus.kind === "live" ? (
                <span className="workspace-home-status" title={homeStatus.nodeId || undefined}>
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
          </div>
          {target.kind === "thread" && !target.fixedScope && fileScope === "personal" && homeStatus.kind === "snapshot-banner" ? (
            <SnapshotBanner onDismiss={() => setSnapshotBannerDismissed(true)} />
          ) : null}
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
  data?: WorkspaceListingResponse;
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
    <Button
      variant="ghost"
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
    </Button>
  );
}

function FilePreview({
  name,
  data,
  isLoading,
  error,
}: {
  name: string;
  data?: WorkspacePreviewResponse;
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
    const imageMime = imageMimeForFile(name);
    const media = data.contentBase64
      ? imageMime
        ? { kind: "image" as const, src: `data:${imageMime};base64,${data.contentBase64}` }
        : isPdfFile(name)
          ? { kind: "pdf" as const, src: `data:application/pdf;base64,${data.contentBase64}` }
          : null
      : null;
    if (!media) {
      return <p className="artifact-viewer-status">{t("workspace.binary_file")}</p>;
    }
    return (
      <div className="workspace-preview-viewport is-bleed">
        <div className="artifact-viewer-body is-bleed">
          {media.kind === "image" ? (
            <img className="artifact-image-preview" src={media.src} alt={name} />
          ) : (
            <iframe className="artifact-frame-preview" title={name} src={media.src} />
          )}
          {data.truncated ? (
            <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes, i18n.language) })}</p>
          ) : null}
        </div>
      </div>
    );
  }
  if (!data.content || !data.content.trim()) {
    return <p className="artifact-viewer-status">{t("workspace.empty_file")}</p>;
  }
  const showRendered = renderable && rendered;
  const bleed = showRendered && (isMarkdownFile(name) || isHtmlFile(name));
  return (
    <div className={`workspace-preview-viewport${bleed ? " is-bleed" : ""}`}>
      {renderable ? (
        // Always in-flow, never floating: a floating variant made the toggle
        // overlay the content in Rendered mode but sit in normal flow in
        // Source mode, so the control visibly jumped position on toggle.
        <div
          className="code-view-toolbar"
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
          <Markdown text={data.content} variant="document" />
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
