import { Plus } from "lucide-react";
import { EmployeeAvatar } from "./EmployeeAvatar";
import type { DaemonNodeMonitorRecord, SandboxRecord, RelaySession, Tone } from "../types";

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
  return "warn";
}

type ConversationRowProps = {
  contact: EmployeeContact;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function ConversationRow({ contact, selected, onSelect }: ConversationRowProps) {
  const status = contact.sandbox?.status ?? "provisioning";
  const lastAgent =
    contact.lastSession?.agentRuns[contact.lastSession.agentRuns.length - 1]?.agent;
  return (
    <button
      className={`conversation-row ${selected ? "active" : ""} ${contact.activeRun ? "has-activity" : ""}`}
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
          {contact.activeRun ? (
            <span className="conversation-badge mono" aria-label="Agent running">
              {Math.max(contact.sessionCount, 1)}
            </span>
          ) : (
            <span className="conversation-stamp mono">
              {contact.sessionCount > 0
                ? `${contact.sessionCount.toString().padStart(2, "0")}`
                : "—"}
            </span>
          )}
        </span>
        <span className="conversation-preview">
          {contact.activeRun
            ? `${contact.activeRun.agent} is working`
            : (contact.lastSession?.taskGoal ?? "Open their agent workspace")}
        </span>
        <span className="conversation-meta">
          <span className="conversation-meta-status">{status}</span>
          <span className="conversation-meta-sep" aria-hidden="true" />
          <span>{lastAgent ?? "no agent yet"}</span>
        </span>
      </span>
    </button>
  );
}

type NewConversationRowProps = { employeeQuery: string; onSelect: (id: string) => void };

export function NewConversationRow({ employeeQuery, onSelect }: NewConversationRowProps) {
  return (
    <button
      className="conversation-row conversation-row-new"
      type="button"
      onClick={() => onSelect(employeeQuery)}
    >
      <span className="conversation-new-avatar" aria-hidden="true">
        <Plus size={16} />
      </span>
      <span className="conversation-copy">
        <span className="conversation-topline">
          <span className="conversation-name">
            <strong>Start @{employeeQuery || "new-employee"}</strong>
          </span>
        </span>
        <span className="conversation-preview">
          Create a sandbox-backed employee conversation.
        </span>
      </span>
    </button>
  );
}
