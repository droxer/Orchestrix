import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, EmployeeAgent, RelaySession } from "../types";
import { NavConversations } from "./icons";
import { AgentMark } from "./AgentMark";
import { ArtifactNavButton } from "./ArtifactNavButton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
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

// Chat-panel header: session identity, status, agent picker, and refresh.
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
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language || undefined), [i18n.language]);
  const tokenUsage = activeSession?.tokenUsage;
  const tokenUsageTitle = tokenUsage
    ? t("conversation.token_usage_title", {
        input: numberFormat.format(tokenUsage.input),
        output: numberFormat.format(tokenUsage.output),
        cache: numberFormat.format(tokenUsage.cache),
      })
    : "";
  const activityRaw = activeSession
    ? conversationActivity(activeSession.status, runningAgent)
    : null;
  // "Completed" is settled noise in the chat header; keep working / waiting / failed / cancelled.
  const activity = activityRaw?.kind === "good" ? null : activityRaw;
  const showMeta = Boolean(activity || tokenUsage);
  const activeLogicalAgent = logicalAgents.find((agent) => agent.id === activeLogicalAgentId);
  const handleAgentSelected = (value: string | null) => {
    const next = logicalAgents.find((agent) => agent.id === value);
    if (next && isLogicalAgentRoutable(next.availability)) onLogicalAgentPicked(next);
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
        {logicalAgents.length > 0 ? (
          <Select value={activeLogicalAgentId} onValueChange={handleAgentSelected}>
            <SelectTrigger size="sm" className="chat-agent-select" aria-label={t("thread.talk_to_agent")}>
              <AgentMark
                agent={activeLogicalAgent?.executorKind ?? activeAgent}
                size={16}
                className="chat-active-agent-mark"
              />
              <span className="chat-agent-select-name" translate="no">
                {activeLogicalAgent?.displayName ?? activeAgent}
              </span>
              {activeLogicalAgent?.availability === "busy" ? (
                <span className="header-agent-busy-pip" aria-hidden="true" />
              ) : null}
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {logicalAgents.map((logicalAgent) => {
                const isRoutable = isLogicalAgentRoutable(logicalAgent.availability);
                const isBusy = logicalAgent.availability === "busy";
                // Non-routable agents stay listed (disabled) with their
                // availability spelled out so users can see why an agent
                // cannot take the conversation.
                const availabilityLabel = !isRoutable
                  ? t(`admin.v2.placement_status.${logicalAgent.availability}`, {
                      defaultValue: logicalAgent.availability,
                    })
                  : null;
                return (
                  <SelectItem
                    key={logicalAgent.id}
                    value={logicalAgent.id}
                    disabled={!isRoutable}
                    data-availability={logicalAgent.availability}
                  >
                    <AgentMark agent={logicalAgent.executorKind} size={16} className="chat-agent-option-mark" />
                    <span translate="no">{logicalAgent.displayName}</span>
                    {availabilityLabel ? (
                      <span className="chat-agent-option-availability">{availabilityLabel}</span>
                    ) : null}
                    {isBusy ? <span className="header-agent-busy-pip" aria-hidden="true" /> : null}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground">{t("thread.no_agents")}</span>
        )}
        <ArtifactNavButton
          artifactCount={artifactCount}
          hasSession={Boolean(activeSession)}
          isRefreshing={isRefreshing}
          onOpenArtifacts={onOpenArtifacts}
          onRefresh={onRefresh}
          artifactsClassName="icon-button chat-artifacts-button"
        />
      </div>
    </header>
  );
}
