"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import {
  agentStatusTone,
  copyText,
  formatRelativeTime,
  isStale,
  statusTone,
  visualStatus,
} from "./helpers";

type FleetFilter = "all" | "ready" | "running" | "provisioning" | "failed" | "unassigned";

interface FleetViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  onRevealCredentials: (node: ControlPanelDaemonNodeRecord) => void;
  onDeleteNode?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
}

const FILTERS: FleetFilter[] = ["all", "ready", "running", "provisioning", "failed", "unassigned"];
const CONNECT_AGENT_NAMES: AgentName[] = ["claude", "codex", "kimi"];

function matchesFilter(node: ControlPanelDaemonNodeRecord, filter: FleetFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unassigned") return !node.employeeId;
  const status = visualStatus(node);
  if (filter === "failed") return status === "failed" || status === "stale";
  if (filter === "ready") return status === "ready";
  if (filter === "running") return status === "running";
  if (filter === "provisioning") return status === "provisioning";
  return false;
}

function filterLabel(filter: FleetFilter, t: TFunction): string {
  if (filter === "all") return t("admin.v2.filter_all");
  if (filter === "unassigned") return t("admin.unassigned");
  if (filter === "failed") return t("admin.v2.filter_failed");
  return t(`status.${filter}`, { defaultValue: filter });
}

function visibleAgentNames(node: ControlPanelDaemonNodeRecord): AgentName[] {
  const names = [...CONNECT_AGENT_NAMES];
  if (node.agents.pi && node.agents.pi !== "unknown") names.push("pi");
  return names;
}

function agentTitle(node: ControlPanelDaemonNodeRecord, agent: AgentName, t: TFunction): string {
  const agentStatus = node.agents[agent] ?? "unknown";
  const statusLabel = t(`status.${agentStatus}`, { defaultValue: agentStatus });
  const detail = node.agentDetails?.[agent];
  const parts = [
    t("fleet.agent_status_title", { agent, status: statusLabel }),
    detail?.version,
    detail?.detail,
  ].filter(Boolean);
  return parts.join(" · ");
}

function NodeCard({
  node,
  employee,
  onReveal,
  onDelete,
  t,
}: {
  node: ControlPanelDaemonNodeRecord;
  employee?: EmployeeRecord;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}) {
  const [copied, setCopied] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const status = visualStatus(node);
  const tone = statusTone(status);
  const running = !isStale(node) && node.status === "running";

  async function handleCopyId() {
    await copyText(node.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm(t("admin.v2.delete_confirm", { id: node.id }))) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await onDelete(node);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletePending(false);
    }
  }

  const nodeName = node.employeeId
    ? employee?.displayName || node.employeeId
    : t("admin.unassigned");

  return (
    <article className={`adm-node-card tone-${tone} ${running ? "is-running" : ""}`}>
      <header className="adm-node-card-head">
        <span className={`adm-status-pill tone-${tone}`}>{t(`status.${status}`, { defaultValue: status })}</span>
        <div className="adm-node-card-identity">
          <span
            className={`adm-node-card-name ${node.employeeId ? "" : "tone-muted"}`}
            translate="no"
          >
            {nodeName}
          </span>
          <button
            type="button"
            className="adm-node-id mono"
            onClick={() => void handleCopyId()}
            title={t("admin.copy_sandbox_id")}
          >
            <span translate="no">{node.id}</span>
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="adm-node-card-body">
        <p className="adm-node-owner">
          {node.employeeId ? (
            <span className="adm-node-owner-handle mono" translate="no">@{node.employeeId}</span>
          ) : (
            <span className="adm-node-owner-handle tone-muted">{t("admin.unassigned")}</span>
          )}
        </p>
        <div className="adm-agents">
          {visibleAgentNames(node).map((name) => {
            const agentStatus = node.agents[name] ?? "unknown";
            const agentTone = agentStatusTone(agentStatus);
            return (
              <span
                key={name}
                className={`adm-agent-chip tone-${agentTone}`}
                title={agentTitle(node, name, t)}
              >
                {name}
              </span>
            );
          })}
        </div>
      </div>

      <footer className="adm-node-card-foot">
        <span className="mono tone-muted">{formatRelativeTime(node.lastSeenAt, t)}</span>
        {node.queuedCommandCount > 0 ? (
          <span className="mono tone-info">{node.queuedCommandCount} {t("admin.queued")}</span>
        ) : null}
        <button
          type="button"
          className="adm-node-card-reveal"
          onClick={() => onReveal(node)}
          aria-label={t("admin.v2.reveal_credentials_for", { id: node.id })}
        >
          <KeyRound size={13} aria-hidden="true" />
          <span>{t("admin.v2.reveal_credentials")}</span>
        </button>
        {onDelete ? (
          <button
            type="button"
            className="adm-node-card-delete"
            onClick={() => void handleDelete()}
            disabled={deletePending}
            aria-label={t("admin.v2.delete_action")}
            title={t("admin.v2.delete_action")}
          >
            <Trash2 size={13} aria-hidden="true" />
            <span>{t("admin.v2.delete_action")}</span>
          </button>
        ) : null}
      </footer>
      {deleteError ? (
        <p className="adm-node-card-error">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
    </article>
  );
}

export function FleetView({ nodes, employees, onRevealCredentials, onDeleteNode }: FleetViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FleetFilter>("all");

  const counts = useMemo(() => {
    const result: Record<FleetFilter, number> = {
      all: nodes.length,
      ready: 0,
      running: 0,
      provisioning: 0,
      failed: 0,
      unassigned: 0,
    };
    for (const node of nodes) {
      if (matchesFilter(node, "ready")) result.ready += 1;
      if (matchesFilter(node, "running")) result.running += 1;
      if (matchesFilter(node, "provisioning")) result.provisioning += 1;
      if (matchesFilter(node, "failed")) result.failed += 1;
      if (!node.employeeId) result.unassigned += 1;
    }
    return result;
  }, [nodes]);

  const filtered = useMemo(() => nodes.filter((node) => matchesFilter(node, filter)), [nodes, filter]);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  return (
    <div className="adm-view">
      <div className="adm-tabs" role="tablist" aria-label={t("admin.v2.filter_label")}>
        {FILTERS.map((id) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`adm-tab ${active ? "active" : ""}`}
              onClick={() => setFilter(id)}
            >
              <span>{filterLabel(id, t)}</span>
              <span className="adm-tab-count mono">{counts[id]}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty-block">
          <p className="adm-empty-body">{t("admin.v2.no_nodes_for_filter")}</p>
        </div>
      ) : (
        <div className="adm-fleet-grid">
          {filtered.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              employee={node.employeeId ? employeeById.get(node.employeeId) : undefined}
              onReveal={onRevealCredentials}
              onDelete={onDeleteNode}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
