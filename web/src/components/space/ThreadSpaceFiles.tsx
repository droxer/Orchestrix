"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listProjectWorkspaceFiles, readProjectWorkspaceFile } from "../../api";
import type {
  ProjectWorkspaceFileResponse,
  ProjectWorkspaceFilesResponse,
} from "../../types";
import {
  WorkspaceFileList,
  WorkspacePathBreadcrumb,
} from "../workspace/WorkspaceFileList";
import { WorkspaceFilePreview } from "../workspace/WorkspaceFilePreview";
import { languageForFile } from "../CodeView";
import { ICON, NavBack } from "../icons";
import { Button } from "@/components/ui/button";

/** The project workspace, browsed inside the thread output panel.
 *
 *  One column, not the page's two panes: the panel is a few hundred pixels
 *  wide, so opening a file replaces the listing and a back control returns
 *  to it — the same drill-down the artifact list already uses.
 *
 *  Selection is local state rather than `?path`/`?item` search params: those
 *  belong to the full project workspace page, and sharing them would make a
 *  file opened in the panel reopen there (and vice versa) on the next visit. */
export function ThreadSpaceFiles({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const selectedName = selectedPath ? selectedPath.split("/").at(-1) || selectedPath : "";

  const fileQuery = useQuery({
    queryKey: ["workspace-files", `project:${projectId}`, path, 0],
    queryFn: ({ signal }): Promise<ProjectWorkspaceFilesResponse> =>
      listProjectWorkspaceFiles({ projectId, path }, signal),
  });
  const contentQuery = useQuery({
    queryKey: ["workspace-file", `project:${projectId}`, selectedPath, 0],
    enabled: Boolean(selectedPath),
    queryFn: ({ signal }): Promise<ProjectWorkspaceFileResponse> =>
      readProjectWorkspaceFile({ projectId, path: selectedPath }, signal),
  });

  function openDirectory(next: string): void {
    setPath(next);
    setSelectedPath("");
  }

  if (selectedPath) {
    return (
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
    );
  }

  return (
    <div className="thread-space-files">
      <div className="thread-space-files-bar">
        <WorkspacePathBreadcrumb path={path} onNavigate={openDirectory} />
      </div>
      <div className="thread-space-files-body" aria-label={t("workspace.tab_files")}>
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
  );
}
