import { ActionRemove } from "./icons";
import { useTranslation } from "react-i18next";
import { EmployeeAvatar } from "./EmployeeAvatar";
import type { DaemonNodeMonitorRecord, SandboxRecord, RelaySession, Tone } from "../types";
import { conversationDaemonStatus } from "../lib/conversationStatus";

type EmployeeContact = {
  id: string;
  sandbox?: SandboxRecord;
  node?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  sessionCount: number;
  lastSession?: RelaySession;
};

export type { EmployeeContact };

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  if (value === "stale") return "warn";
  return "neutral";
}

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
  contact: EmployeeContact;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
};

export function ConversationRow({ contact, selected, onSelect, onRemove }: ConversationRowProps) {
  const { t } = useTranslation();
  const status = conversationDaemonStatus(contact);
  const tone = statusTone(status);
  const lastAgent =
    contact.lastSession?.agentRuns[contact.lastSession.agentRuns.length - 1]?.agent;
  const stamp = relativeTime(contact.lastSession?.updatedAt);
  const sessionCountLabel = contact.sessionCount.toString().padStart(2, "0");

  function handleRemove() {
    if (!onRemove) return;
    if (window.confirm(t("conversation.remove_confirm", { id: contact.id }))) {
      onRemove(contact.id);
    }
  }

  const activityLine = contact.activeRun ? (
    <span className="conversation-activity working">
      <span className="conversation-activity-pulse" aria-hidden="true" />
      <em>{t("conversation.agent_working", { agent: contact.activeRun.agent })}</em>
    </span>
  ) : contact.lastSession?.taskGoal ? (
    <span className="conversation-activity">
      {contact.lastSession.taskGoal}
    </span>
  ) : (
    <span className="conversation-activity muted">
      {t("conversation.open_workspace")}
    </span>
  );

  return (
    <div className={`conversation-row ${selected ? "active" : ""} ${contact.activeRun ? "has-activity" : ""}`}>
      <button
        className="conversation-row-inner"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(contact.id)}
      >
        <EmployeeAvatar
          employeeId={contact.id}
          running={Boolean(contact.activeRun)}
          tone={tone}
          size={40}
        />
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              <strong className="mono" translate="no">@{contact.id}</strong>
            </span>
            {stamp ? (
              <span className="conversation-stamp mono" title={status}>
                {stamp}
              </span>
            ) : null}
          </span>
          {activityLine}
          <span className="conversation-meta">
            <span className={`conversation-meta-status tone-${tone}`}>
              {t(`status.${status}`, { defaultValue: status })}
            </span>
            <span className="conversation-meta-sep" aria-hidden="true" />
            <span className="mono">{lastAgent ?? t("conversation.no_agent_yet")}</span>
            <span className="conversation-meta-sep" aria-hidden="true" />
            <span className="conversation-meta-count mono" aria-label={t("conversation.agent_running_aria")}>
              {sessionCountLabel}
            </span>
          </span>
        </span>
      </button>
      {onRemove ? (
        <button
          className="conversation-remove-btn"
          type="button"
          aria-label={t("conversation.remove", { id: contact.id })}
          title={t("conversation.remove", { id: contact.id })}
          onClick={handleRemove}
        >
          <ActionRemove size={11} />
        </button>
      ) : null}
    </div>
  );
}
