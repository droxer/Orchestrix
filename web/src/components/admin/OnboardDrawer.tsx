"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignControlPanelDaemonNode, createControlPanelEmployee } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelEmployeeResponse,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";

interface OnboardDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  unassignedNodes: ControlPanelDaemonNodeRecord[];
  onSuccess: (result: CreateControlPanelEmployeeResponse) => void;
  onAssignSuccess: (result: AssignControlPanelDaemonNodeResponse) => void;
}

export function OnboardDrawer({ open, onClose, employees, unassignedNodes, onSuccess, onAssignSuccess }: OnboardDrawerProps) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [existingEmployeeId, setExistingEmployeeId] = useState("");
  const [existingNodeId, setExistingNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  function reset() {
    setEmployeeId("");
    setDisplayName("");
    setEmail("");
    setUsername("");
    setPassword("");
    setSelectedNodeId("");
    setExistingEmployeeId("");
    setExistingNodeId("");
    setError(null);
    setAssignError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) return setError(t("admin.employee_required"));
    if (!username.trim()) return setError(t("admin.username_required"));
    if (!password) return setError(t("admin.password_required"));
    if (!selectedNodeId) return setError(t("admin.node_required"));

    setIsCreating(true);
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
      reset();
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleAssignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = existingEmployeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) return setAssignError(t("admin.employee_required"));
    if (!existingNodeId) return setAssignError(t("admin.node_required"));

    setIsAssigning(true);
    setAssignError(null);
    try {
      const result = await assignControlPanelDaemonNode({
        employeeId: nextEmployeeId,
        nodeId: existingNodeId,
      });
      reset();
      onAssignSuccess(result);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAssigning(false);
    }
  }

  const canSubmit = employeeId.trim() && username.trim() && password && selectedNodeId;
  const canAssign = existingEmployeeId && existingNodeId;

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!isCreating && !isAssigning) onClose();
      }}
      title={t("admin.v2.onboard_title")}
      subtitle={t("admin.v2.onboard_sub")}
      variant="light"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.onboard_title")}
    >
      <form className="adm-form" onSubmit={(event) => void handleAssignSubmit(event)} noValidate>
        <fieldset className="adm-form-section">
          <legend className="adm-form-legend">{t("admin.assign_existing_employee")}</legend>
          <label className="adm-field">
            <span>{t("admin.employee")}</span>
            <select
              className="adm-input mono"
              value={existingEmployeeId}
              onChange={(event) => setExistingEmployeeId(event.target.value)}
              disabled={employees.length === 0}
            >
              <option value="">{employees.length === 0 ? t("admin.no_employees") : t("admin.select_employee")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  @{employee.id}{employee.displayName && employee.displayName !== employee.id ? ` / ${employee.displayName}` : ""}
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
          {employees.length === 0 ? <p className="adm-form-hint">{t("admin.no_employees")}</p> : null}
          {unassignedNodes.length === 0 ? <p className="adm-form-hint">{t("admin.unassigned_hint")}</p> : null}
        </fieldset>

        {assignError ? <div className="adm-form-error">{assignError}</div> : null}

        <div className="adm-form-actions">
          <button type="submit" className="adm-button-primary" disabled={isAssigning || !canAssign}>
            {isAssigning ? t("admin.assigning") : t("admin.assign")}
          </button>
        </div>
      </form>

      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
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
          <button
            type="button"
            className="adm-button-ghost"
            onClick={onClose}
            disabled={isCreating}
          >
            {t("admin.v2.cancel")}
          </button>
          <button type="submit" className="adm-button-primary" disabled={isCreating || !canSubmit}>
            {isCreating ? t("admin.creating") : t("admin.v2.provision")}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
