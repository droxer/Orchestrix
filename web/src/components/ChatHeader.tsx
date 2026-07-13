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
import { isLogicalAgentRoutable } from "../lib/agentDisplayNames";
import { formatCompactTokens } from "../lib/tokenUsage";
import { Button } from "./ui/button";

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
export function ChatHeader({ activeAgent, logicalAgents, activeLogicalAgentId, onLogicalAgentPicked, activeSession, runningAgent, runningAgentDisplayName, isRefreshing, artifactCount, onOpenArtifacts, onRefresh, onBackToThreads }: {
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  activeSession: RelaySession | undefined;
  runningAgent?: AgentName;
  runningAgentDisplayName?: string;
  isRefreshing: boolean;
  artifactCount: number;
  onOpenArtifacts: () => void;
  onRefresh: () => void;
  onBackToThreads: () => void;
}) {
  const { t, i18n } = useTranslation();
  const numberFormat = new Intl.NumberFormat(i18n.language || undefined);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tokenUsage = activeSession?.tokenUsage;
  const tokenUsageTitle = tokenUsage
    ? t("conversation.token_usage_title", {
        input: numberFormat.format(tokenUsage.input),
        output: numberFormat.format(tokenUsage.output),
        cache: numberFormat.format(tokenUsage.cache),
      })
    : "";
  const activity = activeSession
    ? conversationActivity(activeSession.status, runningAgent)
    : null;
  const showMeta = Boolean(activity || tokenUsage);
  const activeLogicalAgent = logicalAgents.find((agent) => agent.id === activeLogicalAgentId);
  const moveLogicalAgent = (direction: 1 | -1) => {
    const selectableAgents = logicalAgents.filter((agent) => isLogicalAgentRoutable(agent.availability));
    if (selectableAgents.length === 0) return;
    const current = selectableAgents.findIndex((agent) => agent.id === activeLogicalAgentId);
    const next = selectableAgents[(Math.max(current, 0) + direction + selectableAgents.length) % selectableAgents.length];
    onLogicalAgentPicked(next);
    requestAnimationFrame(() => {
      tabsRef.current?.querySelector<HTMLButtonElement>(`[data-logical-agent="${CSS.escape(next.id)}"]`)?.focus();
    });
  };
  return (
    <header className="chat-header">
      <div className="chat-title">
        <Button variant="ghost" className="mobile-back-button" type="button" aria-label={t("nav.conversations")} onClick={onBackToThreads}>
          <NavConversations size={16} /><span>{t("nav.conversations")}</span>
        </Button>
        <div className="chat-title-text">
          <h2 title={activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : undefined}>{activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : t("thread.new_conversation")}</h2>
          {showMeta ? (
            <div className="chat-title-meta">
              {activity ? (
                <Badge variant={ACTIVITY_BADGE[activity.kind]} className="chat-title-status">
                  {activity.kind === "working"
                    ? t(activity.labelKey, { agent: runningAgentDisplayName ?? runningAgent })
                    : t(activity.labelKey)}
                </Badge>
              ) : null}
              {tokenUsage ? (
                <span
                  className="chat-title-tokens mono"
                  title={tokenUsageTitle}
                  aria-label={tokenUsageTitle}
                >
                  {formatCompactTokens(tokenUsage.total, i18n.language)} {t("conversation.tokens_short")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="chat-tools">
        <div className="chat-active-agent" aria-label={t("thread.talk_to_agent")}>
          <AgentMark agent={activeAgent} size={16} className="chat-active-agent-mark" />
          <span className="mono" translate="no">{activeLogicalAgent?.displayName ?? activeAgent}</span>
        </div>
        <div className="header-agent-tabs segmented segmented--brand" role="radiogroup" aria-label={t("thread.talk_to_agent")} ref={tabsRef}>
          {logicalAgents.length > 0 ? logicalAgents.map((logicalAgent) => {
            const isRoutable = isLogicalAgentRoutable(logicalAgent.availability);
            const isBusy = logicalAgent.availability === "busy";
            const isActive = logicalAgent.id === activeLogicalAgentId;
            return (
              <Button variant="ghost"
                key={logicalAgent.id}
                type="button"
                role="radio"
                data-agent={logicalAgent.id}
                data-logical-agent={logicalAgent.id}
                data-availability={logicalAgent.availability}
                aria-checked={isActive}
                aria-disabled={!isRoutable || undefined}
                tabIndex={isActive ? 0 : -1}
                className={[
                  isActive ? "active" : "",
                  !isRoutable ? "agent-tab-disabled" : "",
                  isBusy && isRoutable ? "agent-tab-busy" : "",
                ].filter(Boolean).join(" ")}
                title={!isRoutable ? `${logicalAgent.displayName}: ${logicalAgent.availability}` : undefined}
                onClick={() => { if (isRoutable) onLogicalAgentPicked(logicalAgent); }}
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
                <AgentMark agent={logicalAgent.executorKind} size={16} className="header-agent-tab-mark" />
                <span translate="no">{logicalAgent.displayName}</span>
                {isBusy && isRoutable ? <span className="header-agent-busy-pip" aria-hidden="true" /> : null}
              </Button>
            );
          }) : <span className="text-muted-foreground">{t("thread.no_agents")}</span>}
        </div>
        <Button variant="ghost"
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
        </Button>
        <Button variant="ghost" className="icon-button" type="button" aria-label={t("nav.refresh")} title={t("nav.refresh")} onClick={onRefresh}>
          <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
        </Button>
      </div>
    </header>
  );
}
