import { useEffect, useRef, useState, type RefObject } from "react";
import { readAnimationDurationMs } from "@/lib/animationDuration";

/** Fallback exit duration when the panel's animation duration can't be read. */
const FALLBACK_CLOSE_MS = 150;

/**
 * Shared open/close visibility machine for overlay surfaces (Drawer,
 * PreferencesDialog). `visible` keeps the panel mounted through the exit
 * animation; `closing` drives the exit class. `onClosed` fires once the panel
 * has left the DOM so callers can release form state only after the close has
 * fully played. Both surfaces read the exit duration from the same panel ref,
 * so their timing can't drift.
 */
export function useOverlayVisibility(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClosed?: () => void,
) {
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

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

  return { visible, closing };
}
