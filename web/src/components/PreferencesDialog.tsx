"use client";

import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { PreferencesPanel, type PreferencesPanelProps } from "./PreferencesPanel";
import { useModalDrawer } from "../hooks/useModalDrawer";

export type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: PreferencesPanelProps;
};

export function PreferencesDialog({ open, onClose, preferences }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useModalDrawer<HTMLDivElement>(onClose, open);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="overlay-backdrop pref-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pref-dialog-title"
        aria-describedby="pref-dialog-sub"
        tabIndex={-1}
        className="pref-modal"
      >
        <header className="pref-header">
          <div className="pref-header-text">
            <h2 id="pref-dialog-title">{t("pref.title")}</h2>
            <span id="pref-dialog-sub" className="pref-header-sub">
              {t("pref.sub")}
            </span>
          </div>
          <OverlayCloseButton label={t("pref.close")} onClick={onClose} className="overlay-close pref-close" />
        </header>

        <PreferencesPanel {...preferences} />
      </div>
    </div>,
    document.body,
  );
}
