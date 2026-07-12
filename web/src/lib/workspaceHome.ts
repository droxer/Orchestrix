import { RelayApiError } from "../api";
import type { AgentWorkspaceFilesResponse, AgentWorkspaceSource } from "../types";

/** What the Files pane header shows about the agent home's data source. */
export type WorkspaceHomeStatus =
  | { kind: "live"; nodeId: string | null }
  | { kind: "snapshot-banner" }
  | { kind: "snapshot-chip" }
  | { kind: "none" };

export function workspaceHomeStatus(
  files: Pick<AgentWorkspaceFilesResponse, "source" | "nodeId"> | undefined,
  bannerDismissed: boolean,
): WorkspaceHomeStatus {
  if (files?.source === "live") return { kind: "live", nodeId: files.nodeId ?? null };
  if (files?.source === "snapshot") return bannerDismissed ? { kind: "snapshot-chip" } : { kind: "snapshot-banner" };
  return { kind: "none" };
}

/** i18n keys for the empty Files pane; snapshot homes get the artifact-history explainer. */
export function workspaceFilesEmptyState(source: AgentWorkspaceSource | undefined): {
  titleKey: "workspace.no_files_yet" | "workspace.no_files";
  hintKey: "workspace.empty_files_snapshot_hint" | null;
} {
  if (source === "snapshot") {
    return { titleKey: "workspace.no_files_yet", hintKey: "workspace.empty_files_snapshot_hint" };
  }
  return { titleKey: "workspace.no_files", hintKey: null };
}

/** Only a placement-unavailable (503) listing failure gets a retry button. */
export function isWorkspaceRetryableError(error: unknown): boolean {
  return error instanceof RelayApiError && error.status === 503;
}
