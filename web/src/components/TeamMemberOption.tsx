"use client";

import { useTranslation } from "react-i18next";
import { describeAgentPlacements } from "../lib/agentPlacements";
import { agentLabel } from "../lib/plan";
import type { AgentName, AgentPlacement } from "../types";
import { OWNERSHIP_ICON } from "./AgentPlacementBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { ICON } from "./icons";

/* One team-member pick row. TeamDrawer and TeamWorkspacePage both used to
   render this label+checkbox+name+kind anatomy by hand; the checkbox is the
   shared primitive so the check affordance stops being OS chrome. The meta
   line matches the agent roster: kind first, then the agent's home computer
   — an agent with nowhere to run says so. */
export function TeamMemberOption({
  agentId,
  displayName,
  executorKind,
  placements = [],
  selected,
  disabled = false,
  onToggle,
}: {
  agentId: string;
  displayName: string;
  executorKind: AgentName;
  placements?: AgentPlacement[];
  selected: boolean;
  disabled?: boolean;
  onToggle: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  // One agent lives on exactly one computer.
  const computer = describeAgentPlacements(placements)[0] ?? null;
  const ComputerIcon = computer ? OWNERSHIP_ICON[computer.ownership] : null;
  const computerTitle = computer
    ? `${t(`admin.v2.node_ownership_${computer.ownership}`)} · ${computer.nodeName}`
    : undefined;

  return (
    <label
      className="team-member-option"
    >
      <Checkbox
        checked={selected}
        disabled={disabled}
        onCheckedChange={() => onToggle(agentId)}
        aria-label={displayName}
      />
      <span className="team-member-option-main">
        <span className="team-member-option-name">{displayName}</span>
        <span className="team-member-option-meta code">
          <span>{agentLabel(executorKind)}</span>
          {computer && ComputerIcon ? (
            <span className="team-member-option-computer" translate="no" title={computerTitle}>
              <ComputerIcon size={ICON.xs} aria-hidden="true" />
              {computer.nodeName}
            </span>
          ) : (
            <span>{t("agents_page.no_placements")}</span>
          )}
        </span>
      </span>
    </label>
  );
}
