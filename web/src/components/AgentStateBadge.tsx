import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentName, LogicalAgentAvailability } from "../types";
import { AgentMark } from "./AgentMark";
import { ProfileImage } from "./ProfileImagePicker";

/**
 * Visual agent-state indicator for a task. The agent glyph carries identity
 * and a readiness pip carries status; the full textual label moves to a
 * tooltip + aria-label so the board/list stay scannable without a text badge
 * per row. An unassigned task renders a dashed placeholder slot.
 *
 * The pip is tri-state: ready = green, busy/pending = amber (healthy, just
 * occupied), offline = red. Pass `availability` for the tri-state readout;
 * the boolean `ready` prop remains as a two-state fallback for callers that
 * only know routability (e.g. the backlog).
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
    return <span className="agent-state agent-state--empty" role="img" aria-label={label} title={label} />;
  }

  const tone = availability
    ? availability === "ready"
      ? "tone-good"
      : availability === "offline"
        ? "tone-bad"
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
    <span
      className={cn("agent-state", tone)}
      data-agent={agent}
      role="img"
      aria-label={label}
      title={label}
    >
      {imageUrl ? (
        <ProfileImage src={imageUrl} alt="" fallback={null} />
      ) : (
        <AgentMark agent={agent} size={14} />
      )}
    </span>
  );
}
