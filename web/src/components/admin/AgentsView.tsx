"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listControlPanelAgents } from "../../api";
import { agentLabel } from "../../lib/plan";
import type {
  AgentName,
  AgentPlacement,
  ControlPanelDaemonNodeRecord,
  EmployeeAgent,
  EmployeeRecord,
  Tone,
} from "../../types";
import { RelayEmptyState } from "../RelayEmptyState";
import { Button } from "../ui/button";
import {
  agentStatusTone,
  formatRelativeTime,
  isStale,
  statusTone,
  truncateId,
  visibleNodeAgentNames,
  visualStatus,
} from "./helpers";
import { NodeProfileBadges } from "./NodeProfileBadges";

export const ADMIN_AGENTS_KEY = ["admin", "agents"] as const;

interface NodeAgentEntry {
  id: string;
  agentId?: string;
  executorKind: AgentName;
  displayName: string;
  employeeId?: string;
  status: string;
  statusTone: Tone;
  disabled: boolean;
  version?: string;
  detail?: string;
  conditions: Array<{ reason: string; message: string }>;
}

interface NodeAgentGroup {
  nodeId: string;
  node: ControlPanelDaemonNodeRecord;
  entries: NodeAgentEntry[];
}

function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function placementStatusTone(status: AgentPlacement["status"]): Tone {
  if (status === "ready") return "good";
  if (status === "busy") return "info";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "incompatible") return "bad";
  return "neutral";
}

function nodeHealthTone(status: string): Tone {
  const mapped = agentStatusTone(status);
  if (mapped === "good") return "good";
  if (mapped === "bad") return "bad";
  return "neutral";
}

function findLogicalAgent(
  agents: EmployeeAgent[],
  node: ControlPanelDaemonNodeRecord,
  executorKind: AgentName,
): { agent: EmployeeAgent; placement?: AgentPlacement } | null {
  if (!node.employeeId) return null;
  for (const agent of agents) {
    if (agent.deletedAt) continue;
    if (agent.employeeId !== node.employeeId || agent.executorKind !== executorKind) continue;
    const placement = agent.placements.find(
      (item) => item.daemonNodeId === node.id && item.desiredState !== "removed",
    );
    return { agent, placement };
  }
  return null;
}

function agentStatusLabel(status: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (status === "pending" || status === "busy" || status === "offline" || status === "incompatible") {
    return t(`admin.v2.placement_status.${status}`, { defaultValue: status });
  }
  return t(`status.${status}`, { defaultValue: status });
}

function buildNodeAgentGroups(
  nodes: ControlPanelDaemonNodeRecord[],
  agents: EmployeeAgent[],
): NodeAgentGroup[] {
  const nodeRank = (node: ControlPanelDaemonNodeRecord): number => {
    const status = visualStatus(node);
    if (!isStale(node) && node.status === "running") return 0;
    if (status === "ready") return 1;
    if (status === "running" || status === "provisioning") return 2;
    if (status === "failed" || status === "stale") return 3;
    return 4;
  };

  return nodes
    .map((node) => {
      const entries = visibleNodeAgentNames(node).map((executorKind): NodeAgentEntry => {
        const health = node.agents[executorKind] ?? "unknown";
        const disabled = Boolean(node.disabledAgents?.includes(executorKind));
        const logical = findLogicalAgent(agents, node, executorKind);
        const runtimeDetail = node.agentDetails?.[executorKind];
        const placement = logical?.placement;
        const status = placement?.status ?? health;
        const statusToneValue = placement ? placementStatusTone(placement.status) : nodeHealthTone(health);

        return {
          id: `${node.id}:${executorKind}`,
          agentId: logical?.agent.id,
          executorKind,
          displayName: logical?.agent.displayName ?? agentLabel(executorKind),
          employeeId: node.employeeId ?? logical?.agent.employeeId,
          status,
          statusTone: statusToneValue,
          disabled: disabled || logical?.agent.enabled === false,
          version: runtimeDetail?.version,
          detail: runtimeDetail?.detail,
          conditions: placement?.conditions ?? [],
        };
      });

      return { nodeId: node.id, node, entries };
    })
    .filter((group) => group.entries.length > 0)
    .sort((left, right) => {
      const rankDelta = nodeRank(left.node) - nodeRank(right.node);
      if (rankDelta !== 0) return rankDelta;
      const leftLabel = left.node.employeeId ?? left.nodeId;
      const rightLabel = right.node.employeeId ?? right.nodeId;
      return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
    });
}

function NodeAgentGroupSection({
  group,
  employeesById,
  index,
  onSelectAgent,
}: {
  group: NodeAgentGroup;
  employeesById: Map<string, EmployeeRecord>;
  index: number;
  onSelectAgent?: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const { node, nodeId, entries } = group;
  const status = visualStatus(node);
  const tone = statusTone(status);
  const running = !isStale(node) && node.status === "running";
  const employee = node.employeeId ? employeesById.get(node.employeeId) : undefined;
  const nodeLabel = node.employeeId
    ? employee?.displayName || node.employeeId
    : t("admin.unassigned");
  const statusLabel = t(`status.${status}`, { defaultValue: status });

  return (
    <section
      className={`adm-node-agent-group tone-${tone}${running ? " is-running" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      aria-labelledby={`adm-node-agent-${nodeId}`}
    >
      <header className="adm-node-agent-head">
        <span className={`adm-node-agent-avatar tone-${tone}`} aria-hidden="true" translate="no">
          {node.employeeId ? ownerInitials(nodeLabel) : <Server size={16} aria-hidden="true" />}
        </span>
        <div className="adm-node-agent-identity">
          <div className="adm-node-agent-title-row">
            <h3 id={`adm-node-agent-${nodeId}`} className="adm-node-agent-title" translate="no">
              {nodeLabel}
            </h3>
            <span className={`adm-status-pill tone-${tone}`}>
              <span className="adm-status-dot" aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <p className="adm-node-agent-meta">
            <span className="mono" translate="no" title={nodeId}>{truncateId(nodeId)}</span>
            {node.lastSeenAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatRelativeTime(node.lastSeenAt, t)}</span>
              </>
            ) : null}
          </p>
          <NodeProfileBadges
            node={node}
            storedTokens={{}}
            colocated={false}
            t={t}
            compact
          />
        </div>
        <span className="adm-node-agent-count mono">
          {t("admin.v2.agents_on_node", { count: entries.length })}
        </span>
      </header>

      <ul className="adm-node-agent-list">
        {entries.map((entry) => {
          const statusLabelForAgent = agentStatusLabel(entry.status, t);

          const clickable = Boolean(entry.agentId && onSelectAgent);
          return (
            <li
              key={entry.id}
              className={`adm-node-agent-card${entry.disabled ? " is-disabled" : ""}${clickable ? " is-clickable" : ""}`}
              onClick={clickable ? () => onSelectAgent?.(entry.agentId as string) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectAgent?.(entry.agentId as string);
                      }
                    }
                  : undefined
              }
            >
              <span className="adm-node-agent-card-glyph" aria-hidden="true" translate="no">
                {agentInitials(entry.displayName)}
              </span>
              <div className="adm-node-agent-card-body">
                <div className="adm-node-agent-card-head">
                  <p className="adm-node-agent-card-name" translate="no">{entry.displayName}</p>
                  <span className={`adm-status-pill tone-${entry.statusTone}`}>
                    <span className="adm-status-dot" aria-hidden="true" />
                    {statusLabelForAgent}
                  </span>
                </div>
                <p className="adm-node-agent-card-meta">
                  <span className="mono">{entry.executorKind}</span>
                  {entry.employeeId ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span translate="no">@{entry.employeeId}</span>
                    </>
                  ) : null}
                  {entry.version ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="mono" translate="no">{entry.version}</span>
                    </>
                  ) : null}
                  {entry.disabled ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tone-warn">{t("admin.v2.agent_disabled")}</span>
                    </>
                  ) : null}
                </p>
                {entry.detail ? (
                  <p className="adm-node-agent-card-note tone-muted">{entry.detail}</p>
                ) : null}
                {entry.conditions.length > 0 ? (
                  <p className="adm-node-agent-card-note">
                    {entry.conditions.map((condition) => condition.message).join(" · ")}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AgentsView({
  nodes,
  employees = [],
  onSelectAgent,
}: {
  nodes: ControlPanelDaemonNodeRecord[];
  employees?: EmployeeRecord[];
  onSelectAgent?: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const agentsQuery = useQuery({
    queryKey: ADMIN_AGENTS_KEY,
    queryFn: ({ signal }) => listControlPanelAgents(undefined, signal),
    refetchInterval: 10_000,
  });
  const agents = (agentsQuery.data?.agents ?? []).filter((agent) => !agent.deletedAt);
  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const groups = useMemo(() => buildNodeAgentGroups(nodes, agents), [nodes, agents]);
  const agentCount = useMemo(
    () => groups.reduce((total, group) => total + group.entries.length, 0),
    [groups],
  );

  if (groups.length === 0) {
    return (
      <RelayEmptyState
        className="adm-view"
        fill
        title={t("admin.v2.empty_agents_title")}
        body={t("admin.v2.node_agents_empty")}
        illustration={<Server size={40} strokeWidth={1.25} aria-hidden="true" />}
        actions={
          agentsQuery.error ? (
            <Button type="button" onClick={() => void agentsQuery.refetch()}>{t("admin.v2.retry")}</Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="adm-view adm-agents-view">
      {agentsQuery.error ? (
        <p className="adm-agents-enrich-warning" role="status">
          {t("admin.v2.agents_enrich_error")}
        </p>
      ) : null}

      <header className="adm-agents-summary" aria-label={t("admin.v2.agents_summary_label")}>
        <div className="adm-agents-summary-stat">
          <span className="adm-agents-summary-value mono">{agentCount}</span>
          <span className="adm-agents-summary-label">{t("admin.v2.agents_summary_agents")}</span>
        </div>
        <div className="adm-agents-summary-stat">
          <span className="adm-agents-summary-value mono">{groups.length}</span>
          <span className="adm-agents-summary-label">{t("admin.v2.agents_summary_nodes")}</span>
        </div>
      </header>

      <div className="adm-agents-groups">
        {groups.map((group, index) => (
          <NodeAgentGroupSection
            key={group.nodeId}
            group={group}
            employeesById={employeesById}
            index={index}
            onSelectAgent={onSelectAgent}
          />
        ))}
      </div>
    </div>
  );
}
