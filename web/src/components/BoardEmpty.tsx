"use client";

import { Button } from "@/components/ui/button";
import { RelayEmptyState } from "./RelayEmptyState";
import { ActionCompose, ICON_STROKE_LARGE } from "./icons";

function BoardEmptyIllustration() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
      <rect x="8" y="14" width="14" height="18" rx="2" stroke="currentColor" strokeWidth={ICON_STROKE_LARGE} />
      <rect x="22" y="10" width="14" height="22" rx="2" stroke="currentColor" strokeWidth={ICON_STROKE_LARGE} />
      <rect x="36" y="18" width="14" height="14" rx="2" stroke="currentColor" strokeWidth={ICON_STROKE_LARGE} />
      <path d="M14 36h28" stroke="currentColor" strokeWidth={ICON_STROKE_LARGE} strokeDasharray="3 2" opacity="0.55" />
    </svg>
  );
}

// Shared empty-state for task boards (Backlog + Routine).
export function BoardEmpty({
  title,
  body,
  createLabel,
  onCreate,
}: {
  title: string;
  body: string;
  createLabel?: string;
  onCreate?: () => void;
}) {
  return (
    <RelayEmptyState
      className="backlog-board-empty"
      fill
      title={title}
      body={body}
      illustration={<BoardEmptyIllustration />}
      actions={
        onCreate && createLabel ? (
          <Button size="sm" onClick={onCreate}>
            <ActionCompose size={16} />
            {createLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
