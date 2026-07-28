"use client";

import { useTranslation } from "react-i18next";

/* The specimen rows preview real artifact kinds so the ghost list reads as
   a promise, not decoration — labels come from the shared kind i18n table. */
const GHOST_KINDS = ["plan", "review", "summary"] as const;

/** Empty state for an artifacts browse pane: three dashed ghost rows that
 *  mirror the anatomy of `.workspace-pick` artifact rows (kind tag · title
 *  bar · time slot), fading out downward, above the usual title + hint. */
export function ArtifactsEmpty({ title, hint }: { title: string; hint?: string }) {
  const { t } = useTranslation();
  return (
    <div className="artifacts-empty">
      <ul className="artifacts-empty-ghosts" aria-hidden="true">
        {GHOST_KINDS.map((kind) => (
          <li key={kind} className="artifacts-empty-ghost">
            <span className="artifacts-empty-tag">{t(`artifact.kind.${kind}`)}</span>
            <span className="artifacts-empty-line" />
            <span className="artifacts-empty-date tnum">··:··</span>
          </li>
        ))}
      </ul>
      <p className="workspace-empty-state-title">{title}</p>
      {hint ? <p className="workspace-empty-state-hint">{hint}</p> : null}
    </div>
  );
}
