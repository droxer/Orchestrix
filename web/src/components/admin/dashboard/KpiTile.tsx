"use client";

import type { ReactNode } from "react";

interface KpiTileProps {
  eyebrow: string;
  value: ReactNode;
  hero?: boolean;
  enterIndex?: number;
  delta?: {
    label: string;
    direction: "up" | "down" | "flat";
  };
  hint?: string;
  spark?: number[];
}

export function KpiTile({ eyebrow, value, hero, enterIndex = 0, delta, hint, spark }: KpiTileProps) {
  const hasFoot = Boolean(delta || hint || (spark && spark.length > 1));
  const enterDelay = Math.min(enterIndex + 1, 4);
  return (
    <div
      className={`adm-dash-tile relay-enter relay-enter-delay-${enterDelay}${hero ? " adm-dash-tile--hero" : ""}`}
    >
      <div className="adm-dash-tile-eyebrow">{eyebrow}</div>
      <div className="adm-dash-tile-value mono">{value}</div>
      {hasFoot ? (
        <div className="adm-dash-tile-foot">
          {delta ? (
            <span className={`adm-dash-delta tone-${delta.direction}`}>
              <span aria-hidden="true">
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"}
              </span>
              <span>{delta.label}</span>
            </span>
          ) : hint ? (
            <span className="adm-dash-tile-hint">{hint}</span>
          ) : null}
          {spark && spark.length > 1 ? <Sparkline values={spark} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 96;
  const height = 24;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - (value / max) * height;
    return { x, y };
  });
  return (
    <svg
      className="adm-dash-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth={1.25} points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
    </svg>
  );
}
