import { useTranslation } from "react-i18next";
import type { Tone } from "../types";

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  return "warn";
}

export { statusTone };

type StatusPillProps = { value: string };

export function StatusPill({ value }: StatusPillProps) {
  const { t } = useTranslation();
  return (
    <span className={`pill ${statusTone(value)}`}>
      {t(`status.${value}`, { defaultValue: value })}
    </span>
  );
}
