import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, EmployeeAgent, RelaySession } from "../types";
import { NavConversations, NavRefresh, StreamAttachment } from "./icons";
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
export function ChatHeader({ activeAgent, logicalAgents, activeLogicalAgentId, onLogicalAgentPicked, activeSession, runningAgent, isRefreshing, artifactCount, onOpenArtifacts, onRefresh, onBackToThreads }: {
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  activeSession: RelaySession | undefined;
  runningAgent?: AgentName;
  isRefreshing: boolean;
  artifactCount: number;
  onOpenArtifacts: () => void;
  onRefresh: () => void;
  onBackToThreads: () => void;
}) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
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
  const activeLogicalAgent = logicalAgents.find((agent) => agent.id === activeLogicalAgentId);
  const moveLogicalAgent = (direction: 1 | -1) => {
    const readyAgents = logicalAgents.filter((agent) => agent.availability === "ready");
    if (readyAgents.length === 0) return;
    const current = readyAgents.findIndex((agent) => agent.id === activeLogicalAgentId);
    const next = readyAgents[(Math.max(current, 0) + direction + readyAgents.length) % readyAgents.length];
    onLogicalAgentPicked(next);
    requestAnimationFrame(() => {
      tabsRef.current?.querySelector<HTMLButtonElement>(`[data-logical-agent="${CSS.escape(next.id)}"]`)?.focus();
    });
  };
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
          <span className="mono" translate="no">{activeLogicalAgent?.displayName ?? activeAgent}</span>
        </div>
        <div className="header-agent-tabs" role="radiogroup" aria-label={t("thread.talk_to_agent")} ref={tabsRef}>
          {logicalAgents.length > 0 ? logicalAgents.map((logicalAgent) => {
            const isReady = logicalAgent.availability === "ready";
            const isActive = logicalAgent.id === activeLogicalAgentId;
            return (
              <button
                key={logicalAgent.id}
                type="button"
                role="radio"
                data-agent={logicalAgent.id}
                data-logical-agent={logicalAgent.id}
                aria-checked={isActive}
                aria-disabled={!isReady || undefined}
                tabIndex={isActive ? 0 : -1}
                className={[isActive ? "active" : "", !isReady ? "agent-tab-disabled" : ""].filter(Boolean).join(" ")}
                title={!isReady ? `${logicalAgent.displayName}: ${logicalAgent.availability}` : undefined}
                onClick={() => { if (isReady) onLogicalAgentPicked(logicalAgent); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveLogicalAgent(1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveLogicalAgent(-1);
                  }
                }}
              >
                <AgentMark agent={logicalAgent.executorKind} size={14} className="header-agent-tab-mark" />
                <span translate="no">{logicalAgent.displayName}</span>
              </button>
            );
          }) : <span className="text-muted-foreground">{t("thread.no_agents")}</span>}
        </div>
        <button
          className="icon-button chat-artifacts-button"
          type="button"
          aria-label={t("artifact.open_drawer")}
          title={t("artifact.open_drawer")}
          disabled={!activeSession}
          onClick={onOpenArtifacts}
        >
          <StreamAttachment size={16} />
          {artifactCount > 0 ? (
            <span className="chat-artifacts-count mono" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
              {artifactCount}
            </span>
          ) : null}
        </button>
        <button className="icon-button" type="button" aria-label={t("nav.refresh")} title={t("nav.refresh")} onClick={onRefresh}>
          <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}
