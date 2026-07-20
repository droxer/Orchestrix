"use client";

import { useTranslation } from "react-i18next";
import { placementStatusTone, type AgentPlacementDescription, type PlacementOwnership } from "../lib/agentPlacements";
import { NodeLocal, NodeManaged, NodePending } from "./icons";

const OWNERSHIP_ICON: Record<PlacementOwnership, typeof NodeManaged> = {
  managed: NodeManaged,
  local: NodeLocal,
  pending: NodePending,
};

export function AgentPlacementBadge({
  description,
  showSandbox = false,
  compact = false,
}: {
  description: AgentPlacementDescription;
  showSandbox?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const OwnershipIcon = OWNERSHIP_ICON[description.ownership];
  const ownershipLabel = t(`admin.v2.node_ownership_${description.ownership}`);
  const sandboxLabel = t(`admin.v2.node_sandbox_${description.sandbox}`);
  const status = description.placement.status;
  const statusLabel = t(`admin.v2.placement_status.${status}`, { defaultValue: status });

  return (
    <span
      className={`agent-placement-badge${compact ? " is-compact" : ""}`}
      data-ownership={description.ownership}
      title={`${description.nodeName} · ${ownershipLabel} · ${sandboxLabel} · ${statusLabel}`}
    >
      <i className={`agent-placement-badge-dot tone-${placementStatusTone(status)}`} aria-hidden="true" />
      <OwnershipIcon size={13} aria-hidden="true" />
      <span className="agent-placement-badge-name" translate="no">
        {description.nodeName}
      </span>
      <span className="agent-placement-badge-kind">{ownershipLabel}</span>
      {showSandbox ? (
        <span className="agent-placement-badge-sandbox">{sandboxLabel}</span>
      ) : null}
    </span>
  );
}
