import type { RelayArtifact } from "relay-core";
import { relayApiPath } from "relay-core/api-url";

import { isHtmlFile, isMarkdownFile } from "./fileKinds.ts";

/** Raw download/streaming URL for an artifact body. */
export function artifactRawHref(sessionId: string, artifactId: string): string {
  return relayApiPath(`/threads/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`);
}

export type WorkspaceFilePreviewMode = "image" | "pdf" | "html" | "text" | "none";

/** How a generated workspace file can be previewed, from its content type. */
export function workspaceFilePreviewMode(contentType: string | undefined): WorkspaceFilePreviewMode {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type === "text/html") return "html";
  if (type.startsWith("text/") || type === "application/json") return "text";
  return "none";
}

/** Which rendered presentation an artifact has *in addition to* its source
 *  text. "none" means the source is the only reading of it, so the panel
 *  offers no view switch. */
export type ArtifactRenderMode = "markdown" | "html" | "none";

/** Artifact kinds whose bodies agents author as Markdown. The remaining text
 *  kinds (diff, command_log, test_output, agent_output) are raw streams with
 *  their own dedicated rendering — Markdown would corrupt them. */
const MARKDOWN_KINDS: ReadonlySet<RelayArtifact["kind"]> = new Set(["plan", "review", "summary"]);

/** Best filename for an artifact — the workspace path wins over the display
 *  title, which is free text and need not carry an extension. */
export function artifactFileName(artifact: RelayArtifact): string {
  return artifact.workspaceRelativePath ?? artifact.path ?? artifact.title ?? "";
}

/** Whether the artifact renders to something other than its source, and how.
 *  Content type leads for workspace files (the daemon reports it); the
 *  filename is the fallback for the Markdown case, which arrives as a plain
 *  `text/*` type indistinguishable from a log. */
export function artifactRenderMode(artifact: RelayArtifact): ArtifactRenderMode {
  if (artifact.kind !== "workspace_file") {
    return MARKDOWN_KINDS.has(artifact.kind) ? "markdown" : "none";
  }
  const mode = workspaceFilePreviewMode(artifact.contentType);
  if (mode === "html") return "html";
  // Images and PDFs have no source reading, and binaries have no preview at
  // all — neither earns a switch.
  if (mode !== "text") return "none";
  const name = artifactFileName(artifact);
  if (isMarkdownFile(name)) return "markdown";
  if (isHtmlFile(name)) return "html";
  return "none";
}
