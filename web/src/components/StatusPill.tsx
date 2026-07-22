import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import type { Tone } from "../types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running" || value === "busy") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  if (value === "offline") return "neutral";
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

// Explicit dot element (replaces the badge's `before:` pseudo-dot) so live
// states can carry the shared pulse-ring motion used across the app.
const DOT_TONE: Record<Tone, string> = {
  good: "bg-success",
  info: "bg-info",
  bad: "bg-danger",
  warn: "bg-warning",
  neutral: "bg-muted-soft",
};

const DOT_PULSE_COLOR: Record<Tone, string> = {
  good: "var(--ok)",
  info: "var(--info)",
  bad: "var(--err)",
  warn: "var(--warn)",
  neutral: "var(--ink-4)",
};

type StatusPillProps = { value: string };

export function StatusPill({ value }: StatusPillProps) {
  const { t } = useTranslation();
  const tone = statusTone(value);
  const live = value === "running" || value === "busy";
  return (
    <Badge variant={TONE_VARIANT[tone]} className="before:content-none">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT_TONE[tone],
          live && "animate-[pulse-ring_1.6s_var(--ease)_infinite]",
        )}
        style={
          live
            ? ({ "--pulse-color": DOT_PULSE_COLOR[tone] } as CSSProperties)
            : undefined
        }
      />
      {t(`status.${value}`, { defaultValue: value })}
    </Badge>
  );
}
