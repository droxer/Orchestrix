"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Inbox } from "lucide-react";
import { assignControlPanelDaemonNode, createControlPanelDaemonNode } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelDaemonNodeResponse,
  EmployeeRecord,
} from "../../types";
import { Drawer } from "./Drawer";
import { statusTone, visualStatus } from "./helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onCreateNodeSuccess: (result: CreateControlPanelDaemonNodeResponse) => void;
}

function initialsOf(value: string): string {
  const trimmed = value.replace(/^@/, "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AssignNodeDrawer({
  open,
  onClose,
  employees,
  unassignedNodes,
  defaultEmployeeId,
  onAssignSuccess,
  onCreateNodeSuccess,
}: AssignNodeDrawerProps) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId ?? "");
      setNodeId("");
      setLocalWorkspacePath("");
      setError(null);
      setIsBusy(false);
    }
  }, [open, defaultEmployeeId]);

  const employeeLocked = Boolean(defaultEmployeeId);
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );
  const hasNodes = unassignedNodes.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    const nextWorkspacePath = localWorkspacePath.trim();
    if (!nextEmployeeId) return setError(t("admin.employee_required"));
    if (hasNodes && !nodeId) return setError(t("admin.node_required"));

    setIsBusy(true);
    setError(null);
    try {
      if (hasNodes) {
        const result = await assignControlPanelDaemonNode({
          employeeId: nextEmployeeId,
          nodeId,
        });
        onAssignSuccess(result);
      } else {
        const result = await createControlPanelDaemonNode({
          employeeId: nextEmployeeId,
          workspacePath: nextWorkspacePath,
        });
        onCreateNodeSuccess(result);
      }
    } catch (err) {
      setError(
        t(hasNodes ? "admin.v2.assign_error" : "admin.v2.create_node_error", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsBusy(false);
    }
  }

  const canSubmit = hasNodes
    ? Boolean(employeeId && nodeId)
    : Boolean(employeeId.trim());
  const displayHandle = selectedEmployee
    ? `@${selectedEmployee.id}`
    : employeeId
      ? `@${employeeId.replace(/^@/, "")}`
      : "";

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      title={t("admin.v2.assign_title")}
      subtitle={t("admin.v2.assign_sub")}
      variant="light"
      width={520}
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.assign_title")}
      bodyClassName="adm-drawer-body--column"
    >
      <form
        className="adm-form adm-assign-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        {employeeLocked && selectedEmployee ? (
          <section className="adm-assign-operator" aria-label={t("admin.employee")}>
            <span className="adm-assign-operator-eyebrow">
              {t("admin.employee")}
            </span>
            <div className="adm-assign-operator-card">
              <span className="adm-assign-avatar" aria-hidden="true">
                {initialsOf(selectedEmployee.id)}
              </span>
              <div className="adm-assign-operator-text">
                <span className="adm-assign-operator-handle mono">
                  {displayHandle}
                </span>
                {selectedEmployee.displayName &&
                selectedEmployee.displayName !== selectedEmployee.id ? (
                  <span className="adm-assign-operator-name">
                    {selectedEmployee.displayName}
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="adm-assign-picker" aria-label={t("admin.employee")}>
            <label className="adm-field">
              <span>{t("admin.employee")}</span>
              <Select
                value={employeeId || undefined}
                onValueChange={setEmployeeId}
                disabled={employees.length === 0}
              >
                <SelectTrigger className="w-full mono">
                  <SelectValue
                    placeholder={
                      employees.length === 0
                        ? t("admin.no_employees")
                        : t("admin.select_employee")
                    }
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
          </section>
        )}

        <section className="adm-assign-nodes" aria-label={t("admin.assign_node")}>
          <header className="adm-assign-nodes-head">
            <span className="adm-assign-section-eyebrow">
              {t("admin.assign_node")}
            </span>
            <span className="adm-assign-nodes-count mono">
              {unassignedNodes.length}
            </span>
          </header>

          {hasNodes ? (
            <ul
              className="adm-assign-node-list"
              role="radiogroup"
              aria-label={t("admin.assign_node")}
            >
              {unassignedNodes.map((node) => {
                const status = visualStatus(node);
                const tone = statusTone(status);
                const isSelected = node.id === nodeId;
                return (
                  <li key={node.id}>
                    <label className="adm-assign-node-choice">
                      <input
                        className="adm-assign-node-input"
                        type="radio"
                        name="assign-node-id"
                        value={node.id}
                        checked={isSelected}
                        onChange={() => setNodeId(node.id)}
                      />
                      <span className={`adm-assign-node ${isSelected ? "selected" : ""}`}>
                        <span
                          className={`adm-assign-node-dot tone-${tone}`}
                          aria-hidden="true"
                        />
                        <span className="adm-assign-node-body">
                          <span className="adm-assign-node-id mono">{node.id}</span>
                          {node.workspacePath ? (
                            <span className="adm-assign-node-path mono">
                              {node.workspacePath}
                            </span>
                          ) : (
                            <span className="adm-assign-node-path muted">
                              {t("admin.workspace_none")}
                            </span>
                          )}
                        </span>
                        <span className={`adm-assign-node-status tone-${tone}`}>
                          {t(`status.${status}`, { defaultValue: status })}
                        </span>
                        <span
                          className="adm-assign-node-check"
                          aria-hidden="true"
                        >
                          {isSelected ? <Check size={14} /> : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="adm-assign-empty" role="status">
              <Inbox size={20} aria-hidden="true" />
              <div>
                <p className="adm-assign-empty-title">
                  {t("admin.no_unassigned_nodes")}
                </p>
                <p className="adm-assign-empty-body">
                  {t("admin.v2.local_node_help")}
                </p>
              </div>
            </div>
          )}
        </section>

        {!hasNodes ? (
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_local_node")}</legend>
            <label className="adm-field">
              <span>
                {t("admin.workspace_path")}
                <span className="adm-field-opt">{t("admin.v2.optional")}</span>
              </span>
              <Input
                name="assign-local-node-workspace"
                className="mono"
                value={localWorkspacePath}
                onChange={(event) => setLocalWorkspacePath(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("admin.v2.placeholder_workspace_path")}
              />
            </label>
          </fieldset>
        ) : null}

        {error ? <div className="adm-form-error">{error}</div> : null}

        <div className="adm-form-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isBusy}
          >
            {t("admin.v2.cancel")}
          </Button>
          <Button type="submit" disabled={isBusy || !canSubmit}>
            {isBusy
              ? hasNodes ? t("admin.assigning") : t("admin.creating")
              : hasNodes
                ? t("admin.assign")
                : t("admin.v2.generate_node")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
