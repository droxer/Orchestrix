"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTaskWorkspaceFiles, readTaskWorkspaceFile } from "../../api";
import type {
  TaskWorkspaceFileResponse,
  TaskWorkspaceFilesResponse,
} from "../../types";
import {
  WorkspaceFileList,
  WorkspacePathBreadcrumb,
} from "../workspace/WorkspaceFileList";
import { WorkspaceFilePreview } from "../workspace/WorkspaceFilePreview";
import { languageForFile } from "../CodeView";
import { ICON, NavBack } from "../icons";
import { Button } from "@/components/ui/button";
import { taskWorkspaceState } from "./taskWorkspaceState";

/** The directory this task's rounds share, browsed inside the task drawer.
 *
 *  Live reads only: the workspace exists on the computer that ran the task, so
 *  an offline computer renders as an explained empty state rather than an
 *  error. The artifact list above stays the durable record either way.
 *
 *  A routine lists its occurrence directories; the routine itself never runs. */
export function TaskDrawerWorkspace({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const selectedName = selectedPath ? selectedPath.split("/").at(-1) || selectedPath : "";

  // The fourth key element is a refresh-version counter on the sibling
  // ProjectWorkspaceFiles, bumped by a manual refresh button there. The
  // drawer has no such affordance yet, so it stays a fixed 0 rather than a
  // wired-up counter — reserving the slot without inventing a control.
  const fileQuery = useQuery({
    queryKey: ["workspace-files", `task:${taskId}`, path, 0],
    retry: false,
    queryFn: ({ signal }): Promise<TaskWorkspaceFilesResponse> =>
      listTaskWorkspaceFiles({ taskId, path }, signal),
  });
  // Same reservation as fileQuery above: no manual refresh in the drawer yet.
  const contentQuery = useQuery({
    queryKey: ["workspace-file", `task:${taskId}`, selectedPath, 0],
    enabled: Boolean(selectedPath),
    retry: false,
    queryFn: ({ signal }): Promise<TaskWorkspaceFileResponse> =>
      readTaskWorkspaceFile({ taskId, path: selectedPath }, signal),
  });

  function openDirectory(next: string): void {
    setPath(next);
    setSelectedPath("");
  }

  const state = taskWorkspaceState({
    isLoading: fileQuery.isLoading,
    error: fileQuery.error,
    data: fileQuery.data,
    path,
  });

  return (
    <section className="task-drawer-artifacts" aria-label={t("backlog.workspace")}>
      <h3 className="task-drawer-artifacts-title">{t("backlog.workspace")}</h3>
      {state === "loading" ? (
        <p className="task-drawer-artifacts-empty" role="status" aria-live="polite">
          {t("backlog.workspace_loading")}
        </p>
      ) : state === "unavailable" ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.workspace_unavailable")}</p>
      ) : state === "failed" ? (
        <p className="task-drawer-artifacts-empty" role="alert">
          {t("backlog.workspace_error")}
        </p>
      ) : state === "empty" ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.workspace_empty")}</p>
      ) : selectedPath ? (
        <div className="thread-space-files">
          <div className="thread-space-files-bar">
            <Button
              variant="ghost"
              type="button"
              className="thread-space-back"
              onClick={() => setSelectedPath("")}
            >
              <NavBack size={ICON.sm} />
              <span>{selectedName}</span>
            </Button>
            <span className="workspace-preview-file-type code">{languageForFile(selectedName)}</span>
          </div>
          <div className="thread-space-files-body">
            <WorkspaceFilePreview
              name={selectedName}
              data={contentQuery.data}
              isLoading={contentQuery.isLoading}
              error={contentQuery.isError ? contentQuery.error : null}
            />
          </div>
        </div>
      ) : (
        <div className="thread-space-files">
          <div className="thread-space-files-bar">
            <WorkspacePathBreadcrumb path={path} onNavigate={openDirectory} />
          </div>
          <div className="thread-space-files-body">
            <WorkspaceFileList
              data={fileQuery.data}
              error={fileQuery.error}
              isLoading={fileQuery.isLoading}
              path={path}
              selectedPath={selectedPath}
              onOpenDirectory={openDirectory}
              onSelectFile={(entry) => setSelectedPath(entry.path)}
              onRetry={() => void fileQuery.refetch()}
            />
          </div>
        </div>
      )}
    </section>
  );
}
