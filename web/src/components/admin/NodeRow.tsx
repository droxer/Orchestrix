"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { useNodeDelete } from "../../hooks/useNodeDelete";
import {
  isNodeOnline,
  nodeOwnershipProfile,
  statusTone,
  visualStatus,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeActions } from "./NodeActions";
import { NodeProfileBadges, nodeOwnershipIcon } from "./NodeProfileBadges";
import { NodePresence } from "./NodePresence";
import { NodeRuntimeMarks } from "./NodeRuntimeMarks";

interface NodeRowProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
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
          <span className="adm-node-card-handle code" translate="no">{node.id}</span>
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
        <NodeRuntimeMarks node={node} t={t} />
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
