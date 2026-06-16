import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavConversations, NavRefresh } from "./icons";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";

// Chat-panel header: who/which agent/session identity, the per-agent tabs,
// session status pill, and the refresh control.
export function ChatHeader({ selectedEmployee, running, activeAgent, setActiveAgent, agentNames, activeSession, isRefreshing, onRefresh, onBackToThreads }: {
  selectedEmployee: string;
  running: boolean;
  activeAgent: AgentName;
  setActiveAgent: Dispatch<SetStateAction<AgentName>>;
  agentNames: AgentName[];
  activeSession: RelaySession | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBackToThreads: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="chat-header">
      <div className="chat-title">
        <button className="mobile-back-button" type="button" onClick={onBackToThreads}>
          <NavConversations size={16} /><span>{t("nav.conversations")}</span>
        </button>
        <EmployeeAvatar employeeId={selectedEmployee} running={running} />
        <div>
          <p>
            {selectedEmployee ? (
              <span translate="no">@{selectedEmployee}</span>
            ) : (
              <span>{t("thread.no_employee_selected")}</span>
            )}
            <span className="header-separator" aria-hidden="true" />
            <span translate="no">{activeAgent}</span>
            {activeSession ? <><span className="header-separator" aria-hidden="true" /><span className="session-id">{activeSession.id.slice(0, 8)}</span></> : null}
          </p>
          <h2>{activeSession ? activeSession.taskGoal : t("thread.new_conversation")}</h2>
        </div>
      </div>
      <div className="chat-tools">
        <div className="header-agent-tabs" aria-label={t("thread.talk_to_agent")}>
          {agentNames.map((a) => <button key={a} type="button" aria-pressed={a === activeAgent} className={a === activeAgent ? "active" : ""} onClick={() => setActiveAgent(a)}><span translate="no">@{a}</span></button>)}
        </div>
        {activeSession ? <StatusPill value={activeSession.status} /> : null}
        <button className="icon-button" type="button" aria-label={t("nav.refresh")} title={t("nav.refresh")} onClick={onRefresh}>
          <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}
