"use client";

import { useTranslation } from "react-i18next";
import { AdminDelete } from "./icons";
import { Button } from "@/components/ui/button";
import { AgentPlacementBadge } from "./AgentPlacementBadge";
import { placementStatusTone, type AgentPlacementDescription } from "../lib/agentPlacements";
import type { AgentPlacement } from "../types";

interface PlacementListProps {
  descriptions: AgentPlacementDescription[];
  canManage: boolean;
  pendingPlacementId: string | null;
  onRemove: (placement: AgentPlacement) => void;
  /** Overrides the default node-missing check (`ownership === "pending"`). */
  nodeMissingFor?: (description: AgentPlacementDescription) => boolean;
  /** Set when a team depends on this computer: disables remove and explains why. */
  removeBlockedReason?: string;
}

export function PlacementList({
  descriptions,
  canManage,
  pendingPlacementId,
  onRemove,
  nodeMissingFor,
  removeBlockedReason,
}: PlacementListProps) {
  const { t } = useTranslation();

  return (
    <ul className="adm-placement-list">
      {descriptions.map((description) => {
        const placement = description.placement;
        const nodeMissing = nodeMissingFor
          ? nodeMissingFor(description)
          : description.ownership === "pending";
        const tone = placementStatusTone(placement.status);
        return (
          <li key={placement.id} className={`adm-placement-item${canManage ? "" : " adm-placement-item--compact"}`}>
            <span className={`adm-placement-dot tone-${tone}`} aria-hidden="true" />
            <span className="adm-placement-body">
              <AgentPlacementBadge
                description={description}
                showSandbox={canManage}
              />
              <span className="adm-placement-status-row">
                <span className={`adm-placement-status tone-${tone}`}>
                  {t(`admin.v2.placement_status.${placement.status}`, { defaultValue: placement.status })}
                </span>
                {nodeMissing ? (
                  <span className="adm-placement-status tone-bad">{t("admin.v2.agents_node_missing")}</span>
                ) : null}
              </span>
            </span>
            {canManage ? (
              <Button variant="ghost"
                type="button"
                className="adm-placement-remove"
                onClick={() => onRemove(placement)}
                disabled={pendingPlacementId !== null || Boolean(removeBlockedReason)}
                aria-label={t("admin.v2.remove_placement")}
                title={removeBlockedReason || t("admin.v2.remove_placement")}
              >
                <AdminDelete size={13} aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
