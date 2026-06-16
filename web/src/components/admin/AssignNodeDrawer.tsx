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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      setError(t("admin.v2.assign_error", { message: err instanceof Error ? err.message : String(err) }));
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
            <Select
              value={employeeId || undefined}
              onValueChange={setEmployeeId}
              disabled={employees.length === 0 || employeeLocked}
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
            <span>{t("admin.assign_node")}</span>
            <Select
              value={nodeId || undefined}
              onValueChange={setNodeId}
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
                    {node.id}
                    {node.workspacePath ? ` / ${node.workspacePath}` : ""}
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
          <Button type="submit" disabled={isBusy || !canSubmit}>
            {isBusy ? t("admin.assigning") : t("admin.assign")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
