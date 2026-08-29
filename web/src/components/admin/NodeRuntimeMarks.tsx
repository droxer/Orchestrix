"use client";

import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord } from "../../types";
import { RuntimeMark } from "../RuntimeMark";
import {
  agentStatusTone,
  nodeAgentPresence,
  nodeAgentPresenceLabel,
  visibleNodeAgentNames,
} from "../../lib/adminHelpers";

function isAgentDisabled(node: ControlPanelDaemonNodeRecord, agent: AgentName): boolean {
  return Boolean(node.disabledAgents?.includes(agent));
}

function agentTitle(node: ControlPanelDaemonNodeRecord, agent: AgentName, t: TFunction): string {
  const agentStatus = node.agents[agent] ?? "unknown";
  const statusLabel = t(`status.${agentStatus}`, { defaultValue: agentStatus });
  const detail = node.agentDetails?.[agent];
  const parts = [
    // Presence leads: on a dark computer the last reported "ready" is stale,
    // and the reader's question is "can this agent take work", not "what did
    // it say last time it spoke".
    t("nodes.agent_presence_title", {
      agent,
      presence: nodeAgentPresenceLabel(nodeAgentPresence(node, agent), t),
    }),
    t("nodes.agent_status_title", { agent, status: statusLabel }),
    detail?.version,
    detail?.detail,
    isAgentDisabled(node, agent) ? t("admin.v2.agent_disabled") : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The executor glyph row shared by the fleet card and the fleet list row.
 *
 * Each mark carries its agent's presence as shape: a filled dot is an agent
 * that can take work right now, a hollow ring is one that cannot — because its
 * computer is dark, because the daemon never reported it ready, or because it
 * failed. Hue then says which of those it is. Presence is also spelled out for
 * assistive tech, so the cue is not shape-only.
 */
export function NodeRuntimeMarks({
  node,
  t,
}: {
  node: ControlPanelDaemonNodeRecord;
  t: TFunction;
}) {
  const agents = visibleNodeAgentNames(node);
  if (agents.length === 0) {
    return <span className="adm-agents-empty">{t("admin.v2.node_hosted_agents_empty")}</span>;
  }
  return (
    <span className="adm-node-runtimes-marks">
      {agents.map((name) => {
        const agentStatus = node.agents[name] ?? "unknown";
        const disabled = isAgentDisabled(node, name);
        const presence = nodeAgentPresence(node, name);
        return (
          <RuntimeMark
            key={name}
            agent={name}
            presence={presence}
            tone={agentStatusTone(agentStatus, { disabled })}
            disabled={disabled}
            glyphClassName="adm-agent-chip-mark"
            role="img"
            aria-label={`${name} · ${nodeAgentPresenceLabel(presence, t)}`}
            title={agentTitle(node, name, t)}
            translate="no"
          />
        );
      })}
    </span>
  );
}
