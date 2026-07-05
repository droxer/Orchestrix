"use client";

import { useCallback } from "react";
import { useDialogs } from "@/components/ui/DialogProvider";

export function useMutationError() {
  const { announce } = useDialogs();

  const reportMutationError = useCallback((context: string, error: unknown, message: string): void => {
    console.error(context, error);
    announce({ message, tone: "error" });
  }, [announce]);

  return { reportMutationError };
}
