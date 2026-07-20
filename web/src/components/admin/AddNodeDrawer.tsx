"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createControlPanelDaemonNode, createManagedNode } from "../../api";
import { initialsOf } from "../../lib/adminHelpers";
import type {
  CreateControlPanelDaemonNodeResponse,
  CreateManagedNodeResponse,
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

export type AddNodeDrawerSuccess =
  | { kind: "managed"; result: CreateManagedNodeResponse }
  | { kind: "manual"; result: CreateControlPanelDaemonNodeResponse };

interface AddNodeDrawerProps {
  open: boolean;
  onClose: () => void;
  employees: EmployeeRecord[];
  onSuccess: (outcome: AddNodeDrawerSuccess) => void;
}

export function AddNodeDrawer({
  open,
  onClose,
  employees,
  onSuccess,
}: AddNodeDrawerProps) {
  const { t } = useTranslation();
  const profileHeadingId = useId();
  const assignmentHeadingId = useId();
  const employeeLabelId = useId();

  const [sandboxMode, setSandboxMode] = useState<DaemonSandboxMode>("boxlite");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isManaged = sandboxMode === "boxlite";
  const hasUnsavedChanges = Boolean(employeeId);
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) ?? null,
    [employees, employeeId],
  );

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

    if (isManaged && !employeeId) {
      setError(t("admin.employee_required"));
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      if (isManaged) {
        const result = await createManagedNode({
          employeeId,
          sandboxMode: "boxlite",
        });
        onSuccess({ kind: "managed", result });
      } else {
        const result = await createControlPanelDaemonNode({
          employeeId: employeeId || undefined,
          sandboxMode: "none",
        });
        onSuccess({ kind: "manual", result });
      }
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
      kicker={t("admin.v2.provision_kicker_node")}
      title={t("admin.v2.add_node_title")}
      subtitle={t(isManaged ? "admin.v2.add_node_sub_managed" : "admin.v2.add_node_sub_local")}
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.add_node_title")}
      bodyClassName="adm-drawer-body--column"
      width={460}
    >
      <form className="adm-form adm-provision-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <section className="adm-provision-section" aria-labelledby={profileHeadingId}>
          <header className="adm-provision-section-head">
            <h3 id={profileHeadingId} className="adm-provision-section-title">
              {t("admin.v2.section_execution_profile")}
            </h3>
          </header>
          <ExecutionProfileField
            value={sandboxMode}
            onChange={(mode) => {
              setSandboxMode(mode);
              setError(null);
            }}
            name="add-node-sandbox-mode"
            disabled={isBusy}
          />
          <aside
            className={`adm-provision-outcome ${isManaged ? "is-managed" : "is-local"}`}
            aria-live="polite"
          >
            <span className="adm-provision-outcome-label">
              {t(isManaged ? "admin.v2.node_ownership_managed" : "admin.v2.node_ownership_local")}
            </span>
            <p className="adm-provision-outcome-body">
              {t(isManaged ? "admin.v2.add_node_outcome_managed" : "admin.v2.add_node_outcome_local")}
            </p>
          </aside>
        </section>

        <section className="adm-provision-section" aria-labelledby={assignmentHeadingId}>
          <header className="adm-provision-section-head">
            <h3 id={assignmentHeadingId} className="adm-provision-section-title">
              {t("admin.v2.section_assignment")}
            </h3>
            <span className="adm-provision-section-meta">
              {t(isManaged ? "admin.v2.required" : "admin.v2.optional")}
            </span>
          </header>

          {selectedEmployee ? (
            <div className="adm-assign-operator-card">
              <span className="sr-only">{t("admin.v2.selected_employee")}</span>
              <span className="adm-assign-avatar">
                {initialsOf(selectedEmployee.id)}
              </span>
              <div className="adm-assign-operator-text">
                <span className="adm-assign-operator-handle mono">
                  @{selectedEmployee.id}
                </span>
                {selectedEmployee.displayName &&
                selectedEmployee.displayName !== selectedEmployee.id ? (
                  <span className="adm-assign-operator-name">
                    {selectedEmployee.displayName}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="adm-field">
            <span id={employeeLabelId}>{t("admin.employee")}</span>
            <Select
              value={employeeId || undefined}
              onValueChange={(value) => setEmployeeId(value ?? "")}
              disabled={employees.length === 0}
            >
              <SelectTrigger className="w-full mono" aria-labelledby={employeeLabelId}>
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
          </div>

          {!selectedEmployee ? (
            <p className="adm-form-hint">
              {t(isManaged ? "admin.employee_required" : "admin.v2.add_node_assign_later")}
            </p>
          ) : null}
        </section>

        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

        <div className="adm-form-actions">
          <Button type="button" variant="ghost" onClick={() => void requestClose()} disabled={isBusy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button type="submit" disabled={isBusy || (isManaged && !employeeId)}>
            {isBusy ? t("admin.creating") : t(isManaged ? "admin.v2.provision_node" : "admin.v2.generate_node")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
