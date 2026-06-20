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
  /** Extra class on the scroll body — e.g. to opt into a flex-column layout
   *  so a form footer can anchor to the bottom of the panel. */
  bodyClassName?: string;
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
  bodyClassName,
  layer = 0,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Hold onClose in a ref so the focus-trap effect can depend on [open] alone.
  // Callers commonly pass a fresh inline arrow each render; depending on it here
  // would re-run the effect on every keystroke and steal focus back to the
  // first focusable element (the ✕ button).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const initial = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? panelRef.current)?.focus();

    function handleKey(event: KeyboardEvent) {
      // A Radix Select/Popover/Dropdown renders its content in a portal on
      // document.body — outside this panel. While one is open it owns the
      // keyboard (Escape closes the dropdown, arrows/Tab navigate it), so we
      // must defer entirely. Otherwise Escape would close the whole drawer and
      // the focus trap below would yank focus out of the open listbox.
      const overlayOpen = document.querySelector(
        '[data-slot="select-content"], [data-radix-popper-content-wrapper]',
      );
      if (overlayOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
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
  }, [open]);

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
        style={{ "--adm-drawer-w": `${width}px` } as React.CSSProperties}
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
        <div className={`adm-drawer-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
