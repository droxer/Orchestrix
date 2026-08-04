"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createLocalDeviceEnrollment } from "../../api";
import type { CreateLocalDeviceEnrollmentResponse } from "../../types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Drawer } from "../ui/Drawer";
import { CredCopyRow } from "../admin/CredCopyRow";
import { COPY_FEEDBACK_MS, copyText } from "../admin/helpers";

interface ConnectComputerDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Fires once the node exists on the backend, so the caller can merge it into the roster right away. */
  onConnected: (result: CreateLocalDeviceEnrollmentResponse) => void;
}

/**
 * Self-service registration of the employee's own machine — the counterpart
 * to admin's AssignNodeDrawer, but scoped to the caller's own device: no
 * employee picker, no "assign an existing node" branch, just "connect this
 * one" against POST /daemon-node-enrollments/local.
 *
 * A personal computer runs its agents directly, so there is no runtime to
 * pick here: BoxLite isolation is provisioned on admin-owned hardware, and
 * offering it as a choice to the person at the keyboard only invited them to
 * ask their own laptop for a sandbox it was never set up to boot.
 */
export function ConnectComputerDrawer({ open, onClose, onConnected }: ConnectComputerDrawerProps) {
  const { t } = useTranslation();
  const [workspacePath, setWorkspacePath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<CreateLocalDeviceEnrollmentResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const workspacePathRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setWorkspacePath("");
      setDisplayName("");
      setFieldError(null);
      setError(null);
      setIsBusy(false);
      setResult(null);
      setCopiedField(null);
    }
  }, [open]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = workspacePath.trim();
    if (!trimmedPath || !isAbsolutePath(trimmedPath)) {
      setFieldError(t("computer.connect_workspace_path_error"));
      workspacePathRef.current?.focus();
      return;
    }
    setFieldError(null);
    setError(null);
    setIsBusy(true);
    try {
      const response = await createLocalDeviceEnrollment({
        workspacePath: trimmedPath,
        displayName: displayName.trim() || undefined,
      });
      setResult(response);
      onConnected(response);
    } catch (err) {
      setError(t("computer.connect_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
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

  function requestClose() {
    if (isBusy) return;
    onClose();
  }

  const token = result?.nodeToken ?? result?.sandboxToken;

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={t("computer.connect_title")}
      subtitle={result ? undefined : t("computer.connect_sub")}
      width={480}
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("computer.connect_title")}
      bodyClassName="adm-drawer-body--column"
    >
      {result ? (
        <div className="adm-form">
          {/* A token is issued once. When the backend adopts a computer that
              already enrolled it cannot reproduce one — so the panel must stop
              promising a token and point at the copy the machine already has,
              rather than leaving the reader holding an id and no next step. */}
          <p className="adm-cred-note">
            {token ? t("computer.connect_success") : t("computer.connect_success_existing")}
          </p>
          <CredCopyRow
            label={t("admin.node_id")}
            hint={t("admin.node_id_hint")}
            value={result.node.id}
            copyLabel={t("admin.copy_node_id")}
            copied={copiedField === "node-id"}
            onCopy={() => void handleCopy("node-id", result.node.id)}
          />
          {token ? (
            <CredCopyRow
              label={t("admin.node_token")}
              value={token}
              copyLabel={t("admin.copy_node_token")}
              copied={copiedField === "node-token"}
              onCopy={() => void handleCopy("node-token", token)}
            />
          ) : null}
          {result.daemonCommand ? (
            <CredCopyRow
              label={t("admin.daemon_command")}
              hint={t("admin.daemon_command_hint")}
              value={result.daemonCommand}
              copyLabel={t("admin.copy_daemon_command")}
              copied={copiedField === "command"}
              onCopy={() => void handleCopy("command", result.daemonCommand!)}
            />
          ) : null}
          <p className="adm-cred-note">
            {token ? t("computer.connect_token_once") : t("computer.connect_token_on_device")}
          </p>
          <div className="adm-form-actions">
            <Button size="cta" type="button" onClick={onClose}>
              {t("admin.v2.close_drawer")}
            </Button>
          </div>
        </div>
      ) : (
        <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <fieldset className="adm-form-section">
            <Field label={t("computer.connect_name_label")}>
              <input
                name="connect-computer-display-name"
                autoComplete="off"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("admin.v2.computer_name_placeholder_local")}
                maxLength={64}
                disabled={isBusy}
              />
            </Field>
            {/* `workspace_label` lives under `nav`, so the bare key resolved to
                nothing and the field rendered the literal "workspace_label".
                This is the same word the card's Details row already uses. */}
            <Field label={t("computer.fact_workspace")}>
              <input
                ref={workspacePathRef}
                name="connect-computer-workspace-path"
                autoComplete="off"
                value={workspacePath}
                onChange={(event) => {
                  setWorkspacePath(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                placeholder="/Users/alice/project"
                disabled={isBusy}
                aria-invalid={Boolean(fieldError) || undefined}
                aria-describedby={fieldError ? "connect-computer-workspace-path-error" : undefined}
                data-modal-initial-focus
              />
              {fieldError ? (
                <span id="connect-computer-workspace-path-error" className="text-sm text-danger" role="alert">
                  {fieldError}
                </span>
              ) : null}
            </Field>
            {/* Stated, not chosen: the employee should know their agents run
                as plain processes against the installs already on this
                machine, but the mode is not theirs to change. */}
            <p className="adm-form-hint">{t("computer.connect_run_hint")}</p>
          </fieldset>

          {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

          <div className="adm-form-actions">
            <Button size="cta" type="button" variant="ghost" onClick={requestClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </Button>
            <Button size="cta" type="submit" loading={isBusy}>
              {isBusy ? t("computer.connect_connecting") : t("computer.connect_action")}
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}
