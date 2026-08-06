"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RelayEmptyState } from "@/components/RelayEmptyState";
import { Button } from "@/components/ui/button";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { AdminNode, ICON_STROKE_LARGE } from "../icons";
import { SearchInput } from "@/components/ui/search-input";
import { canUseLocalControlPanel } from "../../lib/controlPanel";
import {
  matchesNodeQuickFilter,
  stableNodeOrder,
  type NodeQuickFilter,
} from "../../lib/adminHelpers";
import type { StoredNodeTokenMap } from "./helpers";
import { NodeCard } from "./NodeCard";
import { NodeRow } from "./NodeRow";
import { NodeProfileBadges } from "./NodeProfileBadges";
import { AdminLayoutToggle, type AdminLayout } from "./AdminLayoutToggle";

interface NodesViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
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
  return t(`status.${filter}`, { defaultValue: filter });
}

export function NodesView({ nodes, storedTokens, layout, onLayoutChange, onRevealCredentials, onRenameNode, onManageExecutors, onDeleteNode, onAddNode }: NodesViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<NodeQuickFilter>("all");
  const [query, setQuery] = useState("");
  const colocated = canUseLocalControlPanel();

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stableNodeOrder(nodes).filter((node) => {
      if (!matchesNodeQuickFilter(node, filter)) return false;
      if (!q) return true;
      const haystack = [
        node.id,
        node.displayName ?? "",
        node.workspacePath ?? "",
        node.sandboxMode ?? "",
        ...Object.keys(node.agents),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [nodes, filter, query]);

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
              storedTokens={storedTokens}
              colocated={colocated}
              onReveal={onRevealCredentials}
              onRename={onRenameNode}
              onManageExecutors={onManageExecutors}
              onDelete={onDeleteNode}
              t={t}
            />
          ))}
        </div>
      ) : (
        <div role="table" aria-label={t("admin.v2.nav_nodes")}>
          <div className="adm-node-cols" role="row">
            <span className="adm-col-label" role="columnheader">{t("admin.v2.col_node")}</span>
            <span className="adm-col-label" role="columnheader">{t("admin.v2.node_runtimes")}</span>
            <span className="adm-col-label adm-col-label--metrics" role="columnheader">{t("admin.v2.col_actions")}</span>
          </div>
          <ul className="adm-node-list" role="rowgroup">
            {filtered.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                storedTokens={storedTokens}
                colocated={colocated}
                onReveal={onRevealCredentials}
                onRename={onRenameNode}
                onManageExecutors={onManageExecutors}
                onDelete={onDeleteNode}
                t={t}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
