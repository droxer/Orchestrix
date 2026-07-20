"use client";

import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord } from "../../types";
import { AgentMark } from "../AgentMark";
import { useNodeDelete } from "../../hooks/useNodeDelete";
import {
  agentStatusTone,
  visibleNodeAgentNames,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeActions } from "./NodeActions";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { AdminNode } from "../icons";

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

interface NodeRowProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}

export function NodeRow({ node, storedTokens, colocated, onReveal, onManageAgents, onDelete, t }: NodeRowProps) {
  const { deletePending, deleteError, handleDelete } = useNodeDelete(node, onDelete, t);
  const nodeName = node.displayName || node.id;

  return (
    <li className="adm-node-row" data-node={node.id}>
      <div className="adm-node-row-id">
        <span className="adm-node-avatar adm-node-avatar--machine" aria-hidden="true" translate="no">
          <AdminNode size={16} aria-hidden="true" />
        </span>
        <span className="adm-node-row-identity">
          <span className="adm-node-card-name" translate="no">
            {nodeName}
          </span>
          <span className="adm-node-card-handle mono" translate="no">{node.id}</span>
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

      <div
        className="adm-node-row-agents"
        aria-label={t("admin.v2.node_runtimes")}
        title={t("admin.v2.node_runtimes")}
      >
        {visibleNodeAgentNames(node).length === 0 ? (
          <span className="adm-agents-empty">{t("admin.v2.node_hosted_agents_empty")}</span>
        ) : (
          <span className="adm-node-runtimes-marks">
            {visibleNodeAgentNames(node).map((name) => {
              const agentTone = agentStatusTone(node.agents[name] ?? "unknown");
              const disabled = isAgentDisabled(node, name);
              return (
                <span
                  key={name}
                  className={`adm-runtime-mark tone-${agentTone}${disabled ? " is-disabled" : ""}`}
                  data-agent={name}
                  title={agentTitle(node, name, t)}
                  translate="no"
                >
                  <i className="adm-agent-dot" aria-hidden="true" />
                  <AgentMark agent={name} size={14} className="adm-agent-chip-mark" />
                </span>
              );
            })}
          </span>
        )}
      </div>

      <div className="adm-node-row-actions">
        <NodeActions
          node={node}
          onReveal={onReveal}
          onManageAgents={onManageAgents}
          onDelete={onDelete}
          deletePending={deletePending}
          onDeleteRequest={() => void handleDelete()}
          t={t}
        />
      </div>
      {deleteError ? (
        <p className="adm-node-row-error" role="alert">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
    </li>
  );
}
