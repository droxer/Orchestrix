"use client";

import { Button } from "@/components/ui/button";
import { ActionCompose } from "./icons";

// Single empty-state for the task boards (Backlog + Routine). Previously each
// page shipped its own treatment — one with an illustration, one without — so
// sibling screens looked unrelated when empty. The illustration always shows;
// the CTA only renders when there's a create action and we're not in a
// filtered-but-empty state.
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
    <div className="backlog-board-empty">
      <div className="backlog-board-empty-inner">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
          <rect x="8" y="14" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-muted-soft" />
          <rect x="22" y="10" width="14" height="22" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-muted-soft" />
          <rect x="36" y="18" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-muted-soft" />
          <path d="M14 36h28" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" className="text-hairline" />
        </svg>
        <h3>{title}</h3>
        <p>{body}</p>
        {onCreate && createLabel ? (
          <Button className="mt-md" size="sm" onClick={onCreate}>
            <ActionCompose size={16} />
            {createLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
