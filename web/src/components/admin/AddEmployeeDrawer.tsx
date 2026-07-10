"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createControlPanelEmployee } from "../../api";
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
  const [isBusy, setIsBusy] = useState(false);
  const hasUnsavedChanges = Boolean(
    employeeId.trim()
    || displayName.trim()
    || email.trim()
    || username.trim()
    || password
    || selectedNodeId,
  );
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  useEffect(() => {
    if (!open) {
      setEmployeeId("");
      setDisplayName("");
      setEmail("");
      setUsername("");
      setPassword("");
      setSelectedNodeId("");
      setError(null);
      setIsBusy(false);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) return setError(t("admin.employee_required"));
    if (!username.trim()) return setError(t("admin.username_required"));
    if (!password) return setError(t("admin.password_required"));

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
      title={t("admin.v2.add_employee_title")}
      subtitle={t("admin.v2.add_employee_sub")}
      variant="light"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.add_employee_title")}
      bodyClassName="adm-drawer-body--column"
      width={420}
    >
      <form className="adm-form adm-form--streamlined" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="adm-field">
          <span>
            {t("admin.employee_id")}
            <span className="adm-field-req" aria-hidden="true">*</span>
          </span>
          <Input
            name="employee-id"
            className="mono"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("admin.v2.placeholder_employee_id")}
          />
        </label>

        <label className="adm-field">
          <span>{t("admin.display_name")}</span>
          <Input
            name="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            placeholder={t("admin.v2.placeholder_display_name")}
          />
        </label>

        <label className="adm-field">
          <span>{t("admin.email")}</span>
          <Input
            name="email"
            className="mono"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder={t("admin.v2.placeholder_email")}
          />
        </label>

        <label className="adm-field">
          <span>
            {t("admin.username")}
            <span className="adm-field-req" aria-hidden="true">*</span>
          </span>
          <Input
            name="username"
            className="mono"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            spellCheck={false}
            placeholder={t("admin.v2.placeholder_username")}
          />
        </label>

        <label className="adm-field">
          <span>
            {t("admin.password")}
            <span className="adm-field-req" aria-hidden="true">*</span>
          </span>
          <Input
            name="password"
            className="mono"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>

        <div className="adm-form-group">
          <p className="adm-form-group-label">{t("admin.v2.section_assignment")}</p>
          {unassignedNodes.length === 0 ? (
            <p className="adm-form-hint">{t("admin.unassigned_hint")}</p>
          ) : (
            <label className="adm-field">
              <span>{t("admin.assign_node")}</span>
              <Select
                value={selectedNodeId || undefined}
                onValueChange={setSelectedNodeId}
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
        </div>

        {error ? <div className="adm-form-error">{error}</div> : null}

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
