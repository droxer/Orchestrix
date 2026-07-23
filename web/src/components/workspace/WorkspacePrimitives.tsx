"use client";

import type { ReactNode } from "react";

/* Shared workspace inspection primitives — the empty/loading/metric building
   blocks used by both AgentWorkspacePage and TeamWorkspacePage. Kept here so
   the two surfaces don't drift (they previously each declared their own). */

/** Centered empty state: an optional mark tile (any glyph the caller supplies,
 *  or a pulsing dot when `pulse`), a title, and an optional hint. */
export function WorkspaceEmpty({
  title,
  hint,
  mark,
  pulse = false,
}: {
  title: string;
  hint?: string;
  mark?: ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className="workspace-empty-state">
      {mark || pulse ? (
        <span
          className={`workspace-empty-state-mark${pulse ? " is-pulse" : ""}`}
          aria-hidden="true"
        >
          {mark}
        </span>
      ) : null}
      <p className="workspace-empty-state-title">{title}</p>
      {hint ? <p className="workspace-empty-state-hint">{hint}</p> : null}
    </div>
  );
}

export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <div className="workspace-loading-bar" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** One cell of the metric strip. `emphasis`/`live`/`zero` toggle the accent,
 *  live pulse, and dimmed-zero treatments respectively. */
export function MetricItem({
  label,
  value,
  emphasis = false,
  live = false,
  zero = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  live?: boolean;
  zero?: boolean;
}) {
  const classes = [
    "workspace-metric-item",
    emphasis ? "is-emphasis" : "",
    live ? "is-live" : "",
    zero ? "is-zero" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <strong className="mono">{value}</strong>
      <span>{label}</span>
    </div>
  );
}
