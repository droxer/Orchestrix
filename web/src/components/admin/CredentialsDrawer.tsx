"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Button } from "@/components/ui/button";
import { Drawer } from "../ui/Drawer";
import { CredCopyRow } from "./CredCopyRow";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { COPY_FEEDBACK_MS, copyText, resolveNodeCredentials, type StoredNodeToken } from "./helpers";
import { canUseLocalControlPanel } from "../../lib/controlPanel";

interface CredentialsDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ControlPanelDaemonNodeRecord | null;
  storedToken?: StoredNodeToken;
  onUnassign?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
}

export function CredentialsDrawer({ open, onClose, node, storedToken, onUnassign, onDelete }: CredentialsDrawerProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<"unassign" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function runAction(kind: "unassign" | "delete", handler: () => Promise<void>) {
    setActionPending(kind);
    setActionError(null);
    try {
      await handler();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPending(null);
    }
  }

  async function handleUnassign() {
    if (!node || !onUnassign) return;
    const employee = node.employeeId ?? "";
    const ok = await confirm({
      title: t("admin.v2.unassign_confirm", { employee, id: node.id }),
      message: t("admin.v2.unassign_message"),
      confirmLabel: t("admin.v2.unassign_action"),
      tone: "danger",
    });
    if (!ok) return;
    void runAction("unassign", () => onUnassign(node));
  }

  async function handleDelete() {
    if (!node || !onDelete) return;
    const ok = await confirm({
      title: t("admin.v2.delete_confirm", { id: node.id }),
      message: t("admin.v2.delete_message"),
      confirmLabel: t("admin.v2.delete_action"),
      tone: "danger",
    });
    if (!ok) return;
    await runAction("delete", () => onDelete(node));
  }

  async function handleCopy(field: string, value: string) {
    await copyText(value);
    setCopiedField(field);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(
      () => setCopiedField((current) => (current === field ? null : current)),
      COPY_FEEDBACK_MS,
    );
  }

  if (!node) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title={t("admin.v2.credentials_title")}
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.credentials_title")}
        layer={1}
        width={520}
      >
        <p className="adm-cred-empty">{t("admin.v2.no_node_selected")}</p>
      </Drawer>
    );
  }

  const employeeLabel = node.employeeId ? `@${node.employeeId}` : t("admin.unassigned");
  const credentials = resolveNodeCredentials(node, storedToken);
  const { sandboxToken, nodeToken, daemonCommand, source } = credentials;
  const token = nodeToken ?? sandboxToken;
  const hasCredentials = source !== "none";

  const credentialsNote = (() => {
    if (source === "cache") return t("admin.v2.credentials_from_cache");
    if (source === "server") return t("admin.v2.credentials_from_server");
    if (source === "cache+server") return t("admin.v2.credentials_from_cache_and_server");
    return null;
  })();

  const hasDangerZone = Boolean(onUnassign || onDelete);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("admin.v2.credentials_title")}
      subtitle={
        <span className="code" translate="no">
          {employeeLabel} · {node.id}
        </span>
      }
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.credentials_title")}
      layer={1}
      width={520}
      bodyClassName={hasDangerZone ? "adm-drawer-body--column" : undefined}
    >
      <div className={hasDangerZone ? "adm-form" : undefined}>
        <NodeProfileBadges
          node={node}
          storedTokens={storedToken ? { [node.id]: storedToken } : {}}
          colocated={canUseLocalControlPanel()}
          t={t}
          compact
        />
        <CredCopyRow
          label={t("admin.node_id")}
          hint={t("admin.node_id_hint")}
          value={node.id}
          copyLabel={t("admin.copy_node_id")}
          copied={copiedField === "node-id"}
          onCopy={() => void handleCopy("node-id", node.id)}
        />
        {hasCredentials ? (
          <>
            {token ? (
              <CredCopyRow
                label={t("admin.node_token")}
                value={token}
                copyLabel={t("admin.copy_node_token")}
                copied={copiedField === "node-token"}
                onCopy={() => void handleCopy("node-token", token)}
              />
            ) : null}
            {daemonCommand ? (
              <CredCopyRow
                label={t("admin.daemon_command")}
                hint={t("admin.daemon_command_hint")}
                value={daemonCommand}
                copyLabel={t("admin.copy_daemon_command")}
                copied={copiedField === "command"}
                onCopy={() => void handleCopy("command", daemonCommand)}
              />
            ) : null}
            {credentialsNote ? (
              <p className="adm-cred-note">{credentialsNote}</p>
            ) : (
              <p className="adm-cred-note">
                {t("admin.token_cached_note", { employee: employeeLabel })}
              </p>
            )}
          </>
        ) : (
          <p className="adm-cred-empty">{t("admin.v2.token_only_at_provision")}</p>
        )}
        {hasDangerZone ? (
          <>
            <div className="adm-drawer-section">
              <p className="adm-drawer-section-title">{t("admin.v2.danger_zone")}</p>
              <div className="adm-drawer-section-actions">
                {onUnassign && node.employeeId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUnassign}
                    disabled={actionPending !== null}
                    loading={actionPending === "unassign"}
                  >
                    {actionPending === "unassign" ? t("admin.v2.unassigning") : t("admin.v2.unassign_action")}
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={actionPending !== null}
                    loading={actionPending === "delete"}
                  >
                    {actionPending === "delete" ? t("admin.v2.deleting") : t("admin.v2.delete_action")}
                  </Button>
                ) : null}
              </div>
              {actionError ? (
                <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: actionError })}</p>
              ) : null}
            </div>
            <div className="adm-form-actions">
              <Button size="cta" type="button" variant="ghost" onClick={onClose} disabled={actionPending !== null}>
                {t("admin.v2.close_drawer")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
