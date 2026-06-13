"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActionRemove } from "./icons";
import { Button } from "@/components/ui/button";
import { SandboxesPanel, type SandboxesPanelProps } from "./SandboxesPanel";

export type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  sandboxes: SandboxesPanelProps;
};

export function SettingsDrawer({ open, onClose, sandboxes }: SettingsDrawerProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const selectedLabel = sandboxes.selectedEmployee
    ? `@${sandboxes.selectedEmployee}`
    : t("thread.no_employee_selected");

  return (
    <aside
      id="settings-drawer"
      ref={dialogRef}
      tabIndex={-1}
      className="settings-drawer"
      aria-labelledby="settings-title"
    >
      <div className="settings-header">
        <div>
          <p className="eyebrow">{t("nav.sandboxes")}</p>
          <h3
            id="settings-title"
            translate={sandboxes.selectedEmployee ? "no" : undefined}
          >
            {selectedLabel}
          </h3>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("settings.close")} onClick={onClose}>
          <ActionRemove size={16} />
        </Button>
      </div>

      <div className="settings-tab-panel" role="region" aria-label={t("nav.sandboxes")}>
        <SandboxesPanel {...sandboxes} />
      </div>
    </aside>
  );
}
