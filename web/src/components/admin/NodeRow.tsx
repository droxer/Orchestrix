"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { useNodeDelete } from "../../hooks/useNodeDelete";
import {
  isNodeOnline,
  nodeOwnershipProfile,
  type StoredNodeTokenMap,
} from "./helpers";
import { NodeActions } from "./NodeActions";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { NodePresence } from "./NodePresence";
import { NodeRuntimeMarks } from "./NodeRuntimeMarks";
import {
  AdminEmployees,
  ICON,
  nodeOwnershipIcon,
} from "../icons";
import { TableCell, TableRow } from "@/components/ui/table";

interface NodeRowProps {
  node: ControlPanelDaemonNodeRecord;
  employeeName?: string;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  /** One-shot marker for a computer that was just created here. */
  highlight?: boolean;
  t: TFunction;
}

export function NodeRow({ node, employeeName, storedTokens, colocated, onReveal, onRename, onManageExecutors, onDelete, highlight = false, t }: NodeRowProps) {
  const { deletePending, deleteError, handleDelete } = useNodeDelete(node, onDelete, t);
  const nodeName = node.displayName || node.id;
  const online = isNodeOnline(node);
  /* No status pill. The list bands BY status now, so the band above this row
     is that pill — said once for the whole group. The presence pill stays:
     online/offline is a fact about the connection, not the lifecycle, and a
     stopped computer can still be reachable. */
  const ownership = nodeOwnershipProfile(node);
  const OwnershipMark = nodeOwnershipIcon(ownership);

  return (
    <TableRow render={<li />} className={`adm-node-row${highlight ? " is-pulse" : ""}`} data-node={node.id} data-online={online ? "true" : "false"}>
      <TableCell render={<div />} className="adm-node-row-id">
        <span
          className="adm-node-avatar adm-node-avatar--machine"
          data-ownership={ownership}
          translate="no"
        >
          <OwnershipMark size={ICON.md} aria-hidden="true" />
        </span>
        <span className="adm-node-row-identity">
          <span className="adm-node-row-nameline">
            <span className="adm-node-card-name" translate="no">
              {nodeName}
            </span>
            <NodePresence node={node} t={t} withLabel />
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
      </TableCell>

      <TableCell render={<div />} className="adm-node-row-employee">
        {employeeName ? (
          <span className="adm-node-row-employee-label" translate="no">
            <AdminEmployees size={ICON.xs} className="adm-node-row-employee-icon" aria-hidden="true" />
            {employeeName}
          </span>
        ) : null}
      </TableCell>

      <TableCell
        render={<div />}
        className="adm-node-row-agents"
        aria-label={t("admin.v2.node_runtimes")}
        title={t("admin.v2.node_runtimes")}
      >
        <NodeRuntimeMarks node={node} t={t} />
      </TableCell>

      <TableCell render={<div />} className="adm-node-row-actions">
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
      </TableCell>
      {deleteError ? (
        <p className="adm-node-row-error" role="alert">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
    </TableRow>
  );
}
