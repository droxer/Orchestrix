"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { useModalDrawer } from "@/hooks/useModalDrawer";
import { readAnimationDurationMs } from "@/lib/animationDuration";
import { isDrawerTop, isDrawerUnderlay, registerDrawer, subscribeDrawerStack } from "@/lib/drawerStack";

/** Fallback exit duration when the panel's animation duration can't be read. */
const FALLBACK_CLOSE_MS = 150;

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
  const titleId = useId();
  const subtitleId = useId();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // Only the top of the drawer stack owns the keyboard; everything below is
  // an underlay — visually recessed and inert to Escape/Tab/AT.
  const top = useSyncExternalStore(subscribeDrawerStack, () => isDrawerTop(drawerId), () => true);
  const underlay = useSyncExternalStore(
    subscribeDrawerStack,
    () => isDrawerUnderlay(drawerId),
    () => false,
  );

  const panelRef = useModalDrawer<HTMLElement>(onClose, visible, top && !closing);

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
    }, readAnimationDurationMs(panelRef.current, FALLBACK_CLOSE_MS));
    return () => window.clearTimeout(timer);
  }, [open, visible, panelRef]);

  useEffect(() => {
    registerDrawer(drawerId, layer, visible);
    return () => registerDrawer(drawerId, layer, false);
  }, [drawerId, layer, visible]);

  // When a higher drawer opens, this panel becomes inert to AT — focus must
  // not stay inside it. The new top drawer's useModalDrawer autofocus runs in
  // the same commit, so release focus here only if it still points inside.
  useEffect(() => {
    if (!underlay) return;
    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (panel && active && panel.contains(active)) active.blur();
  }, [underlay, panelRef]);

  if (!visible || typeof document === "undefined") return null;

  const backdropClass = [
    "overlay-backdrop",
    "adm-drawer-backdrop",
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
        if (event.target === event.currentTarget && !closing && !underlay) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={underlay || closing ? undefined : true}
        aria-hidden={underlay || closing || undefined}
        inert={underlay || closing || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={panelClass}
        style={{ "--adm-drawer-w": `${width}px` } as React.CSSProperties}
      >
        <header className="adm-drawer-head">
          <div className="adm-drawer-head-text">
            {kicker ? <p className="adm-drawer-kicker">{kicker}</p> : null}
            <h2 id={titleId} className="adm-drawer-title">{title}</h2>
            {subtitle ? <p id={subtitleId} className="adm-drawer-sub">{subtitle}</p> : null}
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
