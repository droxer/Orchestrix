"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { isDrawerUnderlay, registerDrawer, subscribeDrawerStack } from "@/lib/drawerStack";

/** Exit animation duration — keep in sync with admin-v2-drawers.css. */
const DRAWER_CLOSE_MS = 150;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: ReactNode;
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

function layerBackdropClass(layer: number): string {
  if (layer <= 0) return "";
  return ` adm-drawer-backdrop--layer-${Math.min(layer, 3)}`;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  kicker,
  width = 520,
  children,
  closeLabel,
  ariaLabel,
  bodyClassName,
  layer = 0,
}: DrawerProps) {
  const drawerId = useRef(Symbol("drawer")).current;
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  const underlay = useSyncExternalStore(
    subscribeDrawerStack,
    () => isDrawerUnderlay(drawerId),
    () => false,
  );

  // Hold onClose in a ref so the focus-trap effect can depend on [open] alone.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, DRAWER_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    registerDrawer(drawerId, layer, visible && !closing);
    return () => registerDrawer(drawerId, layer, false);
  }, [drawerId, layer, visible, closing]);

  useEffect(() => {
    if (!visible) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || closing) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const initial = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? panelRef.current)?.focus();

    function handleKey(event: KeyboardEvent) {
      const overlayOpen = document.querySelector(
        '.dialog-backdrop, [data-slot="select-content"], [data-radix-popper-content-wrapper]',
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
    return () => {
      document.removeEventListener("keydown", handleKey);
      previouslyFocused.current?.focus?.();
    };
  }, [visible, closing]);

  if (!visible || typeof document === "undefined") return null;

  const backdropClass = [
    "overlay-backdrop",
    "adm-drawer-backdrop",
    layerBackdropClass(layer),
    closing ? "is-closing" : "",
    underlay ? "is-underlay" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const panelClass = ["adm-drawer", closing ? "is-closing" : ""].filter(Boolean).join(" ");

  return createPortal(
    <div
      className={backdropClass}
      style={{ zIndex: `calc(var(--z-drawer) + ${layer})` }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closing) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={panelClass}
        style={{ "--adm-drawer-w": `${width}px` } as React.CSSProperties}
      >
        <header className="adm-drawer-head">
          <div className="adm-drawer-head-text">
            {kicker ? <p className="adm-drawer-kicker">{kicker}</p> : null}
            <h2 className="adm-drawer-title">{title}</h2>
            {subtitle ? <p className="adm-drawer-sub">{subtitle}</p> : null}
          </div>
          <OverlayCloseButton
            label={closeLabel}
            onClick={onClose}
            className="overlay-close adm-drawer-close"
          />
        </header>
        <div className={`adm-drawer-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
