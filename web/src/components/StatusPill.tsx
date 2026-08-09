import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import type { Tone } from "../types";
import type { StatusValue } from "../lib/threadStatus";
import { statusTone } from "../lib/statusTone";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

export type TonePillProps = {
  tone: Tone;
  label: string;
  /** Active-work pulse: --live dot + pulse-ring at the --t-pulse cadence. */
  live?: boolean;
  title?: string;
  className?: string;
};

export function TonePill({ tone, label, live = false, title, className }: TonePillProps) {
  // Bad states drop out of the brightness race: a bright --err fill is
  // byte-identical to --action white and reads as "primary/selected" rather
  // than "problem". Render the shared hollow ring (.dot-ring) instead — the
  // same shape the node presence + node status dots use.
  //
  // Live states are the one place a status dot earns --live, and palette.css
  // legislates the pairing: --live is legal only where --t-pulse is used, so
  // the dot fill, the pulse tint, and the cadence move together.
  const ringBad = tone === "bad";
  return (
    <Badge variant={TONE_VARIANT[tone]} title={title} className={cn("before:content-none", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          ringBad ? "dot-ring" : live ? "bg-[var(--live)]" : DOT_TONE[tone],
          live && "animate-[pulse-ring_var(--t-pulse)_var(--ease)_infinite]",
        )}
        style={live ? ({ "--pulse-color": "var(--live)" } as CSSProperties) : undefined}
      />
      {label}
    </Badge>
  );
}

type StatusPillProps = { value: StatusValue };

export function StatusPill({ value }: StatusPillProps) {
  const { t } = useTranslation();
  return (
    <TonePill
      tone={statusTone(value)}
      label={t(`status.${value}`, { defaultValue: value })}
      live={value === "running" || value === "busy"}
    />
  );
}
