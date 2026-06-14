"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignControlPanelDaemonNode, createControlPanelEmployee } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelEmployeeResponse,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";

type OnboardMode = "new" | "existing";

interface OnboardDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  unassignedNodes: ControlPanelDaemonNodeRecord[];
  onSuccess: (result: CreateControlPanelEmployeeResponse) => void;
  onAssignSuccess: (result: AssignControlPanelDaemonNodeResponse) => void;
}

export function OnboardDrawer({
  open,
  onClose,
  employees,
  unassignedNodes,
  onSuccess,
  onAssignSuccess,
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
    if (!selectedNodeId) return setError(t("admin.node_required"));

    setIsBusy(true);
    setError(null);
    try {
      const result = await createControlPanelEmployee({
        employeeId: nextEmployeeId,
        username: username.trim(),
        password,
        nodeId: selectedNodeId,
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
      });
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  function switchMode(next: OnboardMode) {
    setMode(next);
    setError(null);
  }

  const canSubmitNew = Boolean(employeeId.trim() && username.trim() && password && selectedNodeId);
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
    >
      <div className="adm-mode-tabs" role="tablist" aria-label={t("admin.v2.onboard_mode_label")}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "new"}
          className={`adm-mode-tab ${mode === "new" ? "active" : ""}`}
          onClick={() => switchMode("new")}
        >
          {t("admin.v2.mode_new")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "existing"}
          className={`adm-mode-tab ${mode === "existing" ? "active" : ""}`}
          onClick={() => switchMode("existing")}
          disabled={employees.length === 0}
        >
          {t("admin.v2.mode_existing")}
        </button>
      </div>

      {mode === "new" ? (
        <form className="adm-form" onSubmit={(event) => void handleSubmitNew(event)} noValidate>
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_identity")}</legend>
            <label className="adm-field">
              <span>{t("admin.employee_id")}</span>
              <input
                className="adm-input mono"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                autoComplete="off"
                placeholder="alice"
                autoFocus
              />
            </label>
            <label className="adm-field">
              <span>{t("admin.display_name")}</span>
              <input
                className="adm-input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="off"
                placeholder="Alice"
              />
            </label>
            <label className="adm-field">
              <span>{t("admin.email")}</span>
              <input
                className="adm-input mono"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="alice@example.com"
              />
            </label>
          </fieldset>

          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_credentials")}</legend>
            <label className="adm-field">
              <span>{t("admin.username")}</span>
              <input
                className="adm-input mono"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="alice"
              />
            </label>
            <label className="adm-field">
              <span>{t("admin.password")}</span>
              <input
                className="adm-input mono"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          </fieldset>

          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_assignment")}</legend>
            <label className="adm-field">
              <span>{t("admin.assign_node")}</span>
              <select
                className="adm-input mono"
                value={selectedNodeId}
                onChange={(event) => setSelectedNodeId(event.target.value)}
                disabled={unassignedNodes.length === 0}
              >
                <option value="">
                  {unassignedNodes.length === 0 ? t("admin.no_unassigned_nodes") : t("admin.select_node")}
                </option>
                {unassignedNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.id}{node.workspacePath ? ` / ${node.workspacePath}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {unassignedNodes.length === 0 ? (
              <p className="adm-form-hint">{t("admin.unassigned_hint")}</p>
            ) : null}
          </fieldset>

          {error ? <div className="adm-form-error">{error}</div> : null}

          <div className="adm-form-actions">
            <button type="button" className="adm-button-ghost" onClick={onClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </button>
            <button type="submit" className="adm-button-primary" disabled={isBusy || !canSubmitNew}>
              {isBusy ? t("admin.creating") : t("admin.v2.provision")}
            </button>
          </div>
        </form>
      ) : (
        <form className="adm-form" onSubmit={(event) => void handleSubmitExisting(event)} noValidate>
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.assign_existing_employee")}</legend>
            <label className="adm-field">
              <span>{t("admin.employee")}</span>
              <select
                className="adm-input mono"
                value={existingEmployeeId}
                onChange={(event) => setExistingEmployeeId(event.target.value)}
                disabled={employees.length === 0}
                autoFocus
              >
                <option value="">
                  {employees.length === 0 ? t("admin.no_employees") : t("admin.select_employee")}
                </option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    @{employee.id}
                    {employee.displayName && employee.displayName !== employee.id
                      ? ` / ${employee.displayName}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-field">
              <span>{t("admin.assign_node")}</span>
              <select
                className="adm-input mono"
                value={existingNodeId}
                onChange={(event) => setExistingNodeId(event.target.value)}
                disabled={unassignedNodes.length === 0}
              >
                <option value="">
                  {unassignedNodes.length === 0 ? t("admin.no_unassigned_nodes") : t("admin.select_node")}
                </option>
                {unassignedNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.id}{node.workspacePath ? ` / ${node.workspacePath}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {unassignedNodes.length === 0 ? (
              <p className="adm-form-hint">{t("admin.unassigned_hint")}</p>
            ) : null}
          </fieldset>

          {error ? <div className="adm-form-error">{error}</div> : null}

          <div className="adm-form-actions">
            <button type="button" className="adm-button-ghost" onClick={onClose} disabled={isBusy}>
              {t("admin.v2.cancel")}
            </button>
            <button type="submit" className="adm-button-primary" disabled={isBusy || !canSubmitExisting}>
              {isBusy ? t("admin.assigning") : t("admin.assign")}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
