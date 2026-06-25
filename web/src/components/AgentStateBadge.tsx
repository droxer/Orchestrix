import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentName } from "../types";
import { AgentMark } from "./AgentMark";

/**
 * Visual agent-state indicator for a task. The agent glyph carries identity
 * and a readiness pip carries status (green = ready, red = not ready); the
 * full textual label ("claude · ready") moves to a tooltip + aria-label so
 * the board/list stay scannable without a text badge per row. An unassigned
 * task renders a dashed placeholder slot.
 */
export function AgentStateBadge({
  agent,
  ready,
}: {
  agent: AgentName | null | undefined;
  ready: boolean;
}) {
  const { t } = useTranslation();

  if (!agent) {
    const label = t("backlog.no_agent");
    return <span className="agent-state agent-state--empty" role="img" aria-label={label} title={label} />;
  }

  const label = `${agent} · ${ready ? t("backlog.ready") : t("backlog.not_ready")}`;
  return (
    <span
      className={cn("agent-state", ready ? "tone-good" : "tone-bad")}
      data-agent={agent}
      role="img"
      aria-label={label}
      title={label}
    >
      <AgentMark agent={agent} size={14} />
    </span>
  );
}
