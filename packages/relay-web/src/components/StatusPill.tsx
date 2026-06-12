import { Badge } from "@/components/ui/badge";
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
  return (
    <Badge variant="outline" className={`pill ${statusTone(value)}`}>
      {value}
    </Badge>
  );
}
