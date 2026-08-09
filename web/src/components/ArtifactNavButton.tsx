"use client";

import { useTranslation } from "react-i18next";
import { StreamAttachment } from "./icons";
import { Button } from "@/components/ui/button";

export function ArtifactNavButton({ artifactCount, onOpenArtifacts, expanded, disabled, className }: {
  artifactCount: number;
  onOpenArtifacts: () => void;
  expanded?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Button
      variant="icon"
      size="icon-r"
      className={className}
      type="button"
      aria-label={t("space.toggle")}
      title={t("space.toggle")}
      aria-expanded={expanded ?? false}
      disabled={disabled}
      onClick={onOpenArtifacts}
    >
      <StreamAttachment size={16} />
      {artifactCount > 0 ? (
        <span className="chat-artifacts-count tnum" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
          {artifactCount}
        </span>
      ) : null}
    </Button>
  );
}
