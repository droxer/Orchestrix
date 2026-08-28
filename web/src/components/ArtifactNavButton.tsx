"use client";

import { useTranslation } from "react-i18next";
import {
  ICON,
  ThreadSpaceToggle,
} from "./icons";
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
      size="icon"
      className={className}
      type="button"
      aria-label={t("space.toggle")}
      title={t("space.toggle")}
      aria-expanded={expanded ?? false}
      disabled={disabled}
      onClick={onOpenArtifacts}
    >
      <ThreadSpaceToggle size={ICON.md} />
      {artifactCount > 0 ? (
        <span className="chat-artifacts-count tnum" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
          {artifactCount}
        </span>
      ) : null}
    </Button>
  );
}
