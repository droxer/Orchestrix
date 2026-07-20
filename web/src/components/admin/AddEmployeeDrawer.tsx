"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createControlPanelEmployee } from "../../api";
import { initialsOf } from "../../lib/adminHelpers";
import type {
  ControlPanelDaemonNodeRecord,
  CreateControlPanelEmployeeResponse,
} from "../../types";
import { Drawer } from "./Drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AddEmployeeDrawerProps {
  open: boolean;
  onClose: () => void;
  unassignedNodes: ControlPanelDaemonNodeRecord[];
  onSuccess: (result: CreateControlPanelEmployeeResponse) => void;
}

export function AddEmployeeDrawer({
  open,
  onClose,
  unassignedNodes,
  onSuccess,
}: AddEmployeeDrawerProps) {
  const { t } = useTranslation();

  const [employeeId, setEmployeeId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    employeeId?: string;
    username?: string;
    password?: string;
  }>({});
  const [isBusy, setIsBusy] = useState(false);
  const employeeIdRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const hasUnsavedChanges = Boolean(
    employeeId.trim()
    || displayName.trim()
    || email.trim()
    || username.trim()
    || password
    || selectedNodeId,
  );
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  const handlePreview = employeeId.trim().replace(/^@/, "");
  const namePreview = displayName.trim();

  useEffect(() => {
    if (!open) {
      setEmployeeId("");
      setDisplayName("");
      setEmail("");
      setUsername("");
      setPassword("");
      setSelectedNodeId("");
      setError(null);
      setFieldErrors({});
      setIsBusy(false);
    }
  }, [open]);

  function clearFieldError(field: "employeeId" | "username" | "password") {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    const nextFieldErrors: typeof fieldErrors = {};
    if (!nextEmployeeId) nextFieldErrors.employeeId = t("admin.employee_required");
    if (!username.trim()) nextFieldErrors.username = t("admin.username_required");
    if (!password) nextFieldErrors.password = t("admin.password_required");
    setFieldErrors(nextFieldErrors);
    const firstInvalid = nextFieldErrors.employeeId
      ? employeeIdRef
      : nextFieldErrors.username
        ? usernameRef
        : nextFieldErrors.password
          ? passwordRef
          : null;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const result = await createControlPanelEmployee({
        employeeId: nextEmployeeId,
        username: username.trim(),
        password,
        nodeId: selectedNodeId || undefined,
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
      });
      onSuccess(result);
    } catch (err) {
      setError(t("admin.v2.add_employee_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  async function requestClose() {
    if (isBusy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  const canSubmit = Boolean(employeeId.trim() && username.trim() && password);

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      kicker={t("admin.v2.provision_kicker_employee")}
      title={t("admin.v2.add_employee_title")}
      subtitle={t("admin.v2.add_employee_sub")}
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.add_employee_title")}
      bodyClassName="adm-drawer-body--column"
      width={460}
    >
      <form className="adm-form adm-provision-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <section className="adm-provision-section" aria-labelledby="adm-emp-identity">
          <header className="adm-provision-section-head">
            <h3 id="adm-emp-identity" className="adm-provision-section-title">
              {t("admin.v2.section_identity")}
            </h3>
          </header>

          <div className={`adm-provision-preview ${handlePreview ? "is-live" : ""}`} aria-live="polite">
            <span className="adm-assign-avatar" aria-hidden="true">
              {handlePreview ? initialsOf(handlePreview) : "?"}
            </span>
            <div className="adm-provision-preview-text">
              <span className="adm-provision-preview-handle mono">
                {handlePreview ? `@${handlePreview}` : t("admin.v2.provision_preview_placeholder")}
              </span>
              <span className="adm-provision-preview-name">
                {namePreview || t("admin.v2.provision_preview_name_hint")}
              </span>
            </div>
          </div>

          <label className="adm-field">
            <span>
              {t("admin.employee_id")}
              <span className="adm-field-req" aria-hidden="true">*</span>
            </span>
            <Input
              ref={employeeIdRef}
              name="employee-id"
              className="mono"
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                clearFieldError("employeeId");
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("admin.v2.placeholder_employee_id")}
              aria-invalid={Boolean(fieldErrors.employeeId) || undefined}
              aria-describedby={fieldErrors.employeeId ? "add-emp-employee-id-error" : undefined}
            />
            {fieldErrors.employeeId ? (
              <span id="add-emp-employee-id-error" className="text-sm text-danger-strong" role="alert">
                {fieldErrors.employeeId}
              </span>
            ) : null}
          </label>

          <label className="adm-field">
            <span>
              {t("admin.display_name")}
              <span className="adm-field-opt">{t("admin.v2.optional")}</span>
            </span>
            <Input
              name="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
              placeholder={t("admin.v2.placeholder_display_name")}
            />
          </label>

          <label className="adm-field">
            <span>
              {t("admin.email")}
              <span className="adm-field-opt">{t("admin.v2.optional")}</span>
            </span>
            <Input
              name="email"
              className="mono"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              spellCheck={false}
              placeholder={t("admin.v2.placeholder_email")}
            />
          </label>
        </section>

        <section className="adm-provision-section" aria-labelledby="adm-emp-credentials">
          <header className="adm-provision-section-head">
            <h3 id="adm-emp-credentials" className="adm-provision-section-title">
              {t("admin.v2.section_credentials")}
            </h3>
          </header>

          <label className="adm-field">
            <span>
              {t("admin.username")}
              <span className="adm-field-req" aria-hidden="true">*</span>
            </span>
            <Input
              ref={usernameRef}
              name="username"
              className="mono"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                clearFieldError("username");
              }}
              autoComplete="username"
              spellCheck={false}
              placeholder={t("admin.v2.placeholder_username")}
              aria-invalid={Boolean(fieldErrors.username) || undefined}
              aria-describedby={fieldErrors.username ? "add-emp-username-error" : undefined}
            />
            {fieldErrors.username ? (
              <span id="add-emp-username-error" className="text-sm text-danger-strong" role="alert">
                {fieldErrors.username}
              </span>
            ) : null}
          </label>

          <label className="adm-field">
            <span>
              {t("admin.password")}
              <span className="adm-field-req" aria-hidden="true">*</span>
            </span>
            <Input
              ref={passwordRef}
              name="password"
              className="mono"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearFieldError("password");
              }}
              autoComplete="new-password"
              aria-invalid={Boolean(fieldErrors.password) || undefined}
              aria-describedby={fieldErrors.password ? "add-emp-password-error" : undefined}
            />
            {fieldErrors.password ? (
              <span id="add-emp-password-error" className="text-sm text-danger-strong" role="alert">
                {fieldErrors.password}
              </span>
            ) : null}
          </label>
        </section>

        <section className="adm-provision-section" aria-labelledby="adm-emp-assignment">
          <header className="adm-provision-section-head">
            <h3 id="adm-emp-assignment" className="adm-provision-section-title">
              {t("admin.v2.section_assignment")}
            </h3>
            <span className="adm-provision-section-meta">{t("admin.v2.optional")}</span>
          </header>

          {unassignedNodes.length === 0 ? (
            <p className="adm-form-hint adm-form-hint--notice">{t("admin.unassigned_hint")}</p>
          ) : (
            <label className="adm-field">
              <span>{t("admin.assign_node")}</span>
              <Select
                value={selectedNodeId || undefined}
                onValueChange={(value) => setSelectedNodeId(value ?? "")}
              >
                <SelectTrigger className="w-full mono">
                  <SelectValue placeholder={t("admin.select_node")} />
                </SelectTrigger>
                <SelectContent>
                  {unassignedNodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.id}{node.workspacePath ? ` / ${node.workspacePath}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
        </section>

        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

        <div className="adm-form-actions">
          <Button type="button" variant="ghost" onClick={() => void requestClose()} disabled={isBusy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button type="submit" disabled={isBusy || !canSubmit}>
            {isBusy ? t("admin.creating") : t("admin.v2.provision")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
