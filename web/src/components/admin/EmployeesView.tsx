"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { AgentMark } from "../AgentMark";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { listControlPanelAgents } from "../../api";
import { ADMIN_AGENTS_KEY } from "../../lib/adminHelpers";
import {
  buildEmployeeSummaries,
  agentAvailabilityTone,
  type EmployeeNodeSummary,
} from "./helpers";

interface EmployeesViewProps {
  employees: import("../../types").EmployeeRecord[];
  nodes: ControlPanelDaemonNodeRecord[];
  onAddEmployee: () => void;
  onDeleteEmployee?: (employee: import("../../types").EmployeeRecord) => Promise<void>;
  highlightedEmployeeId: string | null;
  onSelectAgent?: (agentId: string) => void;
}

interface DepartmentGroup {
  key: string;
  label: string;
  members: EmployeeNodeSummary[];
}

function groupByDepartment(summaries: EmployeeNodeSummary[], unlabeled: string): DepartmentGroup[] {
  const groups = new Map<string, DepartmentGroup>();
  for (const member of summaries) {
    const key = member.departmentId ?? "_none";
    const label = member.departmentName ?? unlabeled;
    const current = groups.get(key) ?? { key, label, members: [] };
    current.members.push(member);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "_none") return 1;
    if (b.key === "_none") return -1;
    return a.label.localeCompare(b.label);
  });
}

export function EmployeesView({
  employees,
  nodes,
  onAddEmployee,
  onDeleteEmployee,
  highlightedEmployeeId,
  onSelectAgent,
}: EmployeesViewProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter((item) => {
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
  }, [agents, summaries, query]);

  const groups = useMemo(() => groupByDepartment(filtered, t("admin.v2.dept_none")), [filtered, t]);

  if (summaries.length === 0) {
    return (
      <RelayEmptyState
        className="adm-employees-empty"
        fill
        title={t("admin.v2.empty_employees_title")}
        body={t("admin.v2.empty_employees_body")}
        illustration={<Users size={40} strokeWidth={1.25} aria-hidden="true" />}
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
      <div className="relay-search adm-search">
        <Search size={16} aria-hidden="true" />
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
          <button type="button" onClick={() => void agentsQuery.refetch()}>{t("admin.v2.retry")}</button>
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="adm-empty-body">{t("admin.v2.no_match")}</p>
      ) : (
        <>
          <div className="adm-emp-cols" aria-hidden="true">
            <span className="adm-emp-col-label">{t("admin.col_employee")}</span>
            <span className="adm-emp-col-label">{t("admin.col_agents")}</span>
            <span className="adm-emp-col-label adm-emp-col-label--metrics">{t("admin.v2.col_metrics")}</span>
          </div>
          {groups.map((group) => (
          <section key={group.key} className="adm-dept-group">
            <header className="adm-dept-head">
              <span className="adm-dept-label">{group.label}</span>
              <span className="adm-dept-count mono">
                {t("admin.employee_count", { count: group.members.length })}
              </span>
            </header>
            <ul className="adm-emp-list">
              {group.members.map((member) => {
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
                      </p>
                    </div>
                    <div className="adm-emp-nodes">
                      {memberAgents.length === 0 ? (
                        <span className="adm-emp-no-nodes">{t("admin.v2.no_agents_for_employee")}</span>
                      ) : (
                        memberAgents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            className={`adm-node-chip adm-node-chip--button tone-${agentAvailabilityTone(agent.availability)}`}
                            onClick={() => onSelectAgent?.(agent.id)}
                            disabled={!onSelectAgent}
                          >
                            <AgentMark agent={agent.executorKind} size={12} className="adm-node-chip-mark" />
                            <span translate="no">{agent.displayName}</span>
                          </button>
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
                        <button
                          type="button"
                          className="adm-emp-delete"
                          onClick={() => void handleDeleteEmployee(member.id)}
                          disabled={pendingDelete !== null}
                          aria-label={t("admin.v2.delete_employee_action")}
                          title={t("admin.v2.delete_employee_action")}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          ))}
        </>
      )}
    </div>
  );
}
