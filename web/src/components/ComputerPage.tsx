"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateComputerDisplayName, updateDaemonNodeDisabledAgents } from "../api";
import type { ControlPanelDaemonNodeRecord, CurrentUser, DaemonNodeMonitorRecord } from "../types";
import { nodesAssignedToEmployee } from "../lib/computerNodes";
import { useMutationError } from "../hooks/useMutationError";
import { useDialogs } from "./ui/DialogProvider";
import { NodeCard } from "./admin/NodeCard";
import { ManageExecutorsDrawer } from "./admin/ManageExecutorsDrawer";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { AdminNode } from "./icons";

export function ComputerPage({
  nodes,
  currentUser,
}: {
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
}) {
  const { t } = useTranslation();
  const { prompt } = useDialogs();
  const { reportMutationError } = useMutationError();
  const [overrides, setOverrides] = useState<Record<string, ControlPanelDaemonNodeRecord>>({});
  const [manageExecutorsNodeId, setManageExecutorsNodeId] = useState<string | null>(null);

  const myNodes = useMemo<ControlPanelDaemonNodeRecord[]>(
    () =>
      nodesAssignedToEmployee(nodes, currentUser.employeeId).map((node): ControlPanelDaemonNodeRecord => {
        const override = overrides[node.id];
        return override && override.updatedAt >= node.updatedAt ? override : node;
      }),
    [nodes, currentUser.employeeId, overrides],
  );
  const manageExecutorsNode = myNodes.find((node) => node.id === manageExecutorsNodeId) ?? null;

  function handleNodeUpdated(updated: ControlPanelDaemonNodeRecord) {
    setOverrides((prev) => ({ ...prev, [updated.id]: updated }));
  }

  async function handleRenameNode(node: ControlPanelDaemonNodeRecord) {
    const current = node.displayName?.trim() && node.displayName !== node.id
      ? node.displayName.trim()
      : "";
    const result = await prompt({
      title: t("thread.rename_computer"),
      message: t("thread.rename_computer_message", { id: node.id }),
      defaultValue: current,
      placeholder: t("thread.computer_name_placeholder"),
      confirmLabel: t("thread.rename"),
    });
    if (result === null) return;
    const displayName = result.trim();
    if (displayName === current) return;
    try {
      const updated = await updateComputerDisplayName(node.id, displayName || null);
      handleNodeUpdated({ ...node, ...updated.node });
    } catch (error) {
      reportMutationError("Failed to rename computer", error, t("errors.rename_computer"));
    }
  }

  return (
    <section id="computer-panel" className="computer-page" aria-label={t("computer.title")} tabIndex={-1}>
      <PageHeader
        kicker={t("nav.workspace")}
        title={t("computer.title")}
        count={t("computer.count", { count: myNodes.length })}
        titleVariant="display"
        layout="stacked"
      />
      {myNodes.length === 0 ? (
        <RelayEmptyState
          title={t("computer.empty_title")}
          body={t("computer.empty_body")}
          illustration={<AdminNode size={40} aria-hidden="true" />}
        />
      ) : (
        <div className="adm-fleet-grid">
          {myNodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onRename={(target) => void handleRenameNode(target)}
              onManageExecutors={(target) => setManageExecutorsNodeId(target.id)}
              t={t}
            />
          ))}
        </div>
      )}
      <ManageExecutorsDrawer
        open={manageExecutorsNodeId !== null}
        onClose={() => setManageExecutorsNodeId(null)}
        node={manageExecutorsNode}
        onUpdated={handleNodeUpdated}
        onSave={updateDaemonNodeDisabledAgents}
      />
    </section>
  );
}
