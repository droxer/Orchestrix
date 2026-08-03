"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateComputerDisplayName, updateDaemonNodeDisabledAgents } from "../api";
import type {
  ControlPanelDaemonNodeRecord,
  CreateLocalDeviceEnrollmentResponse,
  CurrentUser,
  DaemonNodeMonitorRecord,
} from "../types";
import { nodesAssignedToEmployee } from "../lib/computerNodes";
import { useMutationError } from "../hooks/useMutationError";
import { useDialogs } from "./ui/DialogProvider";
import { ComputerCard } from "./computer/ComputerCard";
import { ConnectComputerDrawer } from "./computer/ConnectComputerDrawer";
import { ManageExecutorsDrawer } from "./admin/ManageExecutorsDrawer";
import { Button } from "./ui/button";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { ActionAdd, AdminNode } from "./icons";

export function ComputerPage({
  nodes,
  currentUser,
  onOpenThread,
}: {
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
  /** Opens the thread behind a run, so "something is running" is one click
      away from "here is what it is doing". */
  onOpenThread?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const { prompt } = useDialogs();
  const { reportMutationError } = useMutationError();
  const [overrides, setOverrides] = useState<Record<string, ControlPanelDaemonNodeRecord>>({});
  const [manageExecutorsNodeId, setManageExecutorsNodeId] = useState<string | null>(null);
  const [connectDrawerOpen, setConnectDrawerOpen] = useState(false);

  const myNodes = useMemo<ControlPanelDaemonNodeRecord[]>(() => {
    const merged = nodesAssignedToEmployee(nodes, currentUser.employeeId).map(
      (node): ControlPanelDaemonNodeRecord => {
        const override = overrides[node.id];
        return override && override.updatedAt >= node.updatedAt ? override : node;
      },
    );
    // A freshly-connected computer lives only in `overrides` until the next
    // nodes poll folds it into `nodes` — surface it immediately instead of
    // waiting on a refetch.
    const knownIds = new Set(merged.map((node) => node.id));
    const newlyConnected = Object.values(overrides).filter(
      (node) => !knownIds.has(node.id) && node.employeeId === currentUser.employeeId,
    );
    return [...newlyConnected, ...merged];
  }, [nodes, currentUser.employeeId, overrides]);
  const manageExecutorsNode = myNodes.find((node) => node.id === manageExecutorsNodeId) ?? null;

  function handleNodeUpdated(updated: ControlPanelDaemonNodeRecord) {
    setOverrides((prev) => ({ ...prev, [updated.id]: updated }));
  }

  function handleConnected(result: CreateLocalDeviceEnrollmentResponse) {
    handleNodeUpdated(result.node);
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
        kicker={t("nav.manage")}
        title={t("computer.title")}
        count={t("computer.count", { count: myNodes.length })}
        titleVariant="display"
        layout="stacked"
        actions={
          <Button type="button" size="sm" onClick={() => setConnectDrawerOpen(true)}>
            <ActionAdd size={14} aria-hidden="true" />
            {t("computer.connect_button")}
          </Button>
        }
      />
      {/* The shell clips its children, so the roster needs its own scroll
          container — see computer.css. */}
      <div className="computer-page-body">
        {myNodes.length === 0 ? (
          <RelayEmptyState
            title={t("computer.empty_title")}
            body={t("computer.empty_body")}
            illustration={<AdminNode size={40} aria-hidden="true" />}
            actions={
              <Button type="button" onClick={() => setConnectDrawerOpen(true)}>
                <ActionAdd size={14} aria-hidden="true" />
                {t("computer.connect_button")}
              </Button>
            }
          />
        ) : (
          <ul className="computer-list">
            {myNodes.map((node) => (
              <li key={node.id}>
                <ComputerCard
                  node={node}
                  onRename={(target) => void handleRenameNode(target)}
                  onManageExecutors={(target) => setManageExecutorsNodeId(target.id)}
                  onOpenThread={onOpenThread}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <ManageExecutorsDrawer
        open={manageExecutorsNodeId !== null}
        onClose={() => setManageExecutorsNodeId(null)}
        node={manageExecutorsNode}
        onUpdated={handleNodeUpdated}
        onSave={updateDaemonNodeDisabledAgents}
      />
      <ConnectComputerDrawer
        open={connectDrawerOpen}
        onClose={() => setConnectDrawerOpen(false)}
        onConnected={handleConnected}
      />
    </section>
  );
}
