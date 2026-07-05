"use client";

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useDialogs } from "@/components/ui/DialogProvider";

export function useUnsavedChangesGuard(enabled: boolean): () => Promise<boolean> {
  const { t } = useTranslation();
  const { confirm } = useDialogs();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  return useCallback(async () => {
    if (!enabled) return true;
    return confirm({
      title: t("unsaved.title"),
      message: t("unsaved.message"),
      confirmLabel: t("unsaved.confirm"),
      cancelLabel: t("dialog.cancel"),
      tone: "danger",
    });
  }, [confirm, enabled, t]);
}
