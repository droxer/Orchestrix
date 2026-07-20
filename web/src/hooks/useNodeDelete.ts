"use client";

import { useState } from "react";
import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../types";
import { useDialogs } from "@/components/ui/DialogProvider";

/** Shared delete-confirm/pending/error flow for node surfaces (NodeRow, NodeCard). */
export function useNodeDelete(
  node: ControlPanelDaemonNodeRecord,
  onDelete: ((node: ControlPanelDaemonNodeRecord) => Promise<void>) | undefined,
  t: TFunction,
) {
  const { confirm } = useDialogs();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  return { deletePending, deleteError, handleDelete };
}
