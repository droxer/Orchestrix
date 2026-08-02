"use client";

import { useTranslation } from "react-i18next";
import { StreamAttachment } from "./icons";
import { Button } from "./ui/button";

export function ArtifactNavButton({ artifactCount, onOpenArtifacts, className = "icon-button" }: {
  artifactCount: number;
  onOpenArtifacts: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  if (artifactCount === 0) return null;

  return (
    <Button
      variant="ghost"
      className={className}
      type="button"
      aria-label={t("artifact.open_drawer")}
      title={t("artifact.open_drawer")}
      onClick={onOpenArtifacts}
    >
      <StreamAttachment size={16} />
      <span className="chat-artifacts-count tnum" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
        {artifactCount}
      </span>
    </Button>
  );
}
