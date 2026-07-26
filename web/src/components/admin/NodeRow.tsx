"use client";

import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord } from "../../types";
import { AgentMark } from "../AgentMark";
import { useNodeDelete } from "../../hooks/useNodeDelete";
import {
  agentStatusTone,
  isNodeOnline,
  nodeOwnershipProfile,
  statusTone,
  visibleNodeAgentNames,
  visualStatus,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeActions } from "./NodeActions";
import { NodeProfileBadges, nodeOwnershipIcon } from "./NodeProfileBadges";
import { NodePresence } from "./NodePresence";

function isAgentDisabled(node: ControlPanelDaemonNodeRecord, agent: AgentName): boolean {
  return Boolean(node.disabledAgents?.includes(agent));
}

function agentTitle(node: ControlPanelDaemonNodeRecord, agent: AgentName, t: TFunction): string {
  const agentStatus = node.agents[agent] ?? "unknown";
  const statusLabel = t(`status.${agentStatus}`, { defaultValue: agentStatus });
  const detail = node.agentDetails?.[agent];
  const parts = [
    t("nodes.agent_status_title", { agent, status: statusLabel }),
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
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}

export function NodeRow({ node, storedTokens, colocated, onReveal, onRename, onManageExecutors, onDelete, t }: NodeRowProps) {
  const { deletePending, deleteError, handleDelete } = useNodeDelete(node, onDelete, t);
  const nodeName = node.displayName || node.id;
  const status = visualStatus(node);
  const tone = statusTone(status);
  const statusLabel = t(`status.${status}`, { defaultValue: status });
  const online = isNodeOnline(node);
  // The presence pill already says Online/Offline, so the status pill only
  // renders when it adds state presence can't: running, provisioning,
  // failed, stopped.
  const showStatusPill = status !== "ready" && status !== "stale";
  const ownership = nodeOwnershipProfile(node);
  const OwnershipMark = nodeOwnershipIcon(ownership);

  return (
    <li className="adm-node-row" data-node={node.id} data-online={online ? "true" : "false"} role="row">
      <div className="adm-node-row-id" role="cell">
        <span
          className="adm-node-avatar adm-node-avatar--machine"
          data-ownership={ownership}
          translate="no"
        >
          <OwnershipMark size={16} aria-hidden="true" />
        </span>
        <span className="adm-node-row-identity">
          <span className="adm-node-row-nameline">
            <span className="adm-node-card-name" translate="no">
              {nodeName}
            </span>
            <NodePresence node={node} t={t} withLabel />
            {showStatusPill ? (
              <span className={`adm-status-pill tone-${tone}`}>
                <i className="adm-status-dot" aria-hidden="true" />
                {statusLabel}
              </span>
            ) : null}
          </span>
          <span className="adm-node-card-handle mono" translate="no">{node.id}</span>
          <NodeProfileBadges
            node={node}
            storedTokens={storedTokens}
            colocated={colocated}
            t={t}
            compact
            hideSandbox
            hideThisHost
            hideSavedHere
          />
        </span>
      </div>

      <div
        className="adm-node-row-agents"
        role="cell"
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

      <div className="adm-node-row-actions" role="cell">
        <NodeActions
          node={node}
          onReveal={onReveal}
          onRename={onRename}
          onManageExecutors={onManageExecutors}
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
