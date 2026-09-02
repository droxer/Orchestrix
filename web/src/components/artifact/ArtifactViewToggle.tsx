"use client";

import { useTranslation } from "react-i18next";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
    /* A toggle group, not tabs and not radios: this switches which reading of
       one body is on screen, and nothing is submitted. `value` is an array
       because a toggle group can be multi-select; this one is not, so it holds
       exactly the active view, and an attempt to unpress the active item is
       ignored rather than leaving no view at all. */
    <ToggleGroup
      className={`code-view-toolbar${className ? ` ${className}` : ""}`}
      aria-label={t("artifact.view_mode")}
      value={[view]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onChange(picked as ArtifactView);
      }}
    >
      <ToggleGroupItem
        value="preview"
        className={`code-view-toggle${isPreview ? " is-active" : ""}`}
      >
        {t("artifact.view_preview")}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="source"
        className={`code-view-toggle${isPreview ? "" : " is-active"}`}
      >
        {t("artifact.view_source")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
