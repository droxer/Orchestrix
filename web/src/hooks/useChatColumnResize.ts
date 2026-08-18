import { useEffect, useRef } from "react";

/** Long enough to clear the shell's --t-fast (120ms) grid-track transition.
 *  The guard must read a settled width: measured mid-transition it ratchets,
 *  because every intermediate frame reports a chat column narrower than the
 *  one the layout is heading for and the guard only ever shrinks. Measured at
 *  1040px, expanding the rail with the list at 480px drove the list to 284px
 *  instead of the correct 392px — three successive corrections against three
 *  transient widths, none of them the final one. */
const SETTLE_MS = 180;

/** Run `onColumnResize` whenever the chat column may have changed width.
 *
 *  A plain `window resize` listener misses the other two ways the column
 *  narrows: expanding the side rail, and dragging it. Both steal width from
 *  the transcript without the window ever changing size, so a window-only
 *  guard let those paths push the conversation under TRANSCRIPT_MIN_WIDTH
 *  with nothing to give the room back. The grid — not React — owns the real
 *  width, so observing the element itself is what catches all three causes.
 *
 *  The window listener is kept alongside the observer to cover the case where
 *  the chat column has not mounted yet (a non-thread route), where there is
 *  nothing to observe.
 *
 *  ONE YIELDER PER FLOOR. Only the thread list subscribes for the sidenav's
 *  sake — do not add the rail as a second guard on the same floor. Measured
 *  at 1040px with the list at its 480px max: expanding the rail made both
 *  panes yield at once, neither seeing the other's give, so the rail hit its
 *  180px minimum and the transcript overshot to 536px against a 420px floor.
 *  The pane the user just acted on is the one that lost. The rail keeps the
 *  width it was given; its ceiling is enforced at drag time instead, against
 *  the live chat width. */
export function useChatColumnResize(onColumnResize: () => void, enabled = true): void {
  // Held in a ref so the debounce timer survives the re-subscribe that every
  // width change triggers — restarting the effect must not drop a pending
  // correction, or a fast drag would leave the last one unapplied.
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const settle = () => {
      if (pendingRef.current !== null) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        onColumnResize();
      }, SETTLE_MS);
    };

    window.addEventListener("resize", settle);

    const chat = typeof document === "undefined" ? null : document.getElementById("chat-panel");
    // Guarded: the test environment and the prerender pass have no
    // ResizeObserver, and the window listener alone still holds there.
    const observer = chat && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(settle)
      : null;
    observer?.observe(chat!);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [enabled, onColumnResize]);

  // Only on unmount — a pending correction targets a pane that is going away.
  useEffect(() => () => {
    if (pendingRef.current !== null) clearTimeout(pendingRef.current);
  }, []);
}
