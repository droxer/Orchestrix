import type { AgentWorkspaceFilesResponse, AgentWorkspaceSource } from "../types.js";

/** What the Files pane header shows about the agent home's data source. */
export type WorkspaceHomeStatus =
  | { kind: "live"; nodeId: string | null }
  | { kind: "snapshot-banner" }
  | { kind: "snapshot-chip" }
  | { kind: "none" };

export function workspaceHomeStatus(
  files: (Pick<AgentWorkspaceFilesResponse, "source"> & { nodeId?: string | null }) | undefined,
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
  // Structural check avoids a value import of RelayApiError (Next webpack
  // cannot resolve the NodeNext `.js` specifier that packages/tsconfig needs).
  return error instanceof Error
    && "status" in error
    && (error as Error & { status: unknown }).status === 503;
}
