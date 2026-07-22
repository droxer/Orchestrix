export function selectedTeamForWorkspace<T extends { id: string }>(
  teams: readonly T[],
  requestedTeamId: string | null,
): T | null {
  return teams.find((team) => team.id === requestedTeamId) ?? teams[0] ?? null;
}
