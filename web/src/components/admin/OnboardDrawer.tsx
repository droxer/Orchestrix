"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignControlPanelDaemonNode, createControlPanelDaemonNode, createControlPanelEmployee } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelDaemonNodeResponse,
  CreateControlPanelEmployeeResponse,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OnboardMode = "new" | "existing" | "local-node";

interface OnboardDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  unassignedNodes: ControlPanelDaemonNodeRecord[];
  onSuccess: (result: CreateControlPanelEmployeeResponse) => void;
  onAssignSuccess: (result: AssignControlPanelDaemonNodeResponse) => void;
  onCreateNodeSuccess: (result: CreateControlPanelDaemonNodeResponse) => void;
}

export function OnboardDrawer({
  open,
  onClose,
  employees,
  unassignedNodes,
  onSuccess,
  onAssignSuccess,
  onCreateNodeSuccess,
}: OnboardDrawerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<OnboardMode>("new");

  const [employeeId, setEmployeeId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [existingEmployeeId, setExistingEmployeeId] = useState("");
  const [existingNodeId, setExistingNodeId] = useState("");
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmployeeId("");
      setDisplayName("");
      setEmail("");
      setUsername("");
      setPassword("");
      setSelectedNodeId("");
      setExistingEmployeeId("");
      setExistingNodeId("");
      setLocalWorkspacePath("");
      setError(null);
      setIsBusy(false);
      setMode("new");
    }
  }, [open]);

  async function handleSubmitNew(event: FormEvent<HTMLFormElement>) {
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
      setError(t("admin.v2.onboard_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = existingEmployeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) return setError(t("admin.employee_required"));
    if (!existingNodeId) return setError(t("admin.node_required"));

    setIsBusy(true);
    setError(null);
    try {
      const result = await assignControlPanelDaemonNode({
        employeeId: nextEmployeeId,
        nodeId: existingNodeId,
      });
      onAssignSuccess(result);
    } catch (err) {
      setError(t("admin.v2.assign_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitLocalNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextWorkspacePath = localWorkspacePath.trim();

    setIsBusy(true);
    setError(null);
    try {
      const result = await createControlPanelDaemonNode({
        workspacePath: nextWorkspacePath,
      });
      onCreateNodeSuccess(result);
    } catch (err) {
      setError(t("admin.v2.create_node_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  const tabRefs = useRef<Record<OnboardMode, HTMLButtonElement | null>>({ new: null, existing: null, "local-node": null });

  function switchMode(next: OnboardMode) {
    setMode(next);
    setError(null);
  }

  // WAI-ARIA tabs keyboard support: Left/Right cycle, Home/End jump to ends.
  // The "existing" tab is skipped when disabled (no employees yet).
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order: OnboardMode[] = ["new", "existing", "local-node"];
    const enabled = order.filter((m) => m !== "existing" || employees.length > 0);
    if (enabled.length < 2) return;

    let next: OnboardMode | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = enabled[(enabled.indexOf(mode) + 1) % enabled.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = enabled[(enabled.indexOf(mode) - 1 + enabled.length) % enabled.length];
    } else if (event.key === "Home") {
      next = enabled[0];
    } else if (event.key === "End") {
      next = enabled[enabled.length - 1];
    }
    if (!next) return;

    event.preventDefault();
    switchMode(next);
    tabRefs.current[next]?.focus();
  }

  const canSubmitNew = Boolean(employeeId.trim() && username.trim() && password);
  const canSubmitExisting = Boolean(existingEmployeeId && existingNodeId);

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      title={t("admin.v2.onboard_title")}
      subtitle={t("admin.v2.onboard_sub")}
      variant="light"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.onboard_title")}
      bodyClassName="adm-drawer-body--column"
      kicker={t("admin.v2.onboard_kicker")}
    >
      <div className="adm-mode-tabs" role="tablist" aria-label={t("admin.v2.onboard_mode_label")}>
        <button
          type="button"
          role="tab"
          id="onboard-tab-new"
          aria-controls="onboard-panel-new"
          aria-selected={mode === "new"}
          tabIndex={mode === "new" ? 0 : -1}
          ref={(node) => { tabRefs.current.new = node; }}
          className={`adm-mode-tab ${mode === "new" ? "active" : ""}`}
          onClick={() => switchMode("new")}
          onKeyDown={handleTabKeyDown}
        >
          {t("admin.v2.mode_new")}
        </button>
        <button
          type="button"
          role="tab"
          id="onboard-tab-existing"
          aria-controls="onboard-panel-existing"
          aria-selected={mode === "existing"}
          tabIndex={mode === "existing" ? 0 : -1}
          ref={(node) => { tabRefs.current.existing = node; }}
          className={`adm-mode-tab ${mode === "existing" ? "active" : ""}`}
          onClick={() => switchMode("existing")}
          onKeyDown={handleTabKeyDown}
          disabled={employees.length === 0}
        >
          {t("admin.v2.mode_existing")}
        </button>
        <button
          type="button"
          role="tab"
          id="onboard-tab-local-node"
          aria-controls="onboard-panel-local-node"
          aria-selected={mode === "local-node"}
          tabIndex={mode === "local-node" ? 0 : -1}
          ref={(node) => { tabRefs.current["local-node"] = node; }}
          className={`adm-mode-tab ${mode === "local-node" ? "active" : ""}`}
          onClick={() => switchMode("local-node")}
          onKeyDown={handleTabKeyDown}
        >
          {t("admin.v2.mode_local_node")}
        </button>
      </div>

      {mode === "new" ? (
        <form
          className="adm-form"
          onSubmit={(event) => void handleSubmitNew(event)}
          noValidate
          role="tabpanel"
          id="onboard-panel-new"
          aria-labelledby="onboard-tab-new"
        >
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_identity")}</legend>
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
                placeholder={t("admin.v2.placeholder_email")}
              />
            </label>
          </fieldset>

          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_credentials")}</legend>
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
          </fieldset>

          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_assignment")}</legend>
            {unassignedNodes.length === 0 ? (
              <p className="adm-form-hint adm-form-hint--notice">{t("admin.unassigned_hint")}</p>
            ) : (
              <label className="adm-field">
                <span>
                  {t("admin.assign_node")}
                  <span className="adm-field-opt">{t("admin.v2.optional")}</span>
                </span>
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
          </fieldset>

          {error ? <div className="adm-form-error">{error}</div> : null}

          <div className="adm-form-actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </Button>
            <Button type="submit" disabled={isBusy || !canSubmitNew}>
              {isBusy ? t("admin.creating") : t("admin.v2.provision")}
            </Button>
          </div>
        </form>
      ) : mode === "existing" ? (
        <form
          className="adm-form"
          onSubmit={(event) => void handleSubmitExisting(event)}
          noValidate
          role="tabpanel"
          id="onboard-panel-existing"
          aria-labelledby="onboard-tab-existing"
        >
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.assign_existing_employee")}</legend>
            <label className="adm-field">
              <span>
                {t("admin.employee")}
                <span className="adm-field-req" aria-hidden="true">*</span>
              </span>
              <Select
                value={existingEmployeeId || undefined}
                onValueChange={setExistingEmployeeId}
                disabled={employees.length === 0}
              >
                <SelectTrigger className="w-full mono">
                  <SelectValue
                    placeholder={employees.length === 0 ? t("admin.no_employees") : t("admin.select_employee")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      @{employee.id}
                      {employee.displayName && employee.displayName !== employee.id
                        ? ` / ${employee.displayName}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="adm-field">
              <span>
                {t("admin.assign_node")}
                <span className="adm-field-req" aria-hidden="true">*</span>
              </span>
              <Select
                value={existingNodeId || undefined}
                onValueChange={setExistingNodeId}
                disabled={unassignedNodes.length === 0}
              >
                <SelectTrigger className="w-full mono">
                  <SelectValue
                    placeholder={unassignedNodes.length === 0 ? t("admin.no_unassigned_nodes") : t("admin.select_node")}
                  />
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
            {unassignedNodes.length === 0 ? (
              <p className="adm-form-hint">{t("admin.unassigned_hint")}</p>
            ) : null}
          </fieldset>

          {error ? <div className="adm-form-error">{error}</div> : null}

          <div className="adm-form-actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </Button>
            <Button type="submit" disabled={isBusy || !canSubmitExisting}>
              {isBusy ? t("admin.assigning") : t("admin.assign")}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="adm-form"
          onSubmit={(event) => void handleSubmitLocalNode(event)}
          noValidate
          role="tabpanel"
          id="onboard-panel-local-node"
          aria-labelledby="onboard-tab-local-node"
        >
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_local_node")}</legend>
            <p className="adm-form-hint">{t("admin.v2.local_node_help")}</p>
            <label className="adm-field">
              <span>
                {t("admin.workspace_path")}
                <span className="adm-field-opt">{t("admin.v2.optional")}</span>
              </span>
              <Input
                name="local-node-workspace"
                className="mono"
                value={localWorkspacePath}
                onChange={(event) => setLocalWorkspacePath(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("admin.v2.placeholder_workspace_path")}
              />
            </label>
          </fieldset>

          {error ? <div className="adm-form-error">{error}</div> : null}

          <div className="adm-form-actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </Button>
            <Button type="submit" disabled={isBusy}>
              {isBusy ? t("admin.creating") : t("admin.v2.generate_node")}
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
