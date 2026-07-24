import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentName, LogicalAgentAvailability } from "../types";
import { AgentMark } from "./AgentMark";
import { ProfileImage } from "./ProfileImagePicker";

/**
 * Visual agent-state indicator for a task. The agent glyph carries identity
 * and a readiness pip carries status; the full textual label moves to a
 * tooltip + sr-only text so the board/list stay scannable without a text
 * badge per row. An unassigned task renders a dashed placeholder slot.
 *
 * The pip is tri-state: ready = good, busy = info, pending = warn (both
 * healthy, just occupied — distinct brightness tiers), offline = bad (a
 * hollow ring, per the shape grammar). The label is exposed as sr-only text
 * so state is not carried by color alone. Pass `availability` for the
 * tri-state readout; the boolean `ready` prop remains as a two-state
 * fallback for callers that only know routability (e.g. the backlog).
 */
export function AgentStateBadge({
  agent,
  ready,
  availability,
  imageUrl,
}: {
  agent: AgentName | null | undefined;
  ready: boolean;
  availability?: LogicalAgentAvailability;
  imageUrl?: string | null;
}) {
  const { t } = useTranslation();

  if (!agent) {
    const label = t("backlog.no_agent");
    return (
      <span className="agent-state agent-state--empty" title={label}>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const tone = availability
    ? availability === "ready"
      ? "tone-good"
      : availability === "offline"
        ? "tone-bad"
        : availability === "busy"
          ? "tone-info"
          : "tone-warn"
    : ready
      ? "tone-good"
      : "tone-bad";
  const stateLabel = availability
    ? t(`status.${availability}`, { defaultValue: availability })
    : ready
      ? t("backlog.ready")
      : t("backlog.not_ready");
  const label = `${agent} · ${stateLabel}`;
  return (
    <span className={cn("agent-state", tone)} data-agent={agent} title={label}>
      {imageUrl ? (
        <ProfileImage src={imageUrl} alt="" fallback={null} />
      ) : (
        <AgentMark agent={agent} size={14} />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
