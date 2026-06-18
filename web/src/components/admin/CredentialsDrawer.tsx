"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { Drawer } from "./Drawer";
import { copyText, type StoredNodeToken } from "./helpers";

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
}

function DarkCopyRow({ label, value, copyLabel, copied, onCopy }: RowProps) {
  const { t } = useTranslation();
  return (
    <div className="adm-cred-row">
      <span className="adm-cred-label">{label}</span>
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

  function handleUnassign() {
    if (!node || !onUnassign) return;
    const employee = node.employeeId ?? "";
    if (!window.confirm(t("admin.v2.unassign_confirm", { employee, id: node.id }))) return;
    void runAction("unassign", () => onUnassign(node));
  }

  function handleDelete() {
    if (!node || !onDelete) return;
    if (!window.confirm(t("admin.v2.delete_confirm", { id: node.id }))) return;
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
        variant="dark"
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.credentials_title")}
        layer={1}
      >
        <p className="adm-cred-empty">{t("admin.v2.no_node_selected")}</p>
      </Drawer>
    );
  }

  const employeeLabel = node.employeeId ? `@${node.employeeId}` : t("admin.unassigned");
  const sandboxToken = storedToken?.sandboxToken;
  const nodeToken = storedToken?.nodeToken ?? node.nodeToken;
  const daemonCommand = storedToken?.daemonCommand;
  const hasCredentials = Boolean(sandboxToken || nodeToken);

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
      <DarkCopyRow
        label={t("admin.sandbox_id")}
        value={node.id}
        copyLabel={t("admin.copy_sandbox_id")}
        copied={copiedField === "sandbox-id"}
        onCopy={() => void handleCopy("sandbox-id", node.id)}
      />
      {hasCredentials ? (
        <>
          {sandboxToken ? (
            <DarkCopyRow
              label={t("admin.sandbox_token")}
              value={sandboxToken}
              copyLabel={t("admin.copy_sandbox_token")}
              copied={copiedField === "sandbox-token"}
              onCopy={() => void handleCopy("sandbox-token", sandboxToken)}
            />
          ) : null}
          {nodeToken ? (
            <DarkCopyRow
              label={t("admin.daemon_node_token")}
              value={nodeToken}
              copyLabel={t("admin.copy_daemon_node_token")}
              copied={copiedField === "node-token"}
              onCopy={() => void handleCopy("node-token", nodeToken)}
            />
          ) : null}
          {daemonCommand ? (
            <DarkCopyRow
              label={t("admin.daemon_command")}
              value={daemonCommand}
              copyLabel={t("admin.copy_daemon_command")}
              copied={copiedField === "command"}
              onCopy={() => void handleCopy("command", daemonCommand)}
            />
          ) : null}
          <p className="adm-cred-note">
            {t("admin.token_cached_note", { employee: employeeLabel })}
          </p>
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
