"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ActionSearch, AdminDelete, AdminEmployees, ICON_STROKE_LARGE } from "../icons";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { AgentMark } from "../AgentMark";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { listControlPanelAgents } from "../../api";
import { ADMIN_AGENTS_KEY } from "../../lib/adminHelpers";
import { useUrlSearchState } from "../../hooks/useUrlSearchState";
import {
  buildEmployeeSummaries,
  agentAvailabilityTone,
  type EmployeeNodeSummary,
} from "./helpers";
import { EmployeeCard } from "./EmployeeCard";
import { AdminLayoutToggle, type AdminLayout } from "./AdminLayoutToggle";

interface EmployeesViewProps {
  employees: import("../../types").EmployeeRecord[];
  nodes: ControlPanelDaemonNodeRecord[];
  layout: AdminLayout;
  onLayoutChange: (next: AdminLayout) => void;
  onAddEmployee: () => void;
  onDeleteEmployee?: (employee: import("../../types").EmployeeRecord) => Promise<void>;
  highlightedEmployeeId: string | null;
  onSelectAgent?: (agentId: string) => void;
}

type EmployeeFilter = "all" | "running" | "ready" | "idle" | "unassigned";

const FILTERS: EmployeeFilter[] = ["all", "running", "ready", "idle", "unassigned"];

function parseEmployeeFilter(value: string | null): EmployeeFilter {
  return FILTERS.includes(value as EmployeeFilter) ? (value as EmployeeFilter) : "all";
}

function serializeEmployeeFilter(value: EmployeeFilter): string | null {
  return value === "all" ? null : value;
}

// Employee activity slices mirror the Nodes status chips (and the card status
// pill). running/ready overlap by design — an employee can own one running and
// one ready node — so counts are per-predicate membership, like the Fleet view.
function matchesEmployeeFilter(member: EmployeeNodeSummary, filter: EmployeeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return member.runningCount > 0;
  if (filter === "ready") return member.readyCount > 0;
  if (filter === "idle") return member.nodeCount > 0 && member.runningCount === 0 && member.readyCount === 0;
  return member.nodeCount === 0;
}

function filterLabel(filter: EmployeeFilter, t: TFunction): string {
  if (filter === "all") return t("admin.v2.filter_all");
  if (filter === "unassigned") return t("admin.unassigned");
  return t(`admin.v2.emp_state_${filter}`, { defaultValue: filter });
}

export function EmployeesView({
  employees,
  nodes,
  layout,
  onLayoutChange,
  onAddEmployee,
  onDeleteEmployee,
  highlightedEmployeeId,
  onSelectAgent,
}: EmployeesViewProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useUrlSearchState<EmployeeFilter>(
    "empFilter",
    "all",
    parseEmployeeFilter,
    serializeEmployeeFilter,
  );
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const agentsQuery = useQuery({
    queryKey: ADMIN_AGENTS_KEY,
    queryFn: ({ signal }) => listControlPanelAgents(undefined, signal),
  });
  const agents = agentsQuery.data?.agents ?? [];

  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  async function handleDeleteEmployee(employeeId: string) {
    if (!onDeleteEmployee) return;
    const employee = employeesById.get(employeeId);
    if (!employee) return;
    const ok = await confirm({
      title: t("admin.v2.delete_employee_confirm", { name: employee.displayName ?? employee.id, id: employee.id }),
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
    const result: Record<EmployeeFilter, number> = { all: summaries.length, running: 0, ready: 0, idle: 0, unassigned: 0 };
    for (const member of summaries) {
      if (matchesEmployeeFilter(member, "running")) result.running += 1;
      if (matchesEmployeeFilter(member, "ready")) result.ready += 1;
      if (matchesEmployeeFilter(member, "idle")) result.idle += 1;
      if (matchesEmployeeFilter(member, "unassigned")) result.unassigned += 1;
    }
    return result;
  }, [summaries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((item) => {
      if (!matchesEmployeeFilter(item, filter)) return false;
      if (!q) return true;
      const haystack = [
        item.id,
        item.displayName,
        item.email ?? "",
        item.departmentName ?? "",
        ...agents.filter((agent) => agent.employeeId === item.id).map((agent) => `${agent.displayName} ${agent.executorKind}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [agents, summaries, query, filter]);

  if (summaries.length === 0) {
    return (
      <RelayEmptyState
        className="adm-employees-empty"
        fill
        title={t("admin.v2.empty_employees_title")}
        body={t("admin.v2.empty_employees_body")}
        illustration={<AdminEmployees size={40} strokeWidth={ICON_STROKE_LARGE} aria-hidden="true" />}
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
                <span className="adm-fleet-chip-count mono">{counts[id]}</span>
              </Button>
            );
          })}
        </div>
        <AdminLayoutToggle layout={layout} onChange={onLayoutChange} />
      </div>

      <div className="relay-search adm-search">
        <ActionSearch size={16} aria-hidden="true" />
        <input
          className="adm-search-input"
          name="admin-employees-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.v2.search_employees_placeholder")}
          aria-label={t("admin.v2.search_employees_placeholder")}
        />
      </div>

      {deleteError ? (
        <p className="adm-view-error">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}
      {agentsQuery.error ? (
        <p className="adm-view-error" role="alert">
          {t("admin.v2.agents_load_error")}{" "}
          <Button variant="ghost" type="button" onClick={() => void agentsQuery.refetch()}>{t("admin.v2.retry")}</Button>
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="adm-empty-body">{t("admin.v2.no_match")}</p>
      ) : layout === "card" ? (
        <div className="adm-fleet-grid">
          {filtered.map((member) => (
            <EmployeeCard
              key={member.id}
              member={member}
              agents={agents.filter((agent) => agent.employeeId === member.id && !agent.deletedAt)}
              highlight={highlightedEmployeeId === member.id}
              onSelectAgent={onSelectAgent}
              onDelete={onDeleteEmployee ? (id) => void handleDeleteEmployee(id) : undefined}
              deletePending={pendingDelete !== null}
              t={t}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="adm-emp-cols" aria-hidden="true">
            <span className="adm-emp-col-label">{t("admin.col_employee")}</span>
            <span className="adm-emp-col-label">{t("admin.col_agents")}</span>
            <span className="adm-emp-col-label adm-emp-col-label--metrics">{t("admin.v2.col_metrics")}</span>
          </div>
          <ul className="adm-emp-list">
            {filtered.map((member) => {
              const memberAgents = agents.filter((agent) => agent.employeeId === member.id && !agent.deletedAt);
              const highlight = highlightedEmployeeId === member.id;
              return (
                <li
                  key={member.id}
                  className={`adm-emp-row ${highlight ? "is-pulse" : ""}`}
                  data-employee={member.id}
                >
                  <div className="adm-emp-id">
                    <p className="adm-emp-name" translate="no">{member.displayName}</p>
                    <p className="adm-emp-meta mono">
                      <span translate="no">@{member.id}</span>
                      {member.email ? <span translate="no">{member.email}</span> : null}
                      {member.departmentName ? <span>{member.departmentName}</span> : null}
                    </p>
                  </div>
                  <div className="adm-emp-nodes">
                    {memberAgents.length === 0 ? (
                      <span className="adm-emp-no-nodes">{t("admin.v2.no_agents_for_employee")}</span>
                    ) : (
                      memberAgents.map((agent) => (
                        <Button variant="ghost"
                          key={agent.id}
                          type="button"
                          className={`adm-node-chip adm-node-chip--button tone-${agentAvailabilityTone(agent.availability)}`}
                          onClick={() => onSelectAgent?.(agent.id)}
                          disabled={!onSelectAgent}
                        >
                          <AgentMark agent={agent.executorKind} size={12} className="adm-node-chip-mark" />
                          <span translate="no">{agent.displayName}</span>
                        </Button>
                      ))
                    )}
                  </div>
                  <div
                    className="adm-emp-metrics"
                    aria-label={t("admin.v2.emp_metrics_aria", {
                      running: member.runningCount,
                      ready: member.readyCount,
                      total: member.nodeCount,
                    })}
                  >
                    <div className="adm-emp-metric">
                      <span className="adm-emp-metric-label">{t("admin.v2.col_running")}</span>
                      <span className={`adm-emp-running mono ${member.runningCount > 0 ? "tone-neutral" : "tone-muted"}`}>
                        {member.runningCount}
                      </span>
                    </div>
                    <div className="adm-emp-metric">
                      <span className="adm-emp-metric-label">{t("admin.v2.col_ready")}</span>
                      <span className="adm-emp-ratio mono tone-muted">
                        {member.readyCount}/{member.nodeCount}
                      </span>
                    </div>
                    {onDeleteEmployee ? (
                      <Button variant="ghost"
                        type="button"
                        className="adm-emp-delete"
                        onClick={() => void handleDeleteEmployee(member.id)}
                        disabled={pendingDelete !== null}
                        aria-label={t("admin.v2.delete_employee_action")}
                        title={t("admin.v2.delete_employee_action")}
                      >
                        <AdminDelete size={13} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
