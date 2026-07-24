"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";
import { formatRelativeTime } from "../../lib/adminHelpers";
import { managedNodeHistory } from "../../lib/managedNodeHistory";
import type { ManagedNodeRecord } from "../../types";
import { AdminDelete, AdminNode } from "../icons";

interface ManagedNodeHistoryProps {
  nodes: ManagedNodeRecord[];
  onDeletePermanently: (node: ManagedNodeRecord) => Promise<void>;
}

export function ManagedNodeHistory({ nodes, onDeletePermanently }: ManagedNodeHistoryProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historical = managedNodeHistory(nodes);

  if (historical.length === 0) return null;

  async function handleDelete(node: ManagedNodeRecord) {
    const accepted = await confirm({
      title: t("admin.v2.history_delete_confirm", { name: node.displayName, id: node.id }),
      message: t("admin.v2.history_delete_warning"),
      confirmLabel: t("admin.v2.history_delete_action"),
      tone: "danger",
    });
    if (!accepted) return;
    setPendingId(node.id);
    setError(null);
    try {
      await onDeletePermanently(node);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="adm-node-history" aria-labelledby="managed-node-history-title">
      <header className="adm-node-history-head">
        <div>
          <h2 id="managed-node-history-title">{t("admin.v2.history_title")}</h2>
          <p>{t("admin.v2.history_description")}</p>
        </div>
        <span className="adm-node-history-count mono">{historical.length}</span>
      </header>

      <ul className="adm-node-history-list">
        {historical.map((node) => (
          <li key={node.id} className="adm-node-history-row">
            <span className="adm-node-history-icon" aria-hidden="true">
              <AdminNode size={16} />
            </span>
            <span className="adm-node-history-identity">
              <strong>{node.displayName}</strong>
              <span className="mono">{node.id}</span>
            </span>
            <span className="adm-node-history-meta">
              {node.employeeId ? `@${node.employeeId} · ` : ""}{node.provider} · {node.profile}
            </span>
            <time dateTime={node.updatedAt} title={node.updatedAt}>
              {t("admin.v2.history_deleted", { time: formatRelativeTime(node.updatedAt, t) })}
            </time>
            <Button
              variant="ghost"
              type="button"
              className="adm-node-history-delete danger"
              disabled={pendingId === node.id}
              onClick={() => void handleDelete(node)}
            >
              <AdminDelete size={14} aria-hidden="true" />
              {pendingId === node.id
                ? t("admin.v2.history_deleting")
                : t("admin.v2.history_delete_action")}
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p className="adm-node-history-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p> : null}
    </section>
  );
}
