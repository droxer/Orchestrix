"use client";

import { useTranslation } from "react-i18next";

/** Which reading of an artifact body is on screen: the rendered presentation
 *  (Markdown, HTML document, diff, terminal) or its raw source text. */
export type ArtifactView = "preview" | "source";

/** Preview/Source switch for artifacts that have both readings. Reuses the
 *  workspace file viewer's toolbar classes so the two surfaces stay one
 *  control, not two lookalikes. */
export function ArtifactViewToggle({
  view,
  onChange,
  className,
}: {
  view: ArtifactView;
  onChange: (view: ArtifactView) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const isPreview = view === "preview";
  return (
    <div
      className={`code-view-toolbar${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={t("artifact.view_mode")}
    >
      <button
        type="button"
        className={`code-view-toggle${isPreview ? " is-active" : ""}`}
        aria-pressed={isPreview}
        onClick={() => onChange("preview")}
      >
        {t("artifact.view_preview")}
      </button>
      <button
        type="button"
        className={`code-view-toggle${isPreview ? "" : " is-active"}`}
        aria-pressed={!isPreview}
        onClick={() => onChange("source")}
      >
        {t("artifact.view_source")}
      </button>
    </div>
  );
}
