"use client";

import { useTranslation } from "react-i18next";
import type { AdminView } from "./AdminViewToggle";

interface PulseStripProps {
  view: AdminView;
  running: number;
  failed: number;
  queued: number;
  unassignedNodes: number;
}

type Tone = "neutral" | "good" | "info" | "bad";

interface PulseCell {
  key: string;
  value: number;
  label: string;
  tone: Tone;
}

export function PulseStrip({
  view,
  running,
  failed,
  queued,
  unassignedNodes,
}: PulseStripProps) {
  const { t } = useTranslation();

  const cells: PulseCell[] =
    view === "employees"
      ? [
          { key: "unassigned", value: unassignedNodes, label: t("admin.metric_unassigned"), tone: "neutral" },
          { key: "running", value: running, label: t("admin.metric_running"), tone: "neutral" },
          { key: "failed", value: failed, label: t("admin.metric_failed"), tone: failed > 0 ? "bad" : "neutral" },
        ]
      : [
          { key: "running", value: running, label: t("admin.metric_running"), tone: "neutral" },
          { key: "failed", value: failed, label: t("admin.metric_failed"), tone: failed > 0 ? "bad" : "neutral" },
          { key: "queued", value: queued, label: t("admin.metric_queued"), tone: "neutral" },
        ];

  const ariaLabel =
    view === "employees"
      ? t("admin.v2.pulse_employees_label")
      : t("admin.v2.pulse_fleet_label");

  return (
    <div className="adm-pulse adm-pulse--alerts" role="group" aria-label={ariaLabel}>
      {cells.map((cell) => (
        <div key={cell.key} className="adm-pulse-cell">
          <span className={`adm-pulse-value mono tone-${cell.tone}`}>{cell.value}</span>
          <span className="adm-pulse-label">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}
