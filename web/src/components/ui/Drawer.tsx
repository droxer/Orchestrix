"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { useModalDrawer } from "@/hooks/useModalDrawer";
import { readAnimationDurationMs } from "@/lib/animationDuration";
import { isDrawerTop, isDrawerUnderlay, registerDrawer, subscribeDrawerStack } from "@/lib/drawerStack";

/** Fallback exit duration when the panel's animation duration can't be read. */
const FALLBACK_CLOSE_MS = 150;

/** Named panel widths — call sites pick a role, not a pixel count, so drawer
 *  sizing stays consistent across the app. `form` for single-column edit
 *  forms, `detail` for read/inspect panels, `wide` for preview panes. */
const DRAWER_WIDTHS = {
  form: 460,
  detail: 520,
  wide: 900,
} as const;

export type DrawerWidth = keyof typeof DRAWER_WIDTHS;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Render the subtitle in the mono face — for ID/handle subtitles. */
  subtitleMono?: boolean;
  kicker?: ReactNode;
  /** Named width role, or an explicit pixel width for one-off layouts. */
  width?: DrawerWidth | number;
  children: ReactNode;
  closeLabel: string;
  /** Accessible name override. Defaults to `title` when it is a string. */
  ariaLabel?: string;
  /** Extra class on the scroll body — e.g. to opt into a flex-column layout
   *  so a form footer can anchor to the bottom of the panel. */
  bodyClassName?: string;
  /** Stacking order — higher = on top. Used when multiple drawers open at once. */
  layer?: number;
  /** Called once the exit animation completes and the panel has left the DOM.
   *  Lets parents defer unmounting form state until the close has fully played. */
  onClosed?: () => void;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  subtitleMono = false,
  kicker,
  width = "detail",
  children,
  closeLabel,
  ariaLabel,
  bodyClassName,
  layer = 0,
  onClosed,
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

  // Hold onClosed in a ref so a fresh inline arrow from the caller doesn't
  // restart the exit timer on every render.
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
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
      onClosedRef.current?.();
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

  const resolvedWidth = typeof width === "number" ? width : DRAWER_WIDTHS[width];
  const resolvedAriaLabel = ariaLabel ?? (typeof title === "string" ? title : undefined);

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
        aria-label={resolvedAriaLabel}
        aria-labelledby={resolvedAriaLabel ? undefined : titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={panelClass}
        style={{ "--adm-drawer-w": `${resolvedWidth}px` } as React.CSSProperties}
      >
        <header className="adm-drawer-head">
          <div className="adm-drawer-head-text">
            {kicker ? <p className="adm-drawer-kicker">{kicker}</p> : null}
            <h2 id={titleId} className="adm-drawer-title">{title}</h2>
            {subtitle ? (
              <p id={subtitleId} className={`adm-drawer-sub${subtitleMono ? " adm-drawer-sub--mono" : ""}`}>
                {subtitle}
              </p>
            ) : null}
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
