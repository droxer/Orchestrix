"use client";

import { useTranslation } from "react-i18next";
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
  incompatible,
  disabled = false,
  onToggle,
}: {
  agentId: string;
  displayName: string;
  executorKind: AgentName;
  selected: boolean;
  /** Blocked by the node-scope rule — gets the explanatory title. */
  incompatible: boolean;
  disabled?: boolean;
  onToggle: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      className="team-member-option"
      title={incompatible ? t("teams.node_scope_required") : undefined}
    >
      <Checkbox
        checked={selected}
        disabled={disabled || incompatible}
        onCheckedChange={() => onToggle(agentId)}
        aria-label={displayName}
      />
      <span>{displayName}</span>
      <small>{agentLabel(executorKind)}</small>
    </label>
  );
}
