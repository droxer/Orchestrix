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
  return "neutral"; // provisioning, stopped — grey, not alarming
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
  const lastAgent =
    contact.lastSession?.agentRuns[contact.lastSession.agentRuns.length - 1]?.agent;
  function handleRemove() {
    if (!onRemove) return;
    if (window.confirm(t("conversation.remove_confirm", { id: contact.id }))) {
      onRemove(contact.id);
    }
  }

  return (
    // Wrapper div — keeps the remove button as a sibling of the row button (no nested buttons)
    <div className={`conversation-row ${selected ? "active" : ""} ${contact.activeRun ? "has-activity" : ""}`}>
      <button
        className="conversation-row-inner"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(contact.id)}
      >
        <EmployeeAvatar employeeId={contact.id} running={Boolean(contact.activeRun)} />
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              <span
                className={`status-dot status-dot-${statusTone(status)}`}
                aria-hidden="true"
              />
              <strong translate="no">{contact.id}</strong>
            </span>
            <span className="conversation-topline-actions">
              {contact.activeRun ? (
                <span className="conversation-badge mono" aria-label={t("conversation.agent_running_aria")}>
                  {Math.max(contact.sessionCount, 1)}
                </span>
              ) : (
                <span className="conversation-stamp mono">
                  {contact.sessionCount > 0
                    ? `${contact.sessionCount.toString().padStart(2, "0")}`
                    : t("conversation.no_sessions")}
                </span>
              )}
            </span>
          </span>
          <span className="conversation-preview">
            {contact.activeRun
              ? t("conversation.agent_working", { agent: contact.activeRun.agent })
              : (contact.lastSession?.taskGoal ?? t("conversation.open_workspace"))}
          </span>
          <span className="conversation-meta">
            <span className="conversation-meta-status">
              {t(`status.${status}`, { defaultValue: status })}
            </span>
            <span className="conversation-meta-sep" aria-hidden="true" />
            <span>{lastAgent ?? t("conversation.no_agent_yet")}</span>
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
