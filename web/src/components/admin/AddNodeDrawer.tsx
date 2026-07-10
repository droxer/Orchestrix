"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createControlPanelDaemonNode } from "../../api";
import type {
  CreateControlPanelDaemonNodeResponse,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";
import { ExecutionProfileField, type DaemonSandboxMode } from "./ExecutionProfileField";
import { Button } from "@/components/ui/button";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AddNodeDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  onSuccess: (result: CreateControlPanelDaemonNodeResponse) => void;
}

export function AddNodeDrawer({
  open,
  onClose,
  employees,
  onSuccess,
}: AddNodeDrawerProps) {
  const { t } = useTranslation();

  const [sandboxMode, setSandboxMode] = useState<DaemonSandboxMode>("boxlite");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const hasUnsavedChanges = Boolean(employeeId);
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  useEffect(() => {
    if (!open) {
      setSandboxMode("boxlite");
      setEmployeeId("");
      setError(null);
      setIsBusy(false);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsBusy(true);
    setError(null);
    try {
      const result = await createControlPanelDaemonNode({
        employeeId: employeeId || undefined,
        sandboxMode,
      });
      onSuccess(result);
    } catch (err) {
      setError(t("admin.v2.create_node_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  async function requestClose() {
    if (isBusy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      title={t("admin.v2.add_node_title")}
      subtitle={t("admin.v2.add_node_sub")}
      variant="light"
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.add_node_title")}
      bodyClassName="adm-drawer-body--column"
      width={420}
    >
      <form className="adm-form adm-form--streamlined" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="adm-form-group">
          <p className="adm-form-group-label">{t("admin.v2.section_execution_profile")}</p>
          <ExecutionProfileField
            value={sandboxMode}
            onChange={setSandboxMode}
            name="add-node-sandbox-mode"
            disabled={isBusy}
          />
        </div>

        <div className="adm-form-group">
          <p className="adm-form-group-label">{t("admin.v2.section_assignment")}</p>
          <label className="adm-field">
            <span>{t("admin.employee")}</span>
            <Select
              value={employeeId || undefined}
              onValueChange={setEmployeeId}
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
        </div>

        {error ? <div className="adm-form-error">{error}</div> : null}

        <div className="adm-form-actions">
          <Button type="button" variant="ghost" onClick={() => void requestClose()} disabled={isBusy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button type="submit" disabled={isBusy}>
            {isBusy ? t("admin.creating") : t("admin.v2.generate_node")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
