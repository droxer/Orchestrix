"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ActionAdd, ActionApprove, AdminInbox } from "../icons";
import { assignControlPanelDaemonNode, createControlPanelDaemonNode, createManagedNode } from "../../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  EmployeeRecord,
} from "../../types";
import type { AddNodeDrawerSuccess } from "./AddNodeDrawer";
import { Drawer } from "../ui/Drawer";
import { RunModeField, type RunLocation } from "./RunModeField";
import { initialsOf, statusTone, visualStatus } from "./helpers";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { NodePresence } from "./NodePresence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
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
  onCreateNodeSuccess: (outcome: AddNodeDrawerSuccess) => void;
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
  const employeeLabelId = useId();
  const [employeeId, setEmployeeId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [nodeLocation, setNodeLocation] = useState<RunLocation>("managed");
  const [displayName, setDisplayName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    employeeId?: string;
    nodeId?: string;
    workspacePath?: string;
  }>({});
  const [isBusy, setIsBusy] = useState(false);
  const employeeTriggerRef = useRef<HTMLButtonElement>(null);
  const nodeListRef = useRef<HTMLUListElement>(null);
  const workspacePathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId ?? "");
      setNodeId("");
      setCreateNew(false);
      setNodeLocation("managed");
      setDisplayName("");
      setWorkspacePath("");
      setError(null);
      setFieldErrors({});
      setIsBusy(false);
    }
  }, [open, defaultEmployeeId]);

  function clearFieldError(field: "employeeId" | "nodeId" | "workspacePath") {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  const employeeLocked = Boolean(defaultEmployeeId);
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );
  const hasNodes = unassignedNodes.length > 0;
  // With no unassigned nodes, creating one is the only path — force it.
  const creatingNode = createNew || !hasNodes;
  const isManaged = nodeLocation === "managed";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    const nextFieldErrors: typeof fieldErrors = {};
    if (!nextEmployeeId) nextFieldErrors.employeeId = t("admin.employee_required");
    if (!creatingNode && !nodeId) nextFieldErrors.nodeId = t("admin.node_required");
    if (creatingNode && !isManaged && !workspacePath.trim()) nextFieldErrors.workspacePath = t("admin.v2.workspace_path_required");
    setFieldErrors(nextFieldErrors);
    const firstInvalid = nextFieldErrors.employeeId
      ? employeeTriggerRef
      : nextFieldErrors.nodeId
        ? nodeListRef
        : nextFieldErrors.workspacePath
          ? workspacePathRef
          : null;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      if (creatingNode) {
        if (isManaged) {
          const result = await createManagedNode({
            employeeId: nextEmployeeId,
            displayName: displayName.trim() || undefined,
            sandboxMode: "boxlite",
          });
          onCreateNodeSuccess({ kind: "managed", result });
        } else {
          const result = await createControlPanelDaemonNode({
            employeeId: nextEmployeeId,
            displayName: displayName.trim() || undefined,
            workspacePath: workspacePath.trim(),
            sandboxMode: "boxlite",
            nodeLocation: "employee-device",
          });
          onCreateNodeSuccess({ kind: "manual", result });
        }
      } else {
        const result = await assignControlPanelDaemonNode({
          employeeId: nextEmployeeId,
          nodeId,
        });
        onAssignSuccess(result);
      }
    } catch (err) {
      setError(
        t(creatingNode ? "admin.v2.create_node_error" : "admin.v2.assign_error", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsBusy(false);
    }
  }

  const displayHandle = selectedEmployee
    ? `@${selectedEmployee.id}`
    : employeeId
      ? `@${employeeId.replace(/^@/, "")}`
      : "";
  const hasUnsavedChanges = createNew || Boolean(displayName || nodeId) || employeeId !== (defaultEmployeeId ?? "");
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  async function requestClose() {
    if (isBusy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      title={t("admin.v2.assign_title")}
      subtitle={t("admin.v2.assign_sub")}
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
                  {selectedEmployee.displayName &&
                  selectedEmployee.displayName !== selectedEmployee.id ? (
                    <span className="adm-assign-operator-name">
                      {selectedEmployee.displayName}
                    </span>
                  ) : null}
                  <span className="adm-assign-operator-handle code">
                    {displayHandle}
                  </span>
                </div>
            </div>
          </section>
        ) : (
          <section className="adm-assign-picker" aria-label={t("admin.employee")}>
            <Field
              label={t("admin.employee")}
              labelId={employeeLabelId}
              wrapper="div"
              error={fieldErrors.employeeId}
              errorId="assign-node-employee-error"
            >
              <Select
                value={employeeId || null}
                onValueChange={(value) => {
                  setEmployeeId(value ?? "");
                  clearFieldError("employeeId");
                }}
                disabled={employees.length === 0}
              >
                <SelectTrigger
                  ref={employeeTriggerRef}
                  data-modal-initial-focus
                  className="w-full code"
                  aria-labelledby={employeeLabelId}
                  aria-invalid={Boolean(fieldErrors.employeeId) || undefined}
                  aria-describedby={fieldErrors.employeeId ? "assign-node-employee-error" : undefined}
                >
                  <SelectValue
                    placeholder={
                      employees.length === 0
                        ? t("admin.no_employees")
                        : t("admin.select_employee")
                    }
                  >
                    {(value: string | null) => {
                      if (!value) {
                        return employees.length === 0
                          ? t("admin.no_employees")
                          : t("admin.select_employee");
                      }
                      const employee = employees.find((e) => e.id === value);
                      if (!employee) return `@${value}`;
                      return employee.displayName && employee.displayName !== employee.id
                        ? `${employee.displayName} / @${employee.id}`
                        : `@${employee.id}`;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.displayName && employee.displayName !== employee.id
                        ? `${employee.displayName} / `
                        : ""}
                      <span className="text-muted-foreground">@{employee.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </section>
        )}

        <section className="adm-assign-nodes" aria-label={t("admin.assign_node")}>
          <header className="adm-assign-nodes-head">
            <span className="adm-assign-section-eyebrow">
              {t("admin.assign_node")}
            </span>
            <span className="adm-assign-nodes-count tnum">
              {unassignedNodes.length}
            </span>
          </header>

          {hasNodes ? (
            <ul
              ref={nodeListRef}
              className="adm-assign-node-list"
              aria-label={t("admin.assign_node")}
              tabIndex={-1}
              aria-invalid={Boolean(fieldErrors.nodeId) || undefined}
              aria-describedby={fieldErrors.nodeId ? "assign-node-node-error" : undefined}
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
                        onChange={() => {
                          setNodeId(node.id);
                          setCreateNew(false);
                          clearFieldError("nodeId");
                        }}
                      />
                      <span className={`adm-assign-node ${isSelected ? "selected" : ""}`}>
                        <NodePresence node={node} t={t} withLabel />
                        <span className="adm-assign-node-body">
                          <span className="adm-assign-node-id code" translate="no">
                            {node.displayName || node.id}
                          </span>
                          {node.workspacePath ? (
                            <span className="adm-assign-node-path code" translate="no">
                              {node.workspacePath}
                            </span>
                          ) : (
                            <span className="adm-assign-node-path muted">
                              {t("admin.workspace_none")}
                            </span>
                          )}
                          <NodeProfileBadges
                            node={node}
                            storedTokens={{}}
                            colocated={false}
                            t={t}
                            compact
                          />
                        </span>
                        <span className={`adm-assign-node-status tone-${tone}`}>
                          {t(`status.${status}`, { defaultValue: status })}
                        </span>
                        <span
                          className="adm-assign-node-check"
                          aria-hidden="true"
                        >
                          {isSelected ? <ActionApprove size={14} /> : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              <li>
                <label className="adm-assign-node-choice">
                  <input
                    className="adm-assign-node-input"
                    type="radio"
                    name="assign-node-id"
                    value="__new__"
                    checked={createNew}
                    onChange={() => {
                      setCreateNew(true);
                      setNodeId("");
                      clearFieldError("nodeId");
                    }}
                  />
                  <span className={`adm-assign-node ${createNew ? "selected" : ""}`}>
                    <span className="adm-assign-node-dot tone-muted" aria-hidden="true" />
                    <span className="adm-assign-node-body">
                      <span className="adm-assign-node-id">
                        <ActionAdd size={12} aria-hidden="true" /> {t("admin.v2.assign_new_node_option")}
                      </span>
                      <span className="adm-assign-node-path muted">
                        {t("admin.v2.assign_new_node_hint")}
                      </span>
                    </span>
                    <span className="adm-assign-node-check" aria-hidden="true">
                      {createNew ? <ActionApprove size={14} /> : null}
                    </span>
                  </span>
                </label>
              </li>
            </ul>
          ) : (
            <div className="adm-assign-empty" role="status">
              <AdminInbox size={20} aria-hidden="true" />
              <div>
                <p className="adm-assign-empty-title">
                  {t("admin.no_unassigned_nodes")}
                </p>
                <p className="adm-assign-empty-body">
                  {t("admin.v2.assign_new_node_hint")}
                </p>
              </div>
            </div>
          )}
          {fieldErrors.nodeId ? (
            <span id="assign-node-node-error" className="text-sm text-danger" role="alert">
              {fieldErrors.nodeId}
            </span>
          ) : null}
        </section>

        {creatingNode ? (
          <fieldset className="adm-form-section">
            <legend className="adm-form-legend">{t("admin.v2.section_node")}</legend>
            <Field label={t("admin.v2.computer_name")}>
              <input
                name="assign-node-display-name"
                autoComplete="off"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t(isManaged ? "admin.v2.computer_name_placeholder_managed" : "admin.v2.computer_name_placeholder_local")}
                maxLength={64}
                disabled={isBusy}
              />
            </Field>
            <p className="adm-form-hint">{t("admin.v2.computer_name_hint")}</p>
            <RunModeField
              value={nodeLocation}
              onChange={(location) => {
                setNodeLocation(location);
                setError(null);
              }}
              name="assign-node-location"
              disabled={isBusy}
            />
            {!isManaged ? (
              <Field label={t("workspace_label")}>
                <input
                  ref={workspacePathRef}
                  name="assign-node-workspace-path"
                  autoComplete="off"
                  value={workspacePath}
                  onChange={(event) => {
                    setWorkspacePath(event.target.value);
                    clearFieldError("workspacePath");
                  }}
                  placeholder="/Users/alice/project"
                  disabled={isBusy}
                  aria-invalid={Boolean(fieldErrors.workspacePath) || undefined}
                  aria-describedby={fieldErrors.workspacePath ? "assign-node-workspace-path-error" : undefined}
                />
                {fieldErrors.workspacePath ? (
                  <span id="assign-node-workspace-path-error" className="text-sm text-danger" role="alert">
                    {fieldErrors.workspacePath}
                  </span>
                ) : null}
              </Field>
            ) : null}
            <p className="adm-form-hint">
              {t("admin.v2.node_help_managed")}
            </p>
          </fieldset>
        ) : null}

        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

        <div className="adm-form-actions">
          <Button size="cta"
            type="button"
            variant="ghost"
            onClick={() => void requestClose()}
            disabled={isBusy}
          >
            {t("admin.v2.cancel")}
          </Button>
          <Button size="cta" type="submit" loading={isBusy}>
            {isBusy
              ? creatingNode ? t("admin.creating") : t("admin.assigning")
              : creatingNode
                ? t(isManaged ? "admin.v2.provision_node" : "admin.v2.generate_node")
                : t("admin.assign_node")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
