import { useTranslation } from "react-i18next";
import type { EmployeeAgent, RelaySession } from "../types";
import { NavThreads } from "./icons";
import { ArtifactNavButton } from "./ArtifactNavButton";
import { IdentityMonogram } from "./IdentityMonogram";
import { ProfileImage } from "./ProfileImagePicker";
import { Button } from "@/components/ui/button";

export function ThreadHeader({ activeSession, participants, artifactCount, spaceOpen, threadListHidden, onToggleSpace, onToggleThreadList, onBackToThreads }: {
  activeSession: RelaySession | undefined;
  /** Agents in the room, in join order. Shown only once a thread has more
   *  than one — a solo thread already names its agent in the composer. */
  participants?: EmployeeAgent[];
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
      {participants && participants.length > 1 ? (
        <div className="chat-participants" aria-label={t("thread.participants")}>
          {participants.map((participant) => (
            <span key={participant.id} className="chat-participant" title={participant.displayName}>
              <ProfileImage
                src={participant.profileImageUrl}
                alt=""
                fallback={<IdentityMonogram name={participant.displayName} size={8} />}
                className="chat-participant-mark"
              />
              <span translate="no">{participant.displayName}</span>
            </span>
          ))}
        </div>
      ) : null}
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
