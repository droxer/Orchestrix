import type { RelayArtifact } from "relay-core";
import { relayApiPath } from "relay-core/api-url";

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

// Extension sets duplicated from components/CodeView rather than imported:
// this module is compiled by the NodeNext test build, which cannot pull in a
// .tsx component. Parity is covered by web/tests/artifactPreview.test.ts.
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown"]);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(["html", "htm"]);

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

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
  const extension = extensionOf(artifactFileName(artifact));
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (HTML_EXTENSIONS.has(extension)) return "html";
  return "none";
}
