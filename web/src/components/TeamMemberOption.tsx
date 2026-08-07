"use client";

import { agentLabel } from "../lib/plan";
import type { AgentName } from "../types";
import { Checkbox } from "@/components/ui/checkbox";

/* One team-member pick row. TeamDrawer and TeamWorkspacePage both used to
   render this label+checkbox+name+kind anatomy by hand; the checkbox is the
   shared primitive so the check affordance stops being OS chrome. */
export function TeamMemberOption({
  agentId,
  displayName,
  executorKind,
  selected,
  disabled = false,
  onToggle,
}: {
  agentId: string;
  displayName: string;
  executorKind: AgentName;
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
      <span>{displayName}</span>
      <small>{agentLabel(executorKind)}</small>
    </label>
  );
}
