import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavConversations, NavNewThread, NavRefresh } from "./icons";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";
import { formatCompactTokens } from "../lib/tokenUsage";

// Chat-panel header: who/which agent/session identity, the per-agent tabs,
// session status pill, and the refresh control.
export function ChatHeader({ selectedEmployee, running, activeAgent, setActiveAgent, agentNames, disabledAgents, agentHealth, activeSession, isRefreshing, onRefresh, onBackToThreads, onNewThread }: {
  selectedEmployee: string;
  running: boolean;
  activeAgent: AgentName;
  setActiveAgent: Dispatch<SetStateAction<AgentName>>;
  agentNames: AgentName[];
  disabledAgents?: AgentName[];
  agentHealth?: Partial<Record<AgentName, "unknown" | "ready" | "failed">>;
  activeSession: RelaySession | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBackToThreads: () => void;
  onNewThread?: () => void;
}) {
  const disabledSet = new Set(disabledAgents ?? []);
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
          {agentNames.map((a) => {
            const isDisabled = disabledSet.has(a);
            const isFailed = agentHealth?.[a] === "failed";
            const isActive = a === activeAgent;
            const classes = [
              isActive ? "active" : "",
              isDisabled ? "agent-tab-disabled" : "",
              isFailed && !isDisabled ? "agent-tab-failed" : "",
            ].filter(Boolean).join(" ");
            const title = isDisabled
              ? t("thread.agent_disabled_title", { agent: a })
              : isFailed
                ? t("thread.agent_failed_title", { agent: a })
                : undefined;
            return (
              <button
                key={a}
                type="button"
                aria-pressed={isActive}
                aria-disabled={isDisabled || undefined}
                disabled={isDisabled}
                className={classes}
                title={title}
                onClick={() => { if (!isDisabled) setActiveAgent(a); }}
              >
                <span translate="no">@{a}</span>
              </button>
            );
          })}
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
