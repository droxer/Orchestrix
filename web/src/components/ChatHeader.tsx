import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavConversations, NavNewThread, NavRefresh } from "./icons";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";
import { formatCompactTokens } from "../lib/tokenUsage";

// Chat-panel header: who/which agent/session identity, the per-agent tabs,
// session status pill, and the refresh control.
export function ChatHeader({ selectedEmployee, running, activeAgent, setActiveAgent, agentNames, activeSession, isRefreshing, onRefresh, onBackToThreads, onNewThread }: {
  selectedEmployee: string;
  running: boolean;
  activeAgent: AgentName;
  setActiveAgent: Dispatch<SetStateAction<AgentName>>;
  agentNames: AgentName[];
  activeSession: RelaySession | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBackToThreads: () => void;
  onNewThread?: () => void;
}) {
  const { t } = useTranslation();
  const tokenUsage = activeSession?.tokenUsage;
  const tokenUsageTitle = tokenUsage
    ? t("conversation.token_usage_title", {
        input: tokenUsage.input.toLocaleString(),
        output: tokenUsage.output.toLocaleString(),
        cache: tokenUsage.cache.toLocaleString(),
      })
    : "";
  return (
    <header className="chat-header">
      <div className="chat-title">
        <button className="mobile-back-button" type="button" onClick={onBackToThreads}>
          <NavConversations size={16} /><span>{t("nav.conversations")}</span>
        </button>
        <EmployeeAvatar employeeId={selectedEmployee} running={running} />
        <div className="chat-title-text">
          <p className="chat-title-meta">
            {selectedEmployee ? (
              <span translate="no">@{selectedEmployee}</span>
            ) : (
              <span>{t("thread.no_employee_selected")}</span>
            )}
            {activeSession ? (
              <span className="chat-title-status">
                <StatusPill value={activeSession.status} />
              </span>
            ) : null}
            {tokenUsage ? (
              <span
                className="chat-title-tokens mono"
                title={tokenUsageTitle}
                aria-label={tokenUsageTitle}
              >
                {formatCompactTokens(tokenUsage.total)} {t("conversation.tokens_short")}
              </span>
            ) : null}
          </p>
          <h2>{activeSession ? activeSession.taskGoal : t("thread.new_conversation")}</h2>
        </div>
      </div>
      <div className="chat-tools">
        <div className="header-agent-tabs" aria-label={t("thread.talk_to_agent")}>
          {agentNames.map((a) => <button key={a} type="button" aria-pressed={a === activeAgent} className={a === activeAgent ? "active" : ""} onClick={() => setActiveAgent(a)}><span translate="no">@{a}</span></button>)}
        </div>
        {activeSession && onNewThread ? (
          <button className="icon-button" type="button" aria-label={t("thread.new_thread")} title={t("thread.new_thread")} onClick={onNewThread}>
            <NavNewThread size={16} />
          </button>
        ) : null}
        <button className="icon-button" type="button" aria-label={t("nav.refresh")} title={t("nav.refresh")} onClick={onRefresh}>
          <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}
