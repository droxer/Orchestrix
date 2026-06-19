"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Settings2, Trash2 } from "lucide-react";
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

const CONNECT_AGENT_NAMES: AgentName[] = ["claude", "codex", "kimi"];

function visibleAgentNames(node: ControlPanelDaemonNodeRecord): AgentName[] {
  const names = [...CONNECT_AGENT_NAMES];
  if (node.agents.pi && node.agents.pi !== "unknown") names.push("pi");
  return names;
}

function isAgentDisabled(node: ControlPanelDaemonNodeRecord, agent: AgentName): boolean {
  return Boolean(node.disabledAgents?.includes(agent));
}

function agentTitle(node: ControlPanelDaemonNodeRecord, agent: AgentName, t: TFunction): string {
  const agentStatus = node.agents[agent] ?? "unknown";
  const statusLabel = t(`status.${agentStatus}`, { defaultValue: agentStatus });
  const detail = node.agentDetails?.[agent];
  const parts = [
    t("fleet.agent_status_title", { agent, status: statusLabel }),
    detail?.version,
    detail?.detail,
    isAgentDisabled(node, agent) ? t("admin.v2.agent_disabled") : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

interface NodeCardProps {
  node: ControlPanelDaemonNodeRecord;
  employee?: EmployeeRecord;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}

export function NodeCard({ node, employee, onReveal, onManageAgents, onDelete, t }: NodeCardProps) {
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
            const disabled = isAgentDisabled(node, name);
            return (
              <span
                key={name}
                className={`adm-agent-chip tone-${agentTone}${disabled ? " is-disabled" : ""}`}
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
        <button
          type="button"
          className="adm-node-card-reveal"
          onClick={() => onManageAgents(node)}
          aria-label={t("admin.v2.manage_agents_for", { id: node.id })}
        >
          <Settings2 size={13} aria-hidden="true" />
          <span>{t("admin.v2.manage_agents")}</span>
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
