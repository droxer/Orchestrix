import { useTranslation } from "react-i18next";
import type { RelaySession } from "../types";
import { NavThreads } from "./icons";
import { ArtifactNavButton } from "./ArtifactNavButton";
import { Button } from "@/components/ui/button";

export function ThreadHeader({ activeSession, artifactCount, spaceOpen, threadListHidden, onToggleSpace, onToggleThreadList, onBackToThreads }: {
  activeSession: RelaySession | undefined;
  artifactCount: number;
  spaceOpen: boolean;
  threadListHidden: boolean;
  onToggleSpace: () => void;
  onToggleThreadList: () => void;
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
        {spaceOpen ? (
          <Button
            variant="icon"
            size="icon-r"
            type="button"
            className="chat-threadlist-button"
            aria-label={t("space.toggle_threads")}
            title={t("space.toggle_threads")}
            aria-expanded={!threadListHidden}
            onClick={onToggleThreadList}
          >
            <NavThreads size={16} />
          </Button>
        ) : null}
        <ArtifactNavButton
          artifactCount={artifactCount}
          onOpenArtifacts={onToggleSpace}
          expanded={spaceOpen}
          disabled={!activeSession}
          className="chat-artifacts-button"
        />
      </div>
    </header>
  );
}
