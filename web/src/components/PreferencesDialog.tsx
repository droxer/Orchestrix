"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { PreferencesPanel, type PreferencesPanelProps } from "./PreferencesPanel";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/dialog";

export type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: PreferencesPanelProps;
};

/**
 * Preferences, on the shared Dialog primitive. The panel inside is a Tabs
 * root; the modal contract around it — Escape, the focus trap, autofocus on
 * the active category, focus restore, and holding the panel in the DOM for
 * its exit animation — comes from the primitive.
 */
export function PreferencesDialog({ open, onClose, preferences }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="pref-backdrop" />
        <DialogViewport className="pref-viewport">
          <DialogContent
            ref={panelRef}
            className="pref-modal"
            aria-labelledby="pref-dialog-title"
            aria-describedby="pref-dialog-sub"
            /* Opens on the active category, the same `[data-modal-initial-focus]`
               convention the drawers use — otherwise focus lands on the close
               button, which is the one control nobody opened this to reach. */
            initialFocus={() =>
              panelRef.current?.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? true
            }
          >
            <header className="pref-header">
              <div className="pref-header-text">
                <DialogTitle id="pref-dialog-title" render={<h2 />}>
                  {t("pref.title")}
                </DialogTitle>
                <DialogDescription
                  id="pref-dialog-sub"
                  className="pref-header-sub"
                  render={<span />}
                >
                  {t("pref.sub")}
                </DialogDescription>
              </div>
              <OverlayCloseButton
                label={t("pref.close")}
                onClick={onClose}
                className="overlay-close pref-close"
              />
            </header>

            <PreferencesPanel {...preferences} />
          </DialogContent>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
}
