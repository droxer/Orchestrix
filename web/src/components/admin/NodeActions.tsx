"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { Button } from "../ui/button";
import { ActionKey, AdminDelete, AdminManageAgents } from "../icons";

interface NodeActionsProps {
  node: ControlPanelDaemonNodeRecord;
  onReveal: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  deletePending: boolean;
  onDeleteRequest: () => void;
  t: TFunction;
}

/** Shared reveal/manage/delete icon-button trio for node surfaces (NodeRow, NodeCard). */
export function NodeActions({ node, onReveal, onManageAgents, onDelete, deletePending, onDeleteRequest, t }: NodeActionsProps) {
  return (
    <>
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
      {!node.provisioningPlaceholder ? (
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
      ) : null}
      {onDelete ? (
        <Button
          variant="ghost"
          type="button"
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn danger"
          onClick={onDeleteRequest}
          disabled={deletePending}
          aria-label={t("admin.v2.delete_node_for", { id: node.id })}
          title={t("admin.v2.delete_action")}
        >
          <AdminDelete size={14} aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}
