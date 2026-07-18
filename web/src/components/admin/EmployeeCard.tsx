"use client";

import type { TFunction } from "i18next";
import { AgentMark } from "../AgentMark";
import { Button } from "../ui/button";
import { AdminDelete } from "../icons";
import { agentAvailabilityTone, type EmployeeNodeSummary } from "./helpers";
import type { EmployeeAgent } from "../../types";

function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Employee fleet state, collapsed to the same tone vocabulary the node status
// pill uses so the two cards read as one system.
function summaryTone(member: EmployeeNodeSummary): { tone: string; key: string } {
  if (member.runningCount > 0) return { tone: "info", key: "running" };
  if (member.readyCount > 0) return { tone: "good", key: "ready" };
  if (member.nodeCount > 0) return { tone: "muted", key: "idle" };
  return { tone: "muted", key: "no_nodes" };
}

interface EmployeeCardProps {
  member: EmployeeNodeSummary;
  agents: EmployeeAgent[];
  highlight: boolean;
  onSelectAgent?: (agentId: string) => void;
  onDelete?: (employeeId: string) => void;
  deletePending: boolean;
  t: TFunction;
}

export function EmployeeCard({
  member,
  agents,
  highlight,
  onSelectAgent,
  onDelete,
  deletePending,
  t,
}: EmployeeCardProps) {
  const { tone, key } = summaryTone(member);
  return (
    <article
      className={`adm-node-card adm-emp-card tone-${tone}${highlight ? " is-pulse" : ""}`}
      data-employee={member.id}
    >
      <header className="adm-node-card-head">
        <span className={`adm-node-avatar tone-${tone}`} aria-hidden="true" translate="no">
          {ownerInitials(member.displayName)}
        </span>
        <div className="adm-node-card-identity">
          <span className="adm-node-card-name" translate="no">{member.displayName}</span>
          <span className="adm-node-card-handle mono" translate="no">@{member.id}</span>
        </div>
        <div className="adm-node-card-meta-col">
          <span className={`adm-status-pill tone-${tone}`}>
            <i className="adm-status-dot" aria-hidden="true" />
            {t(`admin.v2.emp_state_${key}`, { defaultValue: key })}
          </span>
          {member.departmentName ? (
            <span className="adm-emp-card-dept">{member.departmentName}</span>
          ) : null}
        </div>
      </header>

      <div className="adm-node-card-body">
        {member.email ? (
          <p className="adm-emp-card-email mono tone-muted" translate="no">{member.email}</p>
        ) : null}
        <div className="adm-agents adm-emp-nodes">
          {agents.length === 0 ? (
            <span className="adm-emp-no-nodes">{t("admin.v2.no_agents_for_employee")}</span>
          ) : (
            agents.map((agent) => (
              <Button
                variant="ghost"
                key={agent.id}
                type="button"
                className={`adm-node-chip adm-node-chip--button tone-${agentAvailabilityTone(agent.availability)}`}
                onClick={() => onSelectAgent?.(agent.id)}
                disabled={!onSelectAgent}
              >
                <AgentMark agent={agent.executorKind} size={12} className="adm-node-chip-mark" />
                <span translate="no">{agent.displayName}</span>
              </Button>
            ))
          )}
        </div>
      </div>

      <footer className="adm-node-card-foot">
        <div
          className="adm-emp-card-metrics"
          aria-label={t("admin.v2.emp_metrics_aria", {
            running: member.runningCount,
            ready: member.readyCount,
            total: member.nodeCount,
          })}
        >
          <span className="adm-emp-card-metric">
            <span className="adm-emp-metric-label">{t("admin.v2.col_running")}</span>
            <span className={`mono ${member.runningCount > 0 ? "tone-neutral" : "tone-muted"}`}>
              {member.runningCount}
            </span>
          </span>
          <span className="adm-emp-card-metric">
            <span className="adm-emp-metric-label">{t("admin.v2.col_ready")}</span>
            <span className="mono tone-muted">{member.readyCount}/{member.nodeCount}</span>
          </span>
        </div>
        {onDelete ? (
          <div className="adm-node-card-actions">
            <Button
              variant="ghost"
              type="button"
              className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn danger"
              onClick={() => onDelete(member.id)}
              disabled={deletePending}
              aria-label={t("admin.v2.delete_employee_action")}
              title={t("admin.v2.delete_employee_action")}
            >
              <AdminDelete size={14} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
