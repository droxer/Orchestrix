import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavThreads } from "./icons";
import { ArtifactNavButton } from "./ArtifactNavButton";
import { Badge } from "@/components/ui/badge";
import {
  threadActivity,
  type ThreadActivityKind,
} from "../lib/threadActivity";
import { Button } from "./ui/button";

const ACTIVITY_BADGE: Record<
  ThreadActivityKind,
  "success" | "info" | "danger" | "warning" | "neutral"
> = {
  working: "info",
  warn: "warning",
  bad: "danger",
  good: "success",
  neutral: "neutral",
};

// Thread header: session identity, status, and refresh. The agent picker
// lives in the composer footer.
export function ThreadHeader({ activeSession, runningAgent, runningAgentDisplayName, isRefreshing, artifactCount, onOpenArtifacts, onRefresh, onBackToThreads }: {
  activeSession: RelaySession | undefined;
  runningAgent?: AgentName;
  runningAgentDisplayName?: string;
  isRefreshing: boolean;
  artifactCount: number;
  onOpenArtifacts: () => void;
  onRefresh: () => void;
  onBackToThreads: () => void;
}) {
  const { t } = useTranslation();
  const activityRaw = activeSession
    ? threadActivity(activeSession.status, runningAgent)
    : null;
  // The settled "completed" badge is noise under the title — the transcript
  // itself shows the run finished. Live and attention states stay.
  const activity = activityRaw && activityRaw.kind !== "good" ? activityRaw : null;
  const showMeta = Boolean(activity);
  return (
    <header className="chat-header">
      <div className="chat-title">
        <Button variant="ghost" className="mobile-back-button" type="button" aria-label={t("nav.threads")} onClick={onBackToThreads}>
          <NavThreads size={16} /><span>{t("nav.threads")}</span>
        </Button>
        <div className="chat-title-text">
          <h2 title={activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : undefined}>{activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : t("thread.new_thread")}</h2>
          {showMeta ? (
            <div className="chat-title-meta">
              {activity ? (
                <Badge variant={ACTIVITY_BADGE[activity.kind]} className="chat-title-status">
                  {activity.kind === "working"
                    ? t(activity.labelKey, { agent: runningAgentDisplayName ?? runningAgent })
                    : t(activity.labelKey)}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="chat-tools">
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
