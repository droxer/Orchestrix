import { ActionRemove } from "./icons";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./ui/DialogProvider";
import { AgentMark } from "./AgentMark";
import type { AgentName, RelaySession } from "../types";
import { conversationLabel, type ConversationItem } from "../lib/conversations";
import {
  conversationActivity,
  type ConversationActivityKind,
} from "../lib/conversationActivity";

export type { ConversationItem };

// How each activity kind renders: the leading indicator (a cobalt pulse for a
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

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(day / 365)}y`;
}

type ConversationRowProps = {
  item: ConversationItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onRename?: (session: RelaySession) => void;
  onClose?: (sessionId: string) => void;
};

export function ConversationRow({ item, selected, onSelect, onRename, onClose }: ConversationRowProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const { session, runningAgent } = item;
  const label = conversationLabel(session);
  const stamp = relativeTime(session.updatedAt);
  const activity = conversationActivity(session.status, runningAgent);
  const activityStyle = activity ? ACTIVITY_STYLE[activity.kind] : null;

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
      <button
        className="conversation-row-inner"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(session.id)}
      >
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              {runningAgent ? <AgentMark agent={runningAgent} size={14} /> : null}
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
                <em>{t(activity.labelKey, { agent: runningAgent })}</em>
              ) : (
                <span>{t(activity.labelKey)}</span>
              )}
            </span>
          ) : null}
        </span>
      </button>
      <span className="conversation-row-actions">
        {onRename ? (
          <button
            className="conversation-rename-btn"
            type="button"
            aria-label={t("conversation.rename")}
            title={t("conversation.rename")}
            onClick={() => onRename(session)}
          >
            <span aria-hidden="true">✎</span>
          </button>
        ) : null}
        {onClose ? (
          <button
            className="conversation-remove-btn"
            type="button"
            aria-label={t("conversation.close")}
            title={t("conversation.close")}
            onClick={handleClose}
          >
            <ActionRemove size={11} />
          </button>
        ) : null}
      </span>
    </div>
  );
}
