import { relayApiPath } from "relay-core";

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
