"use client";

import { useTranslation } from "react-i18next";
import { StateMark } from "./StateMark";
import {
  AdminDelete,
  ICON,
} from "./icons";
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
}

export function PlacementList({
  descriptions,
  canManage,
  pendingPlacementId,
  onRemove,
  nodeMissingFor,
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
            <StateMark tone={tone} />
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
                disabled={pendingPlacementId !== null}
                aria-label={t("admin.v2.remove_placement")}
                title={t("admin.v2.remove_placement")}
              >
                <AdminDelete size={ICON.sm} aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
