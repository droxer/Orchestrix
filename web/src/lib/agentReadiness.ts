import type { TFunction } from "i18next";
import type { AgentName, DaemonNodeMonitorRecord, Tone } from "../types.js";

export type AgentReadiness = "ready" | "disabled" | "failed" | "unknown";

type NodeAgentState = Pick<DaemonNodeMonitorRecord, "agents" | "disabledAgents"> | undefined;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function agentReadiness(node: NodeAgentState, agent: AgentName): AgentReadiness {
  if ((node?.disabledAgents ?? []).includes(agent)) return "disabled";
  const status = node?.agents?.[agent] ?? "unknown";
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  return "unknown";
}

export function isAgentDispatchReady(node: NodeAgentState, agent: AgentName): boolean {
  return agentReadiness(node, agent) === "ready";
}

/** Readiness → tone. Unknown ("no signal yet") maps to warn so it stays
    distinct from disabled — a deliberate operator choice that maps to calm
    neutral. The two must never collapse onto the same tier. */
export function agentReadinessTone(readiness: AgentReadiness): Tone {
  switch (readiness) {
    case "ready":
      return "good";
    case "failed":
      return "bad";
    case "unknown":
      return "warn";
    case "disabled":
      return "neutral";
  }
}

export function agentReadinessLabel(readiness: AgentReadiness, t: TFunction): string {
  if (readiness === "disabled") return t("admin.v2.agent_disabled");
  return t(`status.${readiness}`, { defaultValue: readiness });
}

export function dispatchReadyAgents(node: NodeAgentState, agentNames: AgentName[]): AgentName[] {
  return agentNames.filter((agent) => isAgentDispatchReady(node, agent));
}

const NOT_READY_AGENTS_RE = /does not have ready agent\(s\): ([^.]+)/i;
const WORKSPACE_UNAVAILABLE_RE = /^Agent (.+?) has no eligible runtime placement \(workspace_unavailable\)\.?$/i;

export function formatDispatchError(error: unknown, t: TFunction): string | undefined {
  const message = errorMessage(error);
  const match = message.match(NOT_READY_AGENTS_RE);
  if (match) {
    const agent = match[1].trim();
    return t("errors.agent_not_ready", { agent });
  }
  if (/disabled agent\(s\)/i.test(message)) {
    return t("errors.agent_disabled_on_node");
  }
  const workspaceUnavailable = message.match(WORKSPACE_UNAVAILABLE_RE);
  if (workspaceUnavailable) {
    return t("errors.workspace_unavailable", { agent: workspaceUnavailable[1].trim() });
  }
  return undefined;
}
