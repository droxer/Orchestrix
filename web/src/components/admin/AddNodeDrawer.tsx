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
import { Drawer } from "../ui/Drawer";
import { ExecutionProfileField, type NodeLocation } from "./ExecutionProfileField";
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

  const [nodeLocation, setNodeLocation] = useState<NodeLocation>("managed");
  const [sandboxMode, setSandboxMode] = useState<"boxlite" | "none">("boxlite");
  const [workspacePath, setWorkspacePath] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isManaged = nodeLocation === "managed";
  const hasUnsavedChanges = Boolean(employeeId || workspacePath || nodeLocation !== "managed");
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) ?? null,
    [employees, employeeId],
  );

  useEffect(() => {
    if (!open) {
      setNodeLocation("managed");
      setSandboxMode("boxlite");
      setWorkspacePath("");
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
    if (!isManaged && !workspacePath.trim()) {
      setError(t("admin.v2.workspace_path_required"));
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
          workspacePath: workspacePath.trim(),
          sandboxMode,
          nodeLocation: "employee-device",
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
            value={nodeLocation}
            onChange={(location) => {
              setNodeLocation(location);
              if (location === "managed") setSandboxMode("boxlite");
              setError(null);
            }}
            name="add-node-location"
            disabled={isBusy}
          />
          {!isManaged ? (
            <>
              <label className="adm-field">
                <span>{t("admin.v2.runtime_isolation")}</span>
                <select value={sandboxMode} onChange={(event) => setSandboxMode(event.target.value as "boxlite" | "none")} disabled={isBusy}>
                  <option value="boxlite">{t("admin.v2.node_sandbox_boxlite")}</option>
                  <option value="none">{t("admin.v2.node_sandbox_host")}</option>
                </select>
              </label>
              <label className="adm-field">
                <span>{t("workspace_label")}</span>
                <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="/Users/alice/project" disabled={isBusy} />
              </label>
              <p className="adm-form-hint">{t("admin.v2.workspace_path_hint")}</p>
            </>
          ) : null}
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
          <Button size="cta" type="button" variant="ghost" onClick={() => void requestClose()} disabled={isBusy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button size="cta" type="submit" disabled={isBusy || (isManaged && !employeeId) || (!isManaged && !workspacePath.trim())}>
            {isBusy ? t("admin.creating") : t(isManaged ? "admin.v2.provision_node" : "admin.v2.generate_node")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
