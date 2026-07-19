"use client";

import { useTranslation } from "react-i18next";
import type { AgentPlacementDescription, PlacementOwnership } from "../lib/agentPlacements";
import { NodeLocal, NodeManaged, NodePending } from "./icons";

const OWNERSHIP_ICON: Record<PlacementOwnership, typeof NodeManaged> = {
  managed: NodeManaged,
  local: NodeLocal,
  pending: NodePending,
};

export function AgentPlacementBadge({
  description,
  showRank = false,
  showSandbox = false,
  compact = false,
}: {
  description: AgentPlacementDescription;
  showRank?: boolean;
  showSandbox?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const OwnershipIcon = OWNERSHIP_ICON[description.ownership];
  const ownershipLabel = t(`admin.v2.node_ownership_${description.ownership}`);
  const sandboxLabel = t(`admin.v2.node_sandbox_${description.sandbox}`);

  return (
    <span
      className={`agent-placement-badge${compact ? " is-compact" : ""}`}
      data-ownership={description.ownership}
      title={`${description.nodeName} · ${ownershipLabel} · ${sandboxLabel}`}
    >
      <OwnershipIcon size={13} aria-hidden="true" />
      <span className="agent-placement-badge-name" translate="no">
        {description.nodeName}
      </span>
      <span className="agent-placement-badge-kind">{ownershipLabel}</span>
      {showSandbox ? (
        <span className="agent-placement-badge-sandbox">{sandboxLabel}</span>
      ) : null}
      {showRank && description.preference ? (
        <span
          className="agent-placement-badge-rank"
          data-rank={description.preference === "preferred" ? "primary" : "alternate"}
        >
          {t(`admin.v2.placement_preference_${description.preference}`)}
        </span>
      ) : null}
    </span>
  );
}
