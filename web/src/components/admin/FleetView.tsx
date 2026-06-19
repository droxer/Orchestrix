"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import { visualStatus } from "./helpers";
import { NodeCard } from "./NodeCard";

type FleetFilter = "all" | "ready" | "running" | "provisioning" | "failed" | "unassigned";

interface FleetViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  onRevealCredentials: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDeleteNode?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
}

const FILTERS: FleetFilter[] = ["all", "ready", "running", "provisioning", "failed", "unassigned"];

function matchesFilter(node: ControlPanelDaemonNodeRecord, filter: FleetFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unassigned") return !node.employeeId;
  const status = visualStatus(node);
  if (filter === "failed") return status === "failed" || status === "stale";
  if (filter === "ready") return status === "ready";
  if (filter === "running") return status === "running";
  if (filter === "provisioning") return status === "provisioning";
  return false;
}

function filterLabel(filter: FleetFilter, t: TFunction): string {
  if (filter === "all") return t("admin.v2.filter_all");
  if (filter === "unassigned") return t("admin.unassigned");
  if (filter === "failed") return t("admin.v2.filter_failed");
  return t(`status.${filter}`, { defaultValue: filter });
}

export function FleetView({ nodes, employees, onRevealCredentials, onManageAgents, onDeleteNode }: FleetViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FleetFilter>("all");

  const counts = useMemo(() => {
    const result: Record<FleetFilter, number> = {
      all: nodes.length,
      ready: 0,
      running: 0,
      provisioning: 0,
      failed: 0,
      unassigned: 0,
    };
    for (const node of nodes) {
      if (matchesFilter(node, "ready")) result.ready += 1;
      if (matchesFilter(node, "running")) result.running += 1;
      if (matchesFilter(node, "provisioning")) result.provisioning += 1;
      if (matchesFilter(node, "failed")) result.failed += 1;
      if (!node.employeeId) result.unassigned += 1;
    }
    return result;
  }, [nodes]);

  const filtered = useMemo(() => nodes.filter((node) => matchesFilter(node, filter)), [nodes, filter]);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  return (
    <div className="adm-view">
      <div className="adm-tabs" role="tablist" aria-label={t("admin.v2.filter_label")}>
        {FILTERS.map((id) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`adm-tab ${active ? "active" : ""}`}
              onClick={() => setFilter(id)}
            >
              <span>{filterLabel(id, t)}</span>
              <span className="adm-tab-count mono">{counts[id]}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty-block">
          <p className="adm-empty-body">{t("admin.v2.no_nodes_for_filter")}</p>
        </div>
      ) : (
        <div className="adm-fleet-grid">
          {filtered.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              employee={node.employeeId ? employeeById.get(node.employeeId) : undefined}
              onReveal={onRevealCredentials}
              onManageAgents={onManageAgents}
              onDelete={onDeleteNode}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
