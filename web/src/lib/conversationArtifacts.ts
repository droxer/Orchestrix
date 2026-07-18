import type { RelayArtifact, RelaySession } from "../types.js";

export function visibleConversationArtifacts(session: RelaySession | undefined): RelayArtifact[] {
  if (!session) return [];
  return (session.artifacts ?? [])
    .filter((artifact) => artifact.kind !== "command_log")
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
