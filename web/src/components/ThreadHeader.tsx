import { useTranslation } from "react-i18next";
import type { AgentName, RelaySession } from "../types";
import { NavThreads } from "./icons";
import { ArtifactNavButton } from "./ArtifactNavButton";
import { Button } from "./ui/button";

// Thread header: session identity and refresh. The agent picker
// lives in the composer footer.
export function ThreadHeader({ activeSession, runningAgentDisplayName, isRefreshing, artifactCount, onOpenArtifacts, onRefresh, onBackToThreads }: {
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
  return (
    <header className="chat-header">
      <div className="chat-title">
        <Button variant="ghost" className="mobile-back-button" type="button" aria-label={t("nav.threads")} onClick={onBackToThreads}>
          <NavThreads size={16} /><span>{t("nav.threads")}</span>
        </Button>
        <div className="chat-title-text">
          <h2 title={activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : undefined}>{activeSession ? (activeSession.title?.trim() || activeSession.taskGoal) : t("thread.new_thread")}</h2>
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
