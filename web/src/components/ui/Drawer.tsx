"use client";

import { useId, useRef, type ReactNode } from "react";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/dialog";

/** Named panel widths — call sites pick a role, not a pixel count, so drawer
 *  sizing stays consistent across the app. `form` for single-column edit
 *  forms, `detail` for read/inspect panels, `wide` for preview panes. `task`
 *  and `routine` are the task-board drawer's two variants (routine needs room
 *  for its schedule fields). */
const DRAWER_WIDTHS = {
  form: 460,
  detail: 520,
  task: 560,
  routine: 600,
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

/**
 * The app's side panel, on the shared Dialog primitive.
 *
 * Everything this component used to do by hand — Escape, the Tab trap,
 * autofocus, focus restore, the body scroll lock, holding the panel in the
 * DOM for its exit animation, and tracking which of several open drawers owns
 * the keyboard — now comes from base-ui. What is left here is the drawer's
 * own shape: a named width, a header with kicker/title/subtitle, and a
 * scrolling body.
 *
 * Stacking still takes a `layer`, because the z-index has to beat the sibling
 * backdrops, but the UNDERLAY treatment is no longer computed: base-ui marks
 * a popup with `data-nested-dialog-open` when a drawer opens above it, and
 * admin-v2-drawers.css recesses it from there.
 */
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
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const resolvedWidth = typeof width === "number" ? width : DRAWER_WIDTHS[width];
  const resolvedAriaLabel = ariaLabel ?? (typeof title === "string" ? title : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
    >
      <DialogPortal>
        <DialogBackdrop
          className="adm-drawer-backdrop"
          style={{ zIndex: `calc(var(--z-drawer) + ${layer})` }}
        />
        <DialogViewport
          className="adm-drawer-viewport"
          style={{ zIndex: `calc(var(--z-drawer) + ${layer})` }}
        >
          <DialogContent
            ref={panelRef}
            render={<aside />}
            className="adm-drawer"
            aria-label={resolvedAriaLabel}
            aria-labelledby={resolvedAriaLabel ? undefined : titleId}
            aria-describedby={subtitle ? subtitleId : undefined}
            style={{ "--adm-drawer-w": `${resolvedWidth}px` } as React.CSSProperties}
            /* `[data-modal-initial-focus]` stays the call-site convention —
               eight drawers mark their first meaningful field with it. What
               changed is who reads it: the primitive, through this prop,
               instead of a hand-rolled trap.
               A coarse pointer keeps focus on the panel, because focusing a
               field there throws up the on-screen keyboard over the drawer
               the moment it opens. */
            initialFocus={(openType) =>
              openType === "touch"
                ? true
                : panelRef.current?.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? true
            }
          >
            <header className="adm-drawer-head">
              <div className="adm-drawer-head-text">
                {kicker ? <p className="adm-drawer-kicker">{kicker}</p> : null}
                <DialogTitle id={titleId} className="adm-drawer-title" render={<h2 />}>
                  {title}
                </DialogTitle>
                {subtitle ? (
                  <DialogDescription
                    id={subtitleId}
                    className={`adm-drawer-sub${subtitleMono ? " adm-drawer-sub--mono" : ""}`}
                    translate={subtitleMono ? "no" : undefined}
                    render={<p />}
                  >
                    {subtitle}
                  </DialogDescription>
                ) : null}
              </div>
              <OverlayCloseButton
                label={closeLabel}
                onClick={onClose}
                className="overlay-close"
              />
            </header>
            <div className={`adm-drawer-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
          </DialogContent>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
}
