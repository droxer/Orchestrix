"use client";

import { ActionRemove } from "../icons";
import { Button } from "./button";

type OverlayCloseButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

/** Shared dismiss control for drawers and centered modals. */
export function OverlayCloseButton({ label, onClick, className = "overlay-close" }: OverlayCloseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <ActionRemove size={16} aria-hidden="true" />
    </Button>
  );
}
