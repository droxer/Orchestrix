export function selectedTeamForWorkspace<T extends { id: string }>(
  teams: readonly T[],
  requestedTeamId: string | null,
): T | null {
  if (!requestedTeamId) return null;
  return teams.find((team) => team.id === requestedTeamId) ?? null;
}
