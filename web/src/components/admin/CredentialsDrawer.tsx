"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Drawer } from "./Drawer";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { copyText, resolveNodeCredentials, type StoredNodeToken } from "./helpers";
import { canUseLocalControlPanel } from "../../lib/controlPanel";

interface CredentialsDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ControlPanelDaemonNodeRecord | null;
  storedToken?: StoredNodeToken;
  onUnassign?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
}

interface RowProps {
  label: string;
  value: string;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
  hint?: string;
}

function DarkCopyRow({ label, value, copyLabel, copied, onCopy, hint }: RowProps) {
  const { t } = useTranslation();
  return (
    <div className="adm-cred-row">
      <span className="adm-cred-label">{label}</span>
      {hint ? <span className="adm-cred-hint">{hint}</span> : null}
      <div className="adm-cred-value-line">
        <code className="adm-cred-value mono">{value}</code>
        <button
          type="button"
          className={`adm-copy-pill ${copied ? "copied" : ""}`}
          onClick={onCopy}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? t("admin.copied") : t("admin.copy")}</span>
        </button>
      </div>
    </div>
  );
}

export function CredentialsDrawer({ open, onClose, node, storedToken, onUnassign, onDelete }: CredentialsDrawerProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<"unassign" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      tone: "danger",
    });
    if (!ok) return;
    void runAction("unassign", () => onUnassign(node));
  }

  async function handleDelete() {
    if (!node || !onDelete) return;
    const ok = await confirm({
      title: t("admin.v2.delete_confirm", { id: node.id }),
      confirmLabel: t("admin.v2.delete_action"),
      tone: "danger",
    });
    if (!ok) return;
    void runAction("delete", () => onDelete(node));
  }

  async function handleCopy(field: string, value: string) {
    await copyText(value);
    setCopiedField(field);
    window.setTimeout(
      () => setCopiedField((current) => (current === field ? null : current)),
      1400,
    );
  }

  if (!node) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title={t("admin.v2.credentials_title")}
        variant="light"
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.credentials_title")}
        layer={1}
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

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("admin.v2.credentials_title")}
      subtitle={
        <span className="mono" translate="no">
          {employeeLabel} · {node.id}
        </span>
      }
      variant="dark"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.credentials_title")}
      layer={1}
    >
      {node ? (
        <NodeProfileBadges
          node={node}
          storedTokens={storedToken && node ? { [node.id]: storedToken } : {}}
          colocated={canUseLocalControlPanel()}
          t={t}
          compact
        />
      ) : null}
      <DarkCopyRow
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
            <DarkCopyRow
              label={t("admin.node_token")}
              value={token}
              copyLabel={t("admin.copy_node_token")}
              copied={copiedField === "node-token"}
              onCopy={() => void handleCopy("node-token", token)}
            />
          ) : null}
          {daemonCommand ? (
            <DarkCopyRow
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
      {(onUnassign || onDelete) ? (
        <div className="adm-cred-actions">
          <p className="adm-cred-actions-title">{t("admin.v2.danger_zone")}</p>
          {onUnassign && node.employeeId ? (
            <button
              type="button"
              className="adm-cred-action-button"
              onClick={handleUnassign}
              disabled={actionPending !== null}
            >
              {t("admin.v2.unassign_action")}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="adm-cred-action-button danger"
              onClick={handleDelete}
              disabled={actionPending !== null}
            >
              {t("admin.v2.delete_action")}
            </button>
          ) : null}
          {actionError ? (
            <p className="adm-cred-action-error">{t("admin.v2.action_failed", { message: actionError })}</p>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
