"use client";

import { Button } from "@/components/ui/button";
import { ActionCompose } from "./icons";

// Shared empty-state for task boards (Backlog + Routine). Left-aligned,
// inline with the page's normal content column — no centered icon block.
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
      <h2 className="relay-empty-title">{title}</h2>
      <p className="backlog-board-empty-body relay-empty-body">{body}</p>
      {onCreate && createLabel ? (
        <Button size="sm" onClick={onCreate}>
          <ActionCompose size={14} />
          {createLabel}
        </Button>
      ) : null}
    </div>
  );
}
