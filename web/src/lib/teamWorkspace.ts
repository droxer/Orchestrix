import type { TeamMemberSummary } from "../types.js";

export function selectedTeamForWorkspace<T extends { id: string }>(
  teams: readonly T[],
  requestedTeamId: string | null,
): T | null {
  if (!requestedTeamId) return null;
  return teams.find((team) => team.id === requestedTeamId) ?? null;
}

export function teamWorkspaceAgentId(team: {
  leadAgentId?: string | null;
  members: readonly TeamMemberSummary[];
}): string {
  const readableMembers = team.members.filter(
    (member) => member.enabled && (member.availability === "ready" || member.availability === "busy"),
  );
  return readableMembers.find((member) => member.id === team.leadAgentId)?.id
    ?? readableMembers[0]?.id
    ?? team.leadAgentId
    ?? team.members[0]?.id
    ?? "";
}
