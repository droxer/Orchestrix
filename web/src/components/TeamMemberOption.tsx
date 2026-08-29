"use client";

import type { AgentName, AgentPlacement } from "../types";
import { Checkbox } from "@/components/ui/checkbox";
import { AgentMetaLine } from "./AgentMetaLine";

/* One team-member pick row. TeamDrawer and TeamWorkspacePage both used to
   render this label+checkbox+name+kind anatomy by hand; the checkbox is the
   shared primitive so the check affordance stops being OS chrome. The meta
   line is <AgentMetaLine>, the same component the roster and the team profile
   render — this file used to claim it matched the roster while drawing its own
   glyph-less, one-rung-larger version. */
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
        <AgentMetaLine
          executorKind={executorKind}
          placements={placements}
          className="team-member-option-meta"
        />
      </span>
    </label>
  );
}
