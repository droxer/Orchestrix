import { useEffect, useRef } from "react";
import { acquireBodyScrollLock } from "@/lib/bodyScrollLock";

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Wires the modal contract for a hand-rolled `role="dialog" aria-modal="true"`
 * panel: Escape-to-close, a Tab focus trap, autofocus on the first field,
 * return-focus to the trigger, and a body scroll lock. Attach the returned ref
 * to the panel element.
 *
 * `enabled` tracks visibility — scroll lock, focus capture, and focus return
 * run when the overlay opens or closes for good. `active` tracks keyboard
 * ownership (top of an overlay stack) — only the active layer listens for
 * Escape/Tab, so stacked overlays don't all close on one Escape or fight over
 * focus. `active` defaults to true for single-overlay callers.
 */
export function useModalDrawer<T extends HTMLElement>(onClose: () => void, enabled = true, active = true) {
  const panelRef = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Hold onClose in a ref so the effects don't re-run when callers pass a
  // fresh inline arrow each render — re-running would yank focus back to the
  // first field on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Visibility lifecycle: scroll lock + trigger focus capture/return. Kept
  // separate from keyboard ownership so a stacked overlay closing above this
  // one doesn't overwrite (or prematurely restore) the trigger reference.
  useEffect(() => {
    if (!enabled) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const releaseScrollLock = acquireBodyScrollLock();
    return () => {
      releaseScrollLock();
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
    };
  }, [enabled]);

  // Keyboard ownership: autofocus, Escape, Tab trap.
  useEffect(() => {
    if (!enabled || !active) return;
    const panel = panelRef.current;
    const preferContainer = window.matchMedia("(pointer: coarse)").matches;
    const preferred = preferContainer
      ? null
      : panel?.querySelector<HTMLElement>("[data-modal-initial-focus]");
    (preferred ?? panel)?.focus();

    function handleKey(event: KeyboardEvent) {
      // Confirm/prompt dialogs and portalled Radix overlays own the keyboard while open; defer.
      if (
        document.querySelector(
          '.dialog-backdrop, [data-slot="select-content"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }

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
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (activeEl === first || !panelRef.current.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [enabled, active]);

  return panelRef;
}
