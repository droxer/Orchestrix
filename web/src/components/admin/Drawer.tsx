"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  variant?: "light" | "dark";
  width?: number;
  children: ReactNode;
  closeLabel: string;
  ariaLabel?: string;
  /** Stacking order — higher = on top. Used when multiple drawers open at once. */
  layer?: number;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  variant = "light",
  width = 480,
  children,
  closeLabel,
  ariaLabel,
  layer = 0,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panelRef.current)?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`adm-drawer-backdrop ${variant === "dark" ? "dark" : ""}`}
      style={{ zIndex: 1200 + layer }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`adm-drawer ${variant === "dark" ? "dark" : "light"}`}
        style={{ width }}
      >
        <header className="adm-drawer-head">
          <div className="adm-drawer-head-text">
            <h2 className="adm-drawer-title">{title}</h2>
            {subtitle ? <p className="adm-drawer-sub">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="adm-drawer-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="adm-drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
