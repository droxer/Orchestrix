"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createLocalDeviceEnrollment } from "../../api";
import type { CreateLocalDeviceEnrollmentResponse } from "../../types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Drawer } from "@/components/ui/Drawer";
import { CredCopyRow } from "../admin/CredCopyRow";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

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
  const { copiedField, copy } = useCopyFeedback();
  const workspacePathRef = useRef<HTMLInputElement>(null);
  const hasUnsavedChanges = !result && (Boolean(workspacePath.trim()) || Boolean(displayName.trim()));
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  useEffect(() => {
    if (open) {
      setWorkspacePath("");
      setDisplayName("");
      setFieldError(null);
      setError(null);
      setIsBusy(false);
      setResult(null);
    }
  }, [open]);

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

  async function requestClose() {
    if (isBusy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  const token = result?.nodeToken ?? result?.sandboxToken;

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      kicker={t("computer.title")}
      title={t("computer.connect_title")}
      subtitle={result ? t("computer.connect_success_sub") : t("computer.connect_sub")}
      width="form"
      closeLabel={t("admin.v2.close_drawer")}
      bodyClassName="adm-drawer-body--column"
    >
      {result ? (
        <div className="adm-form">
          {/* Two different questions, two different answers. Whether this was a
              new computer or an adopted one is `reused` — token presence does
              not answer it, because adopting a computer whose enrollment never
              finished reissues a token. Whether there is a secret to show is
              `token`. Reading the first off the second told someone re-running
              a half-finished connect that they had just connected. */}
          <p className="adm-cred-note">
            {result.reused ? t("computer.connect_success_existing") : t("computer.connect_success")}
          </p>
          <CredCopyRow
            label={t("admin.node_id")}
            hint={t("admin.node_id_hint")}
            value={result.node.id}
            copyLabel={t("admin.copy_node_id")}
            copied={copiedField === "node-id"}
            onCopy={() => void copy("node-id", result.node.id)}
          />
          {token ? (
            <CredCopyRow
              label={t("admin.node_token")}
              value={token}
              copyLabel={t("admin.copy_node_token")}
              copied={copiedField === "node-token"}
              onCopy={() => void copy("node-token", token)}
            />
          ) : null}
          {result.daemonCommand ? (
            <CredCopyRow
              label={t("admin.daemon_command")}
              hint={t("admin.daemon_command_hint")}
              value={result.daemonCommand}
              copyLabel={t("admin.copy_daemon_command")}
              copied={copiedField === "command"}
              onCopy={() => void copy("command", result.daemonCommand!)}
            />
          ) : null}
          {/* This one is about the secret itself, so it stays keyed on `token`:
              a reissued token is still shown exactly once. */}
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
              <Input
                name="connect-computer-display-name"
                autoComplete="off"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("admin.v2.computer_name_placeholder_local")}
                maxLength={64}
                disabled={isBusy}
              />
            </Field>
            <Field
              label={t("nav.workspace_label")}
              error={fieldError ?? undefined}
              errorId="connect-computer-workspace-path-error"
            >
              <Input
                ref={workspacePathRef}
                name="connect-computer-workspace-path"
                autoComplete="off"
                value={workspacePath}
                onChange={(event) => {
                  setWorkspacePath(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                placeholder={workspacePathPlaceholder()}
                disabled={isBusy}
                aria-invalid={Boolean(fieldError) || undefined}
                aria-describedby={fieldError ? "connect-computer-workspace-path-error" : undefined}
                data-modal-initial-focus
              />
            </Field>
            {/* Stated, not chosen: the employee should know their agents run
                as plain processes against the installs already on this
                machine, but the mode is not theirs to change. */}
            <p className="adm-form-hint">{t("computer.connect_run_hint")}</p>
          </fieldset>

          {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

          <div className="adm-form-actions">
            <Button size="cta" type="button" variant="ghost" onClick={() => { void requestClose(); }} disabled={isBusy}>
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

function workspacePathPlaceholder(): string {
  if (typeof navigator !== "undefined" && /Win/i.test(navigator.platform)) {
    return "C:\\Users\\alice\\project";
  }
  return "/Users/alice/project";
}
