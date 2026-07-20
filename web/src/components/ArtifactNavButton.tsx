"use client";

import { useTranslation } from "react-i18next";
import { NavRefresh, StreamAttachment } from "./icons";
import { Button } from "./ui/button";

// Artifact drawer trigger (with count badge) + refresh — shared by the chat
// header and the mobile topbar so the two copies can't drift.
export function ArtifactNavButton({ artifactCount, hasSession, isRefreshing, onOpenArtifacts, onRefresh, artifactsClassName = "icon-button" }: {
  artifactCount: number;
  hasSession: boolean;
  isRefreshing: boolean;
  onOpenArtifacts: () => void;
  onRefresh: () => void;
  artifactsClassName?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        variant="ghost"
        className={artifactsClassName}
        type="button"
        aria-label={t("artifact.open_drawer")}
        title={t("artifact.open_drawer")}
        disabled={!hasSession}
        onClick={onOpenArtifacts}
      >
        <StreamAttachment size={16} />
        {artifactCount > 0 ? (
          <span className="chat-artifacts-count mono" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
            {artifactCount}
          </span>
        ) : null}
      </Button>
      <Button
        variant="ghost"
        className="icon-button"
        type="button"
        aria-label={t("nav.refresh")}
        title={t("nav.refresh")}
        onClick={onRefresh}
      >
        <NavRefresh size={16} className={isRefreshing ? "spin" : ""} />
      </Button>
    </>
  );
}
