"use client";

import { Button } from "@/components/ui/button";
import {
  ActionCompose,
  ICON,
} from "./icons";
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
    <div className="backlog-board-empty relay-marginalia-host relay-plate">
      <span className="relay-empty-marginalia" aria-hidden="true">
        <RelayDoodleOrbit />
      </span>
      <h2 className="relay-empty-title">{title}</h2>
      <p className="backlog-board-empty-body relay-empty-body">{body}</p>
      {onCreate && createLabel ? (
        // The board's one move earns the full 40px default tier — same as
        // every other empty-state primary; the clear action stays demoted.
        <Button onClick={onCreate}>
          <ActionCompose size={ICON.sm} />
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
