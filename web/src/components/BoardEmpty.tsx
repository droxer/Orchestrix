"use client";

import { Button } from "@/components/ui/button";
import { ActionCompose } from "./icons";
import { RelayDoodleOrbit } from "./marginalia";

// Shared empty-state for task boards (Backlog + Routine). Left-aligned,
// inline with the page's normal content column — no centered icon block.
export function BoardEmpty({
  title,
  body,
  createLabel,
  onCreate,
  clearLabel,
  onClear,
}: {
  title: string;
  body: string;
  createLabel?: string;
  onCreate?: () => void;
  clearLabel?: string;
  onClear?: () => void;
}) {
  return (
    <div className="backlog-board-empty relay-marginalia-host">
      <span className="relay-empty-marginalia" aria-hidden="true">
        <RelayDoodleOrbit />
      </span>
      <h2 className="relay-empty-title">{title}</h2>
      <p className="backlog-board-empty-body relay-empty-body">{body}</p>
      {onCreate && createLabel ? (
        <Button size="sm" onClick={onCreate}>
          <ActionCompose size={14} />
          {createLabel}
        </Button>
      ) : onClear && clearLabel ? (
        <Button size="sm" variant="ghost" onClick={onClear}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}
