import type { RelayArtifact } from "relay-core";

export function filterArtifacts(
  artifacts: RelayArtifact[],
  query: string,
  kind: RelayArtifact["kind"] | "all",
): RelayArtifact[] {
  const needle = query.trim().toLowerCase();
  return artifacts.filter((a) => {
    if (kind !== "all" && a.kind !== kind) return false;
    if (!needle) return true;
    const path = a.workspaceRelativePath ?? a.path ?? "";
    return `${a.title} ${path}`.toLowerCase().includes(needle);
  });
}
