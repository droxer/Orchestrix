"use client";

import { useEffect, useRef } from "react";
import { createShortcutResolver, isCommandMenuChord, type ShortcutAction } from "@/lib/shortcuts";

/* App-wide keyboard layer. All suppression rules funnel through here:
   a modal dialog/drawer (anything aria-modal) owns the screen, and while one
   of our own overlays is open only its toggle chord still reaches us —
   the overlay handles the rest of its keys itself. */

export function useGlobalShortcuts({
  isAdmin,
  overlayOpen,
  onAction,
}: {
  isAdmin: boolean;
  /** True while the command menu or shortcuts help is open. */
  overlayOpen: boolean;
  onAction: (action: ShortcutAction) => void;
}) {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;

  const resolverRef = useRef<ReturnType<typeof createShortcutResolver> | null>(null);
  const resolverAdminRef = useRef<boolean | null>(null);
  if (resolverRef.current === null || resolverAdminRef.current !== isAdmin) {
    resolverRef.current = createShortcutResolver({ isAdmin });
    resolverAdminRef.current = isAdmin;
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (overlayOpenRef.current) {
        // The overlay's own toggle chord still works from inside it
        // (its text field is an editable target, which the resolver would
        // otherwise rightly ignore).
        if (isCommandMenuChord(event)) {
          event.preventDefault();
          onActionRef.current({ kind: "command-menu" });
        }
        return;
      }
      // A dialog, drawer, or the preferences sheet owns the keyboard. Both
      // spellings are needed: base-ui sets `aria-modal` on a true modal, but
      // a focus-trapping non-modal popup (the thread space panel at its
      // takeover width) is marked only by the primitive's own slot.
      if (document.querySelector('[aria-modal="true"], [data-slot="dialog-content"]')) return;
      const action = resolverRef.current?.(event) ?? null;
      if (!action) return;
      if (action.kind === "command-menu") event.preventDefault();
      onActionRef.current(action);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
