"use client";

import { ActionRemove } from "../icons";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type OverlayCloseButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

/** Shared dismiss control for drawers and centered modals. Geometry comes from
 *  the Button primitive (icon-lg = 36px, rounded-full); `.overlay-close` only
 *  contributes color/hover/focus and the header offset. */
export function OverlayCloseButton({ label, onClick, className = "overlay-close" }: OverlayCloseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      type="button"
      className={cn("rounded-full", className)}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <ActionRemove size={16} aria-hidden="true" />
    </Button>
  );
}
