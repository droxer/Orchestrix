import { useEffect, useRef } from "react";

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Wires the modal contract for a hand-rolled `role="dialog" aria-modal="true"`
 * panel: Escape-to-close, a Tab focus trap, autofocus on the first field,
 * return-focus to the trigger on unmount, and a body scroll lock. Attach the
 * returned ref to the panel element. Mirrors the behaviour in
 * `components/admin/Drawer.tsx` so the three drawers stay consistent.
 */
export function useModalDrawer<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const panelRef = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Hold onClose in a ref so the effect can depend on [] alone — callers pass a
  // fresh inline arrow each render, and re-running the effect would yank focus
  // back to the first field on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const initial = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? panelRef.current)?.focus();

    function handleKey(event: KeyboardEvent) {
      // A portalled Radix Select/Popover owns the keyboard while open; defer.
      if (document.querySelector('[data-slot="select-content"], [data-radix-popper-content-wrapper]')) return;

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
  }, [enabled]);

  return panelRef;
}
