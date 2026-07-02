"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ActionCompose, NavRefresh } from "./icons";

/** Refresh + primary create actions shared by Backlog and Routine headers. */
export function TaskBoardHeaderActions({
  refreshLabel,
  createLabel,
  isRefreshing,
  onRefresh,
  onCreate,
  leading,
}: {
  refreshLabel: string;
  createLabel: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  leading?: ReactNode;
}) {
  return (
    <>
      {leading}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={refreshLabel}
        disabled={isRefreshing}
        onClick={onRefresh}
      >
        <NavRefresh size={16} />
      </Button>
      <Button type="button" onClick={onCreate}>
        <ActionCompose size={16} />
        <span>{createLabel}</span>
      </Button>
    </>
  );
}
