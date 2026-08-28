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
 *  the Button primitive (`icon` = --control-h, 44px, rounded-full); the `lg`
 *  tier above it is for hero CTAs, not for a header dismiss. `.overlay-close`
 *  only contributes color/hover/focus and the header offset. */
export function OverlayCloseButton({ label, onClick, className = "overlay-close" }: OverlayCloseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={cn("rounded-full", className)}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <ActionRemove size={ICON.md} aria-hidden="true" />
    </Button>
  );
}
