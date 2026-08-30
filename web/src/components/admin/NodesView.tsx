"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { Button } from "@/components/ui/button";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../types";
import {
  AdminNode,
  ICON,
  ICON_STROKE_LARGE,
} from "../icons";
import { SearchInput } from "@/components/ui/search-input";
import { canUseLocalControlPanel } from "../../lib/controlPanel";
import {
  matchesNodeQuickFilter,
  nodeSortColumns,
  stableNodeOrder,
  type NodeQuickFilter,
} from "../../lib/adminHelpers";
import { applySort } from "../../lib/listSort";
import { paginate } from "../../lib/pagination";
import { usePagination } from "../../hooks/usePagination";
import { Pagination } from "@/components/ui/Pagination";
import { useListSort } from "../../hooks/useListSort";
import { SortableColumnHeader } from "@/components/ui/SortableColumnHeader";
import { SortMenu } from "@/components/ui/SortMenu";
import type { StoredNodeTokenMap } from "./helpers";
import { NodeCard } from "./NodeCard";
import { NodeRow } from "./NodeRow";
import { AdminLayoutToggle, type AdminLayout } from "./AdminLayoutToggle";

interface NodesViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  storedTokens: StoredNodeTokenMap;
  layout: AdminLayout;
  onLayoutChange: (next: AdminLayout) => void;
  onRevealCredentials: (node: ControlPanelDaemonNodeRecord) => void;
  onRenameNode: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDeleteNode?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  onAddNode?: () => void;
}

const FILTERS: NodeQuickFilter[] = ["all", "ready", "running", "provisioning", "failed", "stopped", "unassigned"];

function filterLabel(filter: NodeQuickFilter, t: TFunction): string {
  if (filter === "all") return t("admin.v2.filter_all");
  if (filter === "unassigned") return t("admin.unassigned");
  if (filter === "failed") return t("admin.v2.filter_failed");
  // NOT status.running. This slice is "the Computer process is up" — see
  // matchesNodeQuickFilter — which makes it a SUPERSET of Ready, so labelling
  // it "Running" put two pills reading `Ready 3 · Running 3` side by side in a
  // row that looks like a partition, and collided with the dashboard's
  // Running tile, where the same word counts computers executing an agent
  // right now. The predicate is deliberate and tested; the word was wrong.
  if (filter === "running") return t("admin.v2.filter_running");
  return t(`status.${filter}`, { defaultValue: filter });
}

export function NodesView({ nodes, employees, storedTokens, layout, onLayoutChange, onRevealCredentials, onRenameNode, onManageExecutors, onDeleteNode, onAddNode }: NodesViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<NodeQuickFilter>("all");
  const [query, setQuery] = useState("");
  const colocated = canUseLocalControlPanel();

  const employeeById = useMemo(() => {
    const map = new Map<string, EmployeeRecord>();
    for (const employee of employees) map.set(employee.id, employee);
    return map;
  }, [employees]);

  const counts = useMemo(() => {
    const result: Record<NodeQuickFilter, number> = {
      all: nodes.length,
      ready: 0,
      running: 0,
      provisioning: 0,
      failed: 0,
      stopped: 0,
      unassigned: 0,
    };
    for (const node of nodes) {
      if (matchesNodeQuickFilter(node, "ready")) result.ready += 1;
      if (matchesNodeQuickFilter(node, "running")) result.running += 1;
      if (matchesNodeQuickFilter(node, "provisioning")) result.provisioning += 1;
      if (matchesNodeQuickFilter(node, "failed")) result.failed += 1;
      if (matchesNodeQuickFilter(node, "stopped")) result.stopped += 1;
      if (!node.employeeId) result.unassigned += 1;
    }
    return result;
  }, [nodes]);

  const sortColumns = useMemo(() => nodeSortColumns(employeeById), [employeeById]);
  // A distinct param: the admin page keeps Nodes and Employees on one route,
  // so a bare `sort` would have the two tables fighting over one key.
  const { sort, toggleSort, setSort } = useListSort(sortColumns, "nodeSort");
  const { page, setPage } = usePagination("nodePage");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = stableNodeOrder(nodes).filter((node) => {
      if (!matchesNodeQuickFilter(node, filter)) return false;
      if (!q) return true;
      const employee = (node.employeeId && employeeById.get(node.employeeId)) ?? null;
      const employeeName = employee ? `${employee.displayName} ${employee.id}`.toLowerCase() : "";
      const haystack = [
        node.id,
        node.displayName ?? "",
        node.workspacePath ?? "",
        node.sandboxMode ?? "",
        ...Object.keys(node.agents),
        employeeName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // Unsorted, `stableNodeOrder` above still decides — applySort is identity.
    return applySort(matching, sortColumns, sort);
  }, [nodes, filter, query, employeeById, sort, sortColumns]);

  // One cursor for both layouts: switching card/list keeps the reader on the
  // same machines rather than resetting them to the top of the fleet.
  const paged = paginate(filtered, page);

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
        {/* Sits with the layout toggle, not inside the filter chips: at the
            widths it appears, it is the only way to sort at all. */}
        <SortMenu
          options={[
                  { key: "node", label: t("admin.v2.col_node") },
                  { key: "employee", label: t("admin.v2.col_employee") },
                  { key: "runtimes", label: t("admin.v2.node_runtimes"), defaultDirection: "desc" as const },
        ]}
          sort={sort}
          onSortChange={setSort}
          label={t("admin.v2.nav_nodes")}
        />
        <AdminLayoutToggle layout={layout} onChange={onLayoutChange} />
      </div>

      <SearchInput
        className="relay-search adm-search"
        inputClassName="adm-search-input"
        label={t("admin.v2.search_nodes_placeholder")}
        name="admin-nodes-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("admin.v2.search_nodes_placeholder")}
      />

      {filtered.length === 0 ? (
        <RelayEmptyState
          className="adm-fleet-empty"
          fill
          title={nodes.length === 0 ? t("admin.no_nodes") : t("admin.v2.no_nodes_for_filter")}
          illustration={<AdminNode size={ICON.hero} strokeWidth={ICON_STROKE_LARGE} aria-hidden="true" />}
          actions={nodes.length === 0 && onAddNode ? (
            <Button type="button" onClick={onAddNode}>
              {t("admin.v2.add_node_cta")}
            </Button>
          ) : undefined}
        />
      ) : layout === "card" ? (
        <div className="adm-fleet-grid">
          {paged.items.map((node) => {
            const employee = node.employeeId ? employeeById.get(node.employeeId) : undefined;
            const employeeName = employee?.displayName;
            return (
              <NodeCard
                key={node.id}
                node={node}
                employeeName={employeeName}
                storedTokens={storedTokens}
                colocated={colocated}
                onReveal={onRevealCredentials}
                onRename={onRenameNode}
                onManageExecutors={onManageExecutors}
                onDelete={onDeleteNode}
                t={t}
              />
            );
          })}
        </div>
      ) : (
        <div role="table" data-density="compact" aria-label={t("admin.v2.nav_nodes")}>
          <div className="adm-node-cols" role="row">
            <SortableColumnHeader
              className="adm-col-label"
              label={t("admin.v2.col_node")}
              sortKey="node"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableColumnHeader
              className="adm-col-label"
              label={t("admin.v2.col_employee")}
              sortKey="employee"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableColumnHeader
              className="adm-col-label"
              label={t("admin.v2.node_runtimes")}
              sortKey="runtimes"
              sort={sort}
              onSort={toggleSort}
              defaultDirection="desc"
            />
            {/* Actions is not a column of data — there is nothing to order by. */}
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_actions")}</span>
          </div>
          <ul className="adm-node-list" role="rowgroup">
            {paged.items.map((node) => {
              const employee = node.employeeId ? employeeById.get(node.employeeId) : undefined;
              const employeeName = employee?.displayName;
              return (
                <NodeRow
                  key={node.id}
                  node={node}
                  employeeName={employeeName}
                  storedTokens={storedTokens}
                  colocated={colocated}
                  onReveal={onRevealCredentials}
                  onRename={onRenameNode}
                  onManageExecutors={onManageExecutors}
                  onDelete={onDeleteNode}
                  t={t}
                />
              );
            })}
          </ul>
        </div>
      )}

      {/* One pager under both layouts — it is the collection that is paged,
          not the way the collection happens to be drawn. */}
      <Pagination page={paged} onPageChange={setPage} label={t("admin.v2.nav_nodes")} />
    </div>
  );
}
