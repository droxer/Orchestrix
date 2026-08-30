"use client";

import { useTranslation } from "react-i18next";
import {
  ICON,
  ThreadSpaceToggle,
} from "./icons";
import { Button } from "@/components/ui/button";

/** Opens the thread output panel. A named control, not a bare glyph: the panel
 *  now holds two things (the project's files and the thread's own output), and
 *  an unlabelled icon named neither. The count is an inline chip on the pill —
 *  the old corner badge was a notification dot on a control that opens a place,
 *  and it collided with the icon at small sizes. Below the tablet breakpoint
 *  responsive.css drops the label back to the icon, where the top bar has no
 *  room for words. */
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
      variant="ghost"
      size="sm"
      className={`chat-artifacts-button${className ? ` ${className}` : ""}`}
      type="button"
      aria-label={t("space.toggle")}
      title={t("space.toggle")}
      aria-expanded={expanded ?? false}
      disabled={disabled}
      onClick={onOpenArtifacts}
    >
      <ThreadSpaceToggle size={ICON.md} />
      <span className="chat-artifacts-label">{t("space.title")}</span>
      {artifactCount > 0 ? (
        <span className="chat-artifacts-count tnum" aria-label={t("artifact.drawer_subtitle", { count: artifactCount })}>
          {artifactCount}
        </span>
      ) : null}
    </Button>
  );
}
