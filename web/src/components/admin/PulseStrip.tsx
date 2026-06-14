"use client";

import { useTranslation } from "react-i18next";

interface PulseStripProps {
  nodes: number;
  employees: number;
  ready: number;
  running: number;
  failed: number;
  queued: number;
}

const TONE: Record<keyof PulseStripProps, "neutral" | "good" | "info" | "bad"> = {
  nodes: "neutral",
  employees: "neutral",
  ready: "good",
  running: "info",
  failed: "bad",
  queued: "neutral",
};

export function PulseStrip(props: PulseStripProps) {
  const { t } = useTranslation();
  const cells: Array<{ key: keyof PulseStripProps; label: string }> = [
    { key: "nodes", label: t("admin.metric_nodes") },
    { key: "employees", label: t("admin.metric_employees") },
    { key: "ready", label: t("admin.metric_ready") },
    { key: "running", label: t("admin.metric_running") },
    { key: "failed", label: t("admin.metric_failed") },
    { key: "queued", label: t("admin.metric_queued") },
  ];

  return (
    <div className="adm-pulse" role="group" aria-label={t("admin.v2.pulse_label")}>
      {cells.map((cell) => (
        <div key={cell.key} className="adm-pulse-cell">
          <span className={`adm-pulse-value mono tone-${TONE[cell.key]}`}>{props[cell.key]}</span>
          <span className="adm-pulse-label">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}
