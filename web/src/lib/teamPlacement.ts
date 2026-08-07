/* A team's agents all live on one computer. Removing or moving one member's
   placement alone would split the team, so the backend refuses it — these
   helpers let the UI say so before the request rather than after. */

type PlacementBearingAgent = {
  id: string;
};

type MembershipTeam = {
  name: string;
  memberAgentIds: string[];
};

/** The agent's teams that other agents also belong to. */
export function teamsBlockingPlacementChange(
  agent: PlacementBearingAgent,
  teams: ReadonlyArray<MembershipTeam>,
): MembershipTeam[] {
  return teams.filter(
    (team) => team.memberAgentIds.includes(agent.id) && team.memberAgentIds.length > 1,
  );
}

type PlaceableComputer = {
  id: string;
  employeeId?: string;
  retiredAt?: string;
};

/**
 * The computers a team may be moved onto.
 *
 * Deliberately wider than the thread picker's `selectableThreadComputers`,
 * which admits only live machines. A placement says where an agent *belongs*,
 * not that it can run this second — gating on liveness would strand a team
 * whose computer is briefly offline, exactly when someone needs to move it.
 */
export function placeableTeamComputers<T extends PlaceableComputer>(
  nodes: readonly T[],
  employeeId: string,
): T[] {
  return nodes.filter((node) => node.employeeId === employeeId && !node.retiredAt);
}

/** True when this agent cannot give up its computer without splitting a team. */
export function blocksPlacementRemoval(
  agent: PlacementBearingAgent,
  teams: ReadonlyArray<MembershipTeam>,
): boolean {
  return teamsBlockingPlacementChange(agent, teams).length > 0;
}
