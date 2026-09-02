"use client";

import {
  ActionRemove,
  ICON,
} from "../icons";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type OverlayCloseButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

/** Shared dismiss control for drawers and centered modals. Geometry comes from
 *  the Button primitive (`icon` = --control-h, 44px, --r-2 corners); the `lg`
 *  tier above it is for hero CTAs, not for a header dismiss. `.overlay-close`
 *  only contributes color/hover/focus and the header offset. The old
 *  `rounded-full` override is gone — a dismiss is a control, and it now takes
 *  the same corner as every other icon button instead of a disc. */
export function OverlayCloseButton({ label, onClick, className = "overlay-close" }: OverlayCloseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={cn(className)}
      tooltip={label}
      onClick={onClick}
    >
      <ActionRemove size={ICON.md} aria-hidden="true" />
    </Button>
  );
}
