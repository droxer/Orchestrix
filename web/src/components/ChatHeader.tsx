import { useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavConversations, NavRefresh } from "./icons";
import { AgentMark } from "./AgentMark";
import { Badge } from "@/components/ui/badge";
import {
  conversationActivity,
  type ConversationActivityKind,
} from "../lib/conversationActivity";
import { formatCompactTokens } from "../lib/tokenUsage";

const ACTIVITY_BADGE: Record<
  ConversationActivityKind,
  "success" | "info" | "danger" | "warning" | "neutral"
> = {
  working: "info",
  warn: "warning",
  bad: "danger",
  good: "success",
  neutral: "neutral",
};

// Chat-panel header: session identity, status, agent tabs, and refresh.
export function ChatHeader({ activeAgent, setActiveAgent, agentNames, disabledAgents, agentHealth, activeSession, runningAgent, isRefreshing, onRefresh, onBackToThreads }: {
  activeAgent: AgentName;
  setActiveAgent: Dispatch<SetStateAction<AgentName>>;
  agentNames: AgentName[];
  disabledAgents?: AgentName[];
  agentHealth?: Partial<Record<AgentName, "unknown" | "ready" | "failed">>;
  activeSession: RelaySession | undefined;
  runningAgent?: AgentName;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBackToThreads: () => void;
}) {
  const disabledSet = new Set(disabledAgents ?? []);
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
  // Single-select radiogroup: only enabled agents participate in arrow-key
  // navigation, and exactly one radio is in the tab order (roving tabindex).
  const enabledAgents = agentNames.filter((a) => !disabledSet.has(a));
  const rovingAgent = !disabledSet.has(activeAgent) ? activeAgent : enabledAgents[0];
  const moveActive = (dir: 1 | -1) => {
    if (enabledAgents.length === 0) return;
    const current = enabledAgents.indexOf(rovingAgent);
    const base = current === -1 ? 0 : current;
    const next = enabledAgents[(base + dir + enabledAgents.length) % enabledAgents.length];
    setActiveAgent(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-agent="${next}"]`)?.focus();
  };
  const tokenUsage = activeSession?.tokenUsage;
  const tokenUsageTitle = tokenUsage
    ? t("conversation.token_usage_title", {
        input: tokenUsage.input.toLocaleString(),
        output: tokenUsage.output.toLocaleString(),
        cache: tokenUsage.cache.toLocaleString(),
      })
    : "";
  const activity = activeSession
    ? conversationActivity(activeSession.status, runningAgent)
    : null;
  const showMeta = Boolean(activity || tokenUsage);
  return (
    <header className="chat-header">
      <div className="chat-title">
        <button className="mobile-back-button" type="button" onClick={onBackToThreads}>
          <NavConversations size={16} /><span>{t("nav.conversations")}</span>
        </button>
        <div className="chat-title-text">
          <h2 title={activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : undefined}>{activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : t("thread.new_conversation")}</h2>
          {showMeta ? (
            <div className="chat-title-meta">
              {activity ? (
                <Badge variant={ACTIVITY_BADGE[activity.kind]} className="chat-title-status">
                  {activity.kind === "working"
                    ? t(activity.labelKey, { agent: runningAgent })
                    : t(activity.labelKey)}
                </Badge>
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
            </div>
          ) : null}
        </div>
      </div>
      <div className="chat-tools">
        <div className="chat-active-agent" aria-label={t("thread.talk_to_agent")}>
          <AgentMark agent={activeAgent} size={14} className="chat-active-agent-mark" />
          <span className="mono" translate="no">{activeAgent}</span>
        </div>
        <div className="header-agent-tabs" role="radiogroup" aria-label={t("thread.talk_to_agent")} ref={tabsRef}>
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
                role="radio"
                data-agent={a}
                aria-checked={isActive}
                aria-disabled={isDisabled || undefined}
                tabIndex={a === rovingAgent ? 0 : -1}
                className={classes}
                title={title}
                onClick={() => { if (!isDisabled) setActiveAgent(a); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
                  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
                }}
              >
                <AgentMark agent={a} size={14} className="header-agent-tab-mark" />
                <span translate="no">{a}</span>
              </button>
            );
          })}
        </div>
        <button className="icon-button" type="button" aria-label={t("nav.refresh")} title={t("nav.refresh")} onClick={onRefresh}>
          <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}
