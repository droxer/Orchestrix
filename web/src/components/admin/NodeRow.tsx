"use client";

import { useState } from "react";
import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { AgentMark } from "../AgentMark";
import {
  agentStatusTone,
  visibleNodeAgentNames,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { Button } from "../ui/button";
import { ActionKey, AdminDelete, AdminManageAgents, AdminNode } from "../icons";

function isAgentDisabled(node: ControlPanelDaemonNodeRecord, agent: AgentName): boolean {
  return Boolean(node.disabledAgents?.includes(agent));
}

interface NodeRowProps {
  node: ControlPanelDaemonNodeRecord;
  employee?: EmployeeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}

export function NodeRow({ node, employee, storedTokens, colocated, onReveal, onManageAgents, onDelete, t }: NodeRowProps) {
  const { confirm } = useDialogs();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nodeName = node.employeeId ? employee?.displayName || node.employeeId : t("admin.unassigned");

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

  return (
    <li className="adm-node-row" data-node={node.id}>
      <div className="adm-node-row-id">
        <span className="adm-node-avatar adm-node-avatar--machine" aria-hidden="true" translate="no">
          <AdminNode size={16} aria-hidden="true" />
        </span>
        <span className="adm-node-row-identity">
          <span className={`adm-node-card-name ${node.employeeId ? "" : "tone-muted"}`} translate="no">
            {nodeName}
          </span>
          {node.employeeId ? (
            <span className="adm-node-card-handle mono" translate="no">@{node.employeeId}</span>
          ) : (
            <span className="adm-node-card-handle tone-muted">{t("admin.unassigned")}</span>
          )}
          <NodeProfileBadges
            node={node}
            storedTokens={storedTokens}
            colocated={colocated}
            t={t}
            compact
            hideThisHost
            hideSavedHere
          />
        </span>
      </div>

      <div className="adm-node-row-agents">
        {visibleNodeAgentNames(node).map((name) => {
          const agentTone = agentStatusTone(node.agents[name] ?? "unknown");
          const disabled = isAgentDisabled(node, name);
          return (
            <span
              key={name}
              className={`adm-agent-chip tone-${agentTone}${disabled ? " is-disabled" : ""}`}
              data-agent={name}
            >
              <i className="adm-agent-dot" aria-hidden="true" />
              <AgentMark agent={name} size={12} className="adm-agent-chip-mark" />
              {name}
            </span>
          );
        })}
      </div>

      <div className="adm-node-row-actions">
        {node.managedNodeId ? null : (
          <Button
            variant="ghost"
            type="button"
            className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn"
            onClick={() => onReveal(node)}
            aria-label={t("admin.v2.reveal_credentials_for", { id: node.id })}
            title={t("admin.v2.reveal_credentials")}
          >
            <ActionKey size={14} aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          type="button"
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn"
          onClick={() => onManageAgents(node)}
          aria-label={t("admin.v2.manage_agents_for", { id: node.id })}
          title={t("admin.v2.manage_agents")}
        >
          <AdminManageAgents size={14} aria-hidden="true" />
        </Button>
        {onDelete ? (
          <Button
            variant="ghost"
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
      {deleteError ? (
        <p className="adm-node-row-error">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
    </li>
  );
}
