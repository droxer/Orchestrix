"use client";

import { useState } from "react";
import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { AgentMark } from "../AgentMark";
import {
  agentStatusTone,
  copyText,
  truncateId,
  visibleNodeAgentNames,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { Button } from "../ui/button";
import { ActionApprove, ActionCopy, ActionKey, AdminDelete, AdminManageAgents, AdminNode } from "../icons";

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
  storedTokens?: StoredNodeTokenMap;
  colocated?: boolean;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}

export function NodeCard({
  node,
  employee,
  storedTokens = {},
  colocated = false,
  onReveal,
  onManageAgents,
  onDelete,
  t,
}: NodeCardProps) {
  const { confirm } = useDialogs();
  const [copied, setCopied] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCopyId() {
    await copyText(node.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handleDelete() {
    if (!onDelete) return;
    const ok = await confirm({
      title: t("admin.v2.delete_confirm", { id: node.id }),
      confirmLabel: t("admin.v2.delete_action"),
      tone: "danger",
    });
    if (!ok) return;
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
    <article className="adm-node-card">
      <header className="adm-node-card-head">
        <span className="adm-node-avatar adm-node-avatar--machine" aria-hidden="true" translate="no">
          <AdminNode size={18} aria-hidden="true" />
        </span>
        <div className="adm-node-card-identity">
          <span
            className={`adm-node-card-name ${node.employeeId ? "" : "tone-muted"}`}
            translate="no"
          >
            {nodeName}
          </span>
          {node.employeeId ? (
            <span className="adm-node-card-handle mono" translate="no">@{node.employeeId}</span>
          ) : (
            <span className="adm-node-card-handle tone-muted">{t("admin.unassigned")}</span>
          )}
        </div>
        <div className="adm-node-card-meta-col">
          <Button variant="ghost"
            type="button"
            className="adm-node-id mono"
            onClick={() => void handleCopyId()}
            aria-label={copied ? t("admin.copied") : t("admin.copy_node_id")}
            title={node.id}
          >
            <span translate="no">{truncateId(node.id)}</span>
            {copied ? <ActionApprove size={12} aria-hidden="true" /> : <ActionCopy size={12} aria-hidden="true" />}
          </Button>
        </div>
      </header>

      <NodeProfileBadges
        node={node}
        storedTokens={storedTokens}
        colocated={colocated}
        t={t}
        hideThisHost
        hideSavedHere
      />

      <div className="adm-node-card-body">
        <div className="adm-agents">
          {visibleNodeAgentNames(node).map((name) => {
            const agentStatus = node.agents[name] ?? "unknown";
            const agentTone = agentStatusTone(agentStatus);
            const disabled = isAgentDisabled(node, name);
            return (
              <span
                key={name}
                className={`adm-agent-chip tone-${agentTone}${disabled ? " is-disabled" : ""}`}
                data-agent={name}
                title={agentTitle(node, name, t)}
              >
                <i className="adm-agent-dot" aria-hidden="true" />
                <AgentMark agent={name} size={12} className="adm-agent-chip-mark" />
                {name}
              </span>
            );
          })}
        </div>
      </div>

      <footer className="adm-node-card-foot">
        {node.queuedCommandCount > 0 ? (
          <span className="adm-node-card-queued mono tone-info">{node.queuedCommandCount} {t("admin.queued")}</span>
        ) : null}
        <div className="adm-node-card-actions">
          {node.managedNodeId ? null : (
            <Button variant="ghost"
              type="button"
              className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn"
              onClick={() => onReveal(node)}
              aria-label={t("admin.v2.reveal_credentials_for", { id: node.id })}
              title={t("admin.v2.reveal_credentials")}
            >
              <ActionKey size={14} aria-hidden="true" />
            </Button>
          )}
          <Button variant="ghost"
            type="button"
            className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn"
            onClick={() => onManageAgents(node)}
            aria-label={t("admin.v2.manage_agents_for", { id: node.id })}
            title={t("admin.v2.manage_agents")}
          >
            <AdminManageAgents size={14} aria-hidden="true" />
          </Button>
          {onDelete ? (
            <Button variant="ghost"
              type="button"
              className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn danger"
              onClick={() => void handleDelete()}
              disabled={deletePending}
              aria-label={t("admin.v2.delete_action")}
              title={t("admin.v2.delete_action")}
            >
              <AdminDelete size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </footer>
      {deleteError ? (
        <p className="adm-node-card-error">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
    </article>
  );
}
