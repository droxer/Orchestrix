"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import {
  buildEmployeeSummaries,
  isStale,
  statusTone,
  truncateId,
  visualStatus,
  type EmployeeNodeSummary,
} from "./helpers";

interface PeopleViewProps {
  employees: import("../../types").EmployeeRecord[];
  nodes: ControlPanelDaemonNodeRecord[];
  onRevealCredentials: (node: ControlPanelDaemonNodeRecord) => void;
  onOnboard: () => void;
  onRequestAssign: (employeeId: string) => void;
  onDeleteEmployee?: (employee: import("../../types").EmployeeRecord) => Promise<void>;
  unassignedNodeCount: number;
  highlightedEmployeeId: string | null;
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

export function PeopleView({
  employees,
  nodes,
  onRevealCredentials,
  onOnboard,
  onRequestAssign,
  onDeleteEmployee,
  unassignedNodeCount,
  highlightedEmployeeId,
}: PeopleViewProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        ...item.nodes.map((node) => node.id),
        ...item.nodes.map((node) => node.workspacePath ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [summaries, query]);

  const groups = useMemo(() => groupByDepartment(filtered, t("admin.v2.dept_none")), [filtered, t]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  if (summaries.length === 0) {
    return (
      <RelayEmptyState
        className="adm-people-empty"
        fill
        atmosphere
        title={t("admin.v2.empty_people_title")}
        body={t("admin.v2.empty_people_body")}
        illustration={<Users size={40} strokeWidth={1.25} aria-hidden="true" />}
        actions={(
          <Button type="button" onClick={onOnboard}>
            {t("admin.v2.onboard_cta")}
          </Button>
        )}
      />
    );
  }

  return (
    <div className="adm-view">
      <div className="adm-search">
        <Search size={16} aria-hidden="true" />
        <input
          className="adm-search-input"
          name="admin-people-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.v2.search_people_placeholder")}
          aria-label={t("admin.v2.search_people_placeholder")}
        />
      </div>

      {deleteError ? (
        <p className="adm-people-error">{t("admin.v2.action_failed", { message: deleteError })}</p>
      ) : null}

      {groups.length === 0 ? (
        <p className="adm-empty-body">{t("admin.v2.no_match")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="adm-dept-group">
            <header className="adm-dept-head">
              <span className="adm-dept-label">{group.label}</span>
              <span className="adm-dept-count mono">
                {t("admin.employee_count", { count: group.members.length })}
              </span>
            </header>
            <ul className="adm-emp-list">
              {group.members.map((member) => {
                const memberNodes = member.nodes.map((node) => nodeById.get(node.id) ?? node);
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
                      {memberNodes.length === 0 ? (
                        <span className="adm-emp-no-nodes">{t("admin.v2.no_nodes_for_employee")}</span>
                      ) : (
                        memberNodes.map((node) => {
                          const status = visualStatus(node);
                          const tone = statusTone(status);
                          return (
                            <button
                              key={node.id}
                              type="button"
                              className={`adm-node-chip tone-${tone}`}
                              onClick={() => onRevealCredentials(node)}
                              title={t("admin.v2.reveal_credentials_for", { id: node.id })}
                            >
                              <span className={`adm-node-chip-dot tone-${tone}`} aria-hidden="true" />
                              <span className="mono">{truncateId(node.id)}</span>
                              {!isStale(node) && node.status === "running" ? (
                                <span className="adm-node-chip-pulse" aria-hidden="true" />
                              ) : null}
                            </button>
                          );
                        })
                      )}
                      <button
                        type="button"
                        className="adm-emp-add-node"
                        onClick={() => onRequestAssign(member.id)}
                        disabled={unassignedNodeCount === 0}
                        title={
                          unassignedNodeCount === 0
                            ? t("admin.v2.add_node_disabled_hint")
                            : t("admin.v2.add_node_for", { id: member.id })
                        }
                      >
                        <Plus size={12} aria-hidden="true" />
                        <span>{t("admin.v2.add_node")}</span>
                      </button>
                    </div>
                    <div className="adm-emp-metrics">
                      <span className={`adm-emp-running mono ${member.runningCount > 0 ? "tone-neutral" : "tone-muted"}`}>
                        {member.runningCount}
                      </span>
                      <span className="adm-emp-ratio mono tone-muted">
                        {member.readyCount}/{member.nodeCount}
                      </span>
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
        ))
      )}
    </div>
  );
}
