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
      className={`adm-dash-tile relay-enter relay-enter-delay-${enterDelay}${hero ? " adm-dash-tile--hero relay-atmosphere" : ""}`}
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
          {spark && spark.length > 1 ? <Sparkline values={spark} hero={hero} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Sparkline({ values, hero }: { values: number[]; hero?: boolean }) {
  const width = hero ? 140 : 72;
  const height = hero ? 32 : 20;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - (value / max) * height;
    return { x, y };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M ${points[0].x.toFixed(1)} ${height} ` +
    points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    ` L ${points[points.length - 1].x.toFixed(1)} ${height} Z`;
  return (
    <svg
      className="adm-dash-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {hero ? <path d={areaPath} fill="currentColor" opacity={0.12} /> : null}
      <polyline fill="none" stroke="currentColor" strokeWidth={hero ? 1.5 : 1.25} points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
      {hero ? null : <path d={linePath} fill="none" stroke="transparent" />}
    </svg>
  );
}
