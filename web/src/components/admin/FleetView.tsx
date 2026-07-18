"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { Button } from "@/components/ui/button";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import { AdminNode, ActionSearch, ICON_STROKE_LARGE } from "../icons";
import { canUseLocalControlPanel } from "../../lib/controlPanel";
import { useUrlSearchState } from "../../hooks/useUrlSearchState";
import type { StoredNodeTokenMap } from "./helpers";
import { visualStatus } from "./helpers";
import { NodeCard } from "./NodeCard";
import { NodeRow } from "./NodeRow";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { AdminLayoutToggle, type AdminLayout } from "./AdminLayoutToggle";

type FleetFilter = "all" | "ready" | "running" | "provisioning" | "failed" | "unassigned";

interface FleetViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  storedTokens: StoredNodeTokenMap;
  layout: AdminLayout;
  onLayoutChange: (next: AdminLayout) => void;
  onRevealCredentials: (node: ControlPanelDaemonNodeRecord) => void;
  onManageAgents: (node: ControlPanelDaemonNodeRecord) => void;
  onDeleteNode?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  onAddNode?: () => void;
}

const FILTERS: FleetFilter[] = ["all", "ready", "running", "provisioning", "failed", "unassigned"];

function parseFleetFilter(value: string | null): FleetFilter {
  return FILTERS.includes(value as FleetFilter) ? value as FleetFilter : "all";
}

function serializeFleetFilter(value: FleetFilter): string | null {
  return value === "all" ? null : value;
}

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

export function FleetView({ nodes, employees, storedTokens, layout, onLayoutChange, onRevealCredentials, onManageAgents, onDeleteNode, onAddNode }: FleetViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useUrlSearchState("fleetFilter", "all" as FleetFilter, parseFleetFilter, serializeFleetFilter);
  const [query, setQuery] = useState("");
  const colocated = canUseLocalControlPanel();

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

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (!matchesFilter(node, filter)) return false;
      if (!q) return true;
      const employee = node.employeeId ? employeeById.get(node.employeeId) : undefined;
      const haystack = [
        node.id,
        node.employeeId ?? "",
        employee?.displayName ?? "",
        node.workspacePath ?? "",
        node.sandboxMode ?? "",
        ...Object.keys(node.agents),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [nodes, filter, query, employeeById]);

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
          name="admin-nodes-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.v2.search_nodes_placeholder")}
          aria-label={t("admin.v2.search_nodes_placeholder")}
        />
      </div>

      {filtered.length === 0 ? (
        <RelayEmptyState
          className="adm-fleet-empty"
          fill
          title={nodes.length === 0 ? t("admin.no_nodes") : t("admin.v2.no_nodes_for_filter")}
          illustration={<AdminNode size={40} strokeWidth={ICON_STROKE_LARGE} aria-hidden="true" />}
          actions={nodes.length === 0 && onAddNode ? (
            <Button type="button" onClick={onAddNode}>
              {t("admin.v2.add_node_cta")}
            </Button>
          ) : undefined}
        />
      ) : layout === "card" ? (
        <div className="adm-fleet-grid">
          {filtered.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              employee={node.employeeId ? employeeById.get(node.employeeId) : undefined}
              storedTokens={storedTokens}
              colocated={colocated}
              onReveal={onRevealCredentials}
              onManageAgents={onManageAgents}
              onDelete={onDeleteNode}
              t={t}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="adm-node-cols" aria-hidden="true">
            <span className="adm-emp-col-label">{t("admin.v2.nav_fleet")}</span>
            <span className="adm-emp-col-label">{t("admin.col_agents")}</span>
            <span className="adm-emp-col-label adm-emp-col-label--metrics">{t("admin.v2.col_actions")}</span>
          </div>
          <ul className="adm-node-list">
            {filtered.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                employee={node.employeeId ? employeeById.get(node.employeeId) : undefined}
                storedTokens={storedTokens}
                colocated={colocated}
                onReveal={onRevealCredentials}
                onManageAgents={onManageAgents}
                onDelete={onDeleteNode}
                t={t}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
