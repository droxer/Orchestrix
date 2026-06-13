"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ActionRemove } from "./icons";
import { Button } from "@/components/ui/button";
import { PreferencesPanel, type PreferencesPanelProps } from "./PreferencesPanel";

export type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: PreferencesPanelProps;
};

export function PreferencesDialog({ open, onClose, preferences }: PreferencesDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pref-backdrop"
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
            <h3 id="pref-dialog-title">{t("pref.title")}</h3>
            <span id="pref-dialog-sub" className="pref-header-sub">
              {t("pref.sub")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="pref-close"
            aria-label={t("pref.close")}
            onClick={onClose}
          >
            <ActionRemove size={16} />
          </Button>
        </header>

        <PreferencesPanel {...preferences} />
      </div>
    </div>,
    document.body,
  );
}
