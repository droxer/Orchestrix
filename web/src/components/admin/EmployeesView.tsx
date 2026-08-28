"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ActionEdit,
  AdminDelete,
  AdminEmployees,
  ICON,
  ICON_STROKE_LARGE,
} from "../icons";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { SearchInput } from "@/components/ui/search-input";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import {
  buildEmployeeSummaries,
  employeeEmptyStateTranslationKey,
  isOverLocalComputerLimit,
  localComputerUsageLabel,
  employeeSummaryStatus,
  matchesEmployeeQuickFilter,
  type EmployeeQuickFilter,
} from "./helpers";
import { EmployeeCard } from "./EmployeeCard";
import { EmployeeComputers } from "./EmployeeComputers";
import { TonePill } from "../StatusPill";
import { AdminLayoutToggle, type AdminLayout } from "./AdminLayoutToggle";

interface EmployeesViewProps {
  employees: import("../../types").EmployeeRecord[];
  nodes: ControlPanelDaemonNodeRecord[];
  layout: AdminLayout;
  onLayoutChange: (next: AdminLayout) => void;
  onAddEmployee: () => void;
  onDeleteEmployee?: (employee: import("../../types").EmployeeRecord) => Promise<void>;
  onEditEmployee?: (employee: import("../../types").EmployeeRecord) => void;
  highlightedEmployeeId: string | null;
}

const FILTERS: EmployeeQuickFilter[] = ["all", "running", "ready", "idle", "failed", "unassigned"];

// Employee activity slices mirror the Nodes status chips (and the card status
// pill). running/ready/failed overlap by design — an employee can own one
// running and one failed node — so counts are per-predicate membership, like
// the Nodes view. "idle" is the quiet remainder: has nodes, but none are
// running, ready, or failed (e.g. provisioning/stopped), so a broken node
// surfaces under "failed" instead of hiding as idle.
function filterLabel(filter: EmployeeQuickFilter, t: TFunction): string {
  if (filter === "all") return t("admin.v2.filter_all");
  // "unassigned" here means the employee owns no computer — distinct from the
  // Nodes view, where it means a node has no employee. Use dedicated copy.
  if (filter === "unassigned") return t("admin.v2.emp_state_no_nodes");
  if (filter === "failed") return t("admin.v2.filter_failed");
  return t(`admin.v2.emp_state_${filter}`, { defaultValue: filter });
}

export function EmployeesView({
  employees,
  nodes,
  layout,
  onLayoutChange,
  onAddEmployee,
  onDeleteEmployee,
  onEditEmployee,
  highlightedEmployeeId,
}: EmployeesViewProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EmployeeQuickFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  async function handleDeleteEmployee(employeeId: string) {
    if (!onDeleteEmployee) return;
    const employee = employeesById.get(employeeId);
    if (!employee) return;
    const ok = await confirm({
      title: t("admin.v2.delete_employee_confirm", { name: employee.displayName ?? employee.id, id: employee.id }),
      message: t("admin.v2.delete_employee_message"),
      confirmLabel: t("admin.v2.delete_employee_action"),
      tone: "danger",
    });
    if (!ok) return;
    setPendingDelete(employeeId);
    setDeleteError(null);
    try {
      await onDeleteEmployee(employee);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingDelete(null);
    }
  }

  const summaries = useMemo(() => buildEmployeeSummaries(employees, nodes), [employees, nodes]);

  const counts = useMemo(() => {
    const result: Record<EmployeeQuickFilter, number> = { all: summaries.length, running: 0, ready: 0, idle: 0, failed: 0, unassigned: 0 };
    for (const member of summaries) {
      if (matchesEmployeeQuickFilter(member, "running")) result.running += 1;
      if (matchesEmployeeQuickFilter(member, "ready")) result.ready += 1;
      if (matchesEmployeeQuickFilter(member, "idle")) result.idle += 1;
      if (matchesEmployeeQuickFilter(member, "failed")) result.failed += 1;
      if (matchesEmployeeQuickFilter(member, "unassigned")) result.unassigned += 1;
    }
    return result;
  }, [summaries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((item) => {
      if (!matchesEmployeeQuickFilter(item, filter)) return false;
      if (!q) return true;
      // Computers are what the row shows, so they are what search matches —
      // both the display name and the node id, since either can be on screen.
      const haystack = [
        item.id,
        item.displayName,
        item.email ?? "",
        item.departmentName ?? "",
        ...item.nodes.map((node) => `${node.displayName ?? ""} ${node.id}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [summaries, query, filter]);

  if (summaries.length === 0) {
    return (
      <RelayEmptyState
        className="adm-employees-empty"
        fill
        title={t("admin.v2.empty_employees_title")}
        body={t("admin.v2.empty_employees_body")}
        illustration={<AdminEmployees size={ICON.hero} strokeWidth={ICON_STROKE_LARGE} aria-hidden="true" />}
        actions={(
          <Button type="button" onClick={onAddEmployee}>
            {t("admin.v2.add_employee_cta")}
          </Button>
        )}
      />
    );
  }

  return (
    <div className="adm-view">
      <div className="adm-view-controls">
        <div className="adm-fleet-filters" role="group" aria-label={t("admin.v2.filter_label")}>
          {FILTERS.map((id) => {
            const active = filter === id;
            return (
              <Button variant="ghost"
                key={id}
                type="button"
                className="adm-fleet-chip"
                data-active={active ? "true" : "false"}
                aria-pressed={active}
                onClick={() => setFilter(id)}
              >
                <span>{filterLabel(id, t)}</span>
                <span className="adm-fleet-chip-count tnum">{counts[id]}</span>
              </Button>
            );
          })}
        </div>
        <AdminLayoutToggle layout={layout} onChange={onLayoutChange} />
      </div>

      <SearchInput
        className="relay-search adm-search"
        inputClassName="adm-search-input"
        label={t("admin.v2.search_employees_placeholder")}
        name="admin-employees-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("admin.v2.search_employees_placeholder")}
      />

      {deleteError ? (
        <p className="adm-view-error" role="alert">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}

      {filtered.length === 0 ? (
        <RelayEmptyState
          className="adm-employees-empty"
          fill
          title={t(employeeEmptyStateTranslationKey(query, filter))}
        />
      ) : layout === "card" ? (
        <div className="adm-fleet-grid">
          {filtered.map((member) => (
            <EmployeeCard
              key={member.id}
              member={member}
              highlight={highlightedEmployeeId === member.id}
              onDelete={onDeleteEmployee ? (id) => void handleDeleteEmployee(id) : undefined}
              onEdit={onEditEmployee ? (id) => {
                const employee = employeesById.get(id);
                if (employee) onEditEmployee(employee);
              } : undefined}
              deletePending={pendingDelete !== null}
              t={t}
            />
          ))}
        </div>
      ) : (
        <div role="table" data-density="compact" aria-label={t("admin.v2.nav_employees", { defaultValue: "Employees" })}>
          <div className="adm-emp-cols" role="row">
            <span className="adm-col-label" role="columnheader">{t("admin.col_employee")}</span>
            <span className="adm-col-label" role="columnheader">{t("admin.v2.col_computers")}</span>
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_local_limit")}</span>
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_running")}</span>
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_ready")}</span>
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_actions")}</span>
          </div>
          <ul className="adm-emp-list" role="rowgroup">
            {filtered.map((member) => {
              const highlight = highlightedEmployeeId === member.id;
              const { tone, key } = employeeSummaryStatus(member);
              return (
                <li
                  key={member.id}
                  className={`adm-emp-row ${highlight ? "is-pulse" : ""}`}
                  data-employee={member.id}
                  role="row"
                >
                  <div className="adm-emp-id" role="cell">
                    <div className="adm-emp-id-line">
                      <p className="adm-emp-name" translate="no">{member.displayName}</p>
                      {/* Same rule as EmployeeCard: "ready" is the default
                          healthy state and goes unnamed. The list used to pill
                          it, so one employee read as Ready on this view and as
                          nothing at all on the card view. */}
                      {key !== "ready" ? (
                        <TonePill
                          tone={tone}
                          label={t(`admin.v2.emp_state_${key}`, { defaultValue: key })}
                          live={tone === "info"}
                        />
                      ) : null}
                    </div>
                    <p className="adm-emp-meta code">
                      <span translate="no">@{member.id}</span>
                      {member.email ? <span translate="no">{member.email}</span> : null}
                      {member.departmentName ? <span>{member.departmentName}</span> : null}
                    </p>
                  </div>
                  <div className="adm-emp-nodes" role="cell">
                    <EmployeeComputers nodes={member.nodes} t={t} />
                  </div>
                  <div className="adm-emp-metrics" role="cell">
                    <div className="adm-emp-metric">
                      <span className={`adm-emp-ratio tnum ${isOverLocalComputerLimit(member) ? "" : "ink-dim"}`}>
                        {localComputerUsageLabel(member)}
                      </span>
                      {isOverLocalComputerLimit(member) ? (
                        <TonePill
                          tone="bad"
                          label={t("admin.v2.emp_limit_over_short")}
                          title={t("admin.v2.emp_limit_over")}
                        />
                      ) : null}
                    </div>
                  </div>
                  {/* Two columns, not one cell carrying its own caps
                      sub-headers: those labels sat in the same micro-caps
                      register as the column header above them, so the table
                      appeared to have a second header row inside every row. */}
                  <div className="adm-emp-metrics" role="cell">
                    <div className="adm-emp-metric">
                      <span className={`adm-emp-running tnum ${member.runningCount > 0 ? "ink-strong" : "ink-dim"}`}>
                        {member.runningCount}
                      </span>
                    </div>
                  </div>
                  <div className="adm-emp-metrics" role="cell">
                    <div className="adm-emp-metric">
                      <span className="adm-emp-ratio tnum ink-dim">
                        {member.readyCount}/{member.nodeCount}
                      </span>
                    </div>
                  </div>
                  <div className="adm-emp-actions" role="cell">
                    {onEditEmployee ? (
                      <Button variant="icon"
                        size="icon-sm"
                        tinted
                        type="button"
                        className="adm-node-card-icon-btn"
                        onClick={() => {
                          const employee = employeesById.get(member.id);
                          if (employee) onEditEmployee(employee);
                        }}
                        aria-label={t("admin.v2.edit_employee_action")}
                        title={t("admin.v2.edit_employee_action")}
                      >
                        <ActionEdit size={ICON.sm} aria-hidden="true" />
                      </Button>
                    ) : null}
                    {onDeleteEmployee ? (
                      <Button variant="icon"
                        size="icon-sm"
                        tinted
                        type="button"
                        danger
                        className="adm-node-card-icon-btn"
                        onClick={() => void handleDeleteEmployee(member.id)}
                        disabled={pendingDelete !== null}
                        aria-label={t("admin.v2.delete_employee_action")}
                        title={t("admin.v2.delete_employee_action")}
                      >
                        <AdminDelete size={ICON.sm} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
