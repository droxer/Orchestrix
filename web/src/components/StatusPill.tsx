import { useTranslation } from "react-i18next";
import type { Tone } from "../types";
import { Badge } from "@/components/ui/badge";

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  return "warn";
}

export { statusTone };

// Map the app's status tone vocabulary onto the shadcn Badge tone variants.
const TONE_VARIANT: Record<Tone, "success" | "info" | "danger" | "warning" | "neutral"> = {
  good: "success",
  info: "info",
  bad: "danger",
  warn: "warning",
  neutral: "neutral",
};

type StatusPillProps = { value: string };

export function StatusPill({ value }: StatusPillProps) {
  const { t } = useTranslation();
  return (
    <Badge variant={TONE_VARIANT[statusTone(value)]}>
      {t(`status.${value}`, { defaultValue: value })}
    </Badge>
  );
}
