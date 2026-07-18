import { ActionEdit, ActionRemove } from "./icons";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./ui/DialogProvider";
import { AgentMark } from "./AgentMark";
import type { AgentName, RelaySession } from "../types";
import { conversationLabel, sessionAgents, type ConversationItem } from "../lib/conversations";
import { labelForExecutor } from "../lib/agentDisplayNames";
import {
  conversationActivity,
  type ConversationActivityKind,
} from "../lib/conversationActivity";
import { Button } from "./ui/button";

export type { ConversationItem };

// How each activity kind renders: the leading indicator (a slate pulse for a
// live run, else a status pip) and whether the line reads muted. The tone→pip
// class table lives once here; the kind decision is the pure
// `conversationActivity` (see conversationActivity.ts).
const ACTIVITY_STYLE: Record<
  ConversationActivityKind,
  { className: string; dotClass: string; pulse?: boolean }
> = {
  working: { className: "working", dotClass: "", pulse: true },
  warn: { className: "", dotClass: "status-dot status-dot-warn" },
  bad: { className: "", dotClass: "status-dot status-dot-bad" },
  good: { className: "muted", dotClass: "status-dot status-dot-good" },
  neutral: { className: "muted", dotClass: "status-dot status-dot-neutral" },
};

function relativeTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.round(diff / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (sec < 60) return formatter.format(-sec, "second");
  const min = Math.round(sec / 60);
  if (min < 60) return formatter.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return formatter.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 7) return formatter.format(-day, "day");
  const wk = Math.round(day / 7);
  if (wk < 5) return formatter.format(-wk, "week");
  const mo = Math.round(day / 30);
  if (mo < 12) return formatter.format(-mo, "month");
  return formatter.format(-Math.round(day / 365), "year");
}

type ConversationRowProps = {
  item: ConversationItem;
  selected: boolean;
  agentDisplayNames?: Partial<Record<AgentName, string>>;
  onSelect: (sessionId: string) => void;
  onRename?: (session: RelaySession) => void;
  onClose?: (sessionId: string) => void;
};

export function ConversationRow({ item, selected, agentDisplayNames, onSelect, onRename, onClose }: ConversationRowProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useDialogs();
  const { session, runningAgent } = item;
  const label = conversationLabel(session);
  const stamp = relativeTime(session.updatedAt, i18n.language);
  const agents = sessionAgents(session);
  const activity = conversationActivity(session.status, runningAgent);
  const activityStyle = activity ? ACTIVITY_STYLE[activity.kind] : null;
  const activityText = activity
    ? activity.kind === "working"
      ? t(activity.labelKey, { agent: labelForExecutor(runningAgent!, agentDisplayNames) })
      : t(activity.labelKey)
    : undefined;
  const rowLabel = [label, stamp, activityText].filter(Boolean).join(" · ");

  async function handleClose() {
    if (!onClose) return;
    const ok = await confirm({
      title: t("conversation.close_confirm", { name: label }),
      confirmLabel: t("conversation.close"),
      tone: "danger",
    });
    if (ok) onClose(session.id);
  }

  return (
    <div className={`conversation-row ${selected ? "active" : ""}`.trimEnd()}>
      <Button variant="ghost"
        className="conversation-row-inner"
        type="button"
        aria-label={rowLabel}
        aria-pressed={selected}
        onClick={() => onSelect(session.id)}
      >
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              {agents.length > 0 ? (
                <span className="conversation-agents" role="img" aria-label={agents.join(", ")}>
                  {agents.map((agent) => (
                    <AgentMark key={agent} agent={agent} size={14} />
                  ))}
                </span>
              ) : null}
              <strong>{label}</strong>
            </span>
            {stamp ? (
              <span className="conversation-stamp mono">
                {stamp}
              </span>
            ) : null}
          </span>
          {activity && activityStyle ? (
            <span className={`conversation-activity ${activityStyle.className}`.trimEnd()}>
              {activityStyle.pulse ? (
                <span className="conversation-activity-pulse" aria-hidden="true" />
              ) : (
                <span className={activityStyle.dotClass} aria-hidden="true" />
              )}
              {activity.kind === "working" ? (
                <em>{activityText}</em>
              ) : (
                <span>{activityText}</span>
              )}
            </span>
          ) : null}
        </span>
      </Button>
      <span className="conversation-row-actions">
        {onRename ? (
          <Button variant="ghost"
            className="conversation-rename-btn"
            type="button"
            aria-label={t("conversation.rename")}
            title={t("conversation.rename")}
            onClick={() => onRename(session)}
          >
            <ActionEdit size={11} />
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost"
            className="conversation-remove-btn"
            type="button"
            aria-label={t("conversation.close")}
            title={t("conversation.close")}
            onClick={handleClose}
          >
            <ActionRemove size={11} />
          </Button>
        ) : null}
      </span>
    </div>
  );
}
