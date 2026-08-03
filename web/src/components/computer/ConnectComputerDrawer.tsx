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

type SandboxMode = "boxlite" | "none";

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
 */
export function ConnectComputerDrawer({ open, onClose, onConnected }: ConnectComputerDrawerProps) {
  const { t } = useTranslation();
  const [workspacePath, setWorkspacePath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>("none");
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
      setSandboxMode("none");
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
        sandboxMode,
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
          <p className="adm-cred-note">{t("computer.connect_success")}</p>
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
          <p className="adm-cred-note">{t("computer.connect_token_once")}</p>
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
            <Field label={t("workspace_label")}>
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
            <div className="adm-profile-field">
              <div className="adm-profile-segment" role="radiogroup" aria-label={t("computer.connect_sandbox_label")}>
                {(["none", "boxlite"] as const).map((mode) => {
                  const selected = sandboxMode === mode;
                  return (
                    <label key={mode} className="adm-profile-segment-option">
                      <input
                        className="adm-profile-segment-input"
                        type="radio"
                        name="connect-computer-sandbox-mode"
                        value={mode}
                        checked={selected}
                        disabled={isBusy}
                        onChange={() => setSandboxMode(mode)}
                      />
                      <span className="adm-profile-segment-btn" data-active={selected ? "true" : "false"}>
                        <span className="adm-profile-segment-dot" data-kind={mode === "boxlite" ? "managed" : "local"} aria-hidden="true" />
                        {t(`computer.connect_sandbox_${mode}`)}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="adm-form-hint">{t(`computer.connect_sandbox_${sandboxMode}_desc`)}</p>
            </div>
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
