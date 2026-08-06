"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { Button } from "@/components/ui/button";
import { ActionEdit, ActionKey, AdminDelete, AdminManageExecutors } from "../icons";

interface NodeActionsProps {
  node: ControlPanelDaemonNodeRecord;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  deletePending: boolean;
  onDeleteRequest: () => void;
  t: TFunction;
}

/** Shared reveal/manage/delete icon-button trio for node surfaces (NodeRow, NodeCard). */
export function NodeActions({ node, onReveal, onRename, onManageExecutors, onDelete, deletePending, onDeleteRequest, t }: NodeActionsProps) {
  return (
    <>
      <Button
        variant="ghost"
        type="button"
        className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn adm-node-action--rename"
        onClick={() => onRename(node)}
        aria-label={t("admin.v2.rename_computer_for", { id: node.id })}
        title={t("thread.rename_computer")}
      >
        <ActionEdit size={14} aria-hidden="true" />
      </Button>
      {node.managedNodeId || !onReveal ? null : (
        <Button
          variant="ghost"
          type="button"
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn adm-node-action--credentials"
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
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn adm-node-action--agents"
          onClick={() => onManageExecutors(node)}
          aria-label={t("admin.v2.manage_executors_for", { id: node.id })}
          title={t("admin.v2.manage_executors")}
        >
          <AdminManageExecutors size={14} aria-hidden="true" />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          variant="ghost"
          type="button"
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn adm-node-action--delete danger"
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
