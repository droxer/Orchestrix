"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { readAnimationDurationMs } from "@/lib/animationDuration";
import { PreferencesPanel, type PreferencesPanelProps } from "./PreferencesPanel";
import { useModalDrawer } from "../hooks/useModalDrawer";

export type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: PreferencesPanelProps;
};

export function PreferencesDialog({ open, onClose, preferences }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);
  const dialogRef = useModalDrawer<HTMLDivElement>(onClose, visible, !closing);

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
    }, readAnimationDurationMs(dialogRef.current));
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`overlay-backdrop pref-backdrop${closing ? " is-closing" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (!closing && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pref-dialog-title"
        aria-describedby="pref-dialog-sub"
        tabIndex={-1}
        className={`pref-modal${closing ? " is-closing" : ""}`}
        inert={closing || undefined}
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
