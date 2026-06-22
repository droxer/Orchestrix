import type {
  AgentName,
  DaemonAgentMcpServer,
  DaemonAgentSkill,
  DaemonNodeMonitorRecord,
} from "relay-core";

// Defined locally (not imported from "../types") so this browser-bundled module
// never pulls a runtime value across the relative `.js` boundary — Turbopack
// can't resolve the NodeNext `.js` specifier the test build requires. Mirrors
// the same canonical list in web/src/types.ts.
const AGENT_NAMES: AgentName[] = ["claude", "pi", "codex", "kimi"];

// Aggregates the per-agent skill/MCP inventory the daemons report on their node
// records into a fleet-wide, per-agent view. Skills/servers with the same
// identity across nodes collapse into one row.

export interface AggregatedAgentInventory<T> {
  agent: AgentName;
  items: T[];
}

function skillKey(skill: DaemonAgentSkill): string {
  return `${skill.namespace ?? ""}/${skill.name}`;
}

export function aggregateSkillsByAgent(
  nodes: DaemonNodeMonitorRecord[],
): AggregatedAgentInventory<DaemonAgentSkill>[] {
  return AGENT_NAMES.map((agent) => {
    const seen = new Map<string, DaemonAgentSkill>();
    for (const node of nodes) {
      for (const skill of node.agentInventory?.[agent]?.skills ?? []) {
        const key = skillKey(skill);
        if (!seen.has(key)) seen.set(key, skill);
      }
    }
    const items = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { agent, items };
  });
}

export function aggregateMcpByAgent(
  nodes: DaemonNodeMonitorRecord[],
): AggregatedAgentInventory<DaemonAgentMcpServer>[] {
  return AGENT_NAMES.map((agent) => {
    const seen = new Map<string, DaemonAgentMcpServer>();
    for (const node of nodes) {
      for (const server of node.agentInventory?.[agent]?.mcpServers ?? []) {
        if (!seen.has(server.name)) seen.set(server.name, server);
      }
    }
    const items = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { agent, items };
  });
}

export function totalItemCount<T>(groups: AggregatedAgentInventory<T>[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}
