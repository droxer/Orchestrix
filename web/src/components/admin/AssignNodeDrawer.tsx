"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assignControlPanelDaemonNode } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";

interface AssignNodeDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  unassignedNodes: ControlPanelDaemonNodeRecord[];
  defaultEmployeeId?: string;
  onAssignSuccess: (result: AssignControlPanelDaemonNodeResponse) => void;
}

export function AssignNodeDrawer({
  open,
  onClose,
  employees,
  unassignedNodes,
  defaultEmployeeId,
  onAssignSuccess,
}: AssignNodeDrawerProps) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId ?? "");
      setNodeId("");
      setError(null);
      setIsBusy(false);
    }
  }, [open, defaultEmployeeId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) return setError(t("admin.employee_required"));
    if (!nodeId) return setError(t("admin.node_required"));

    setIsBusy(true);
    setError(null);
    try {
      const result = await assignControlPanelDaemonNode({
        employeeId: nextEmployeeId,
        nodeId,
      });
      onAssignSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  const canSubmit = Boolean(employeeId && nodeId);
  const employeeLocked = Boolean(defaultEmployeeId);

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      title={t("admin.v2.assign_title")}
      subtitle={t("admin.v2.assign_sub")}
      variant="light"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.assign_title")}
    >
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <fieldset className="adm-form-section">
          <legend className="adm-form-legend">{t("admin.assign_existing_employee")}</legend>
          <label className="adm-field">
            <span>{t("admin.employee")}</span>
            <select
              className="adm-input mono"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              disabled={employees.length === 0 || employeeLocked}
              autoFocus={!employeeLocked}
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
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
              disabled={unassignedNodes.length === 0}
              autoFocus={employeeLocked && unassignedNodes.length > 0}
            >
              <option value="">
                {unassignedNodes.length === 0 ? t("admin.no_unassigned_nodes") : t("admin.select_node")}
              </option>
              {unassignedNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.id}
                  {node.workspacePath ? ` / ${node.workspacePath}` : ""}
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
          <button type="submit" className="adm-button-primary" disabled={isBusy || !canSubmit}>
            {isBusy ? t("admin.assigning") : t("admin.assign")}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
