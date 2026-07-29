"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

interface DailyPoint {
  date: string;
  count: number;
  completed: number;
  failed: number;
}

interface ActivityChartProps {
  daily: DailyPoint[];
  ready: boolean;
  className?: string;
}

const WIDTH = 720;
const HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 24, left: 32 };

export function ActivityChart({ daily, ready, className }: ActivityChartProps) {
  const { t, i18n } = useTranslation();
  const lineRef = useRef<SVGPathElement>(null);
  const [lineLength, setLineLength] = useState(0);

  const { areaPath, linePath, gridLines, xTicks, yTicks, max } = useMemo(() => {
    const points = (daily?.length ?? 0) > 0 ? daily! : Array.from({ length: 14 }, (_, i) => ({
      date: `d${i}`,
      count: 0,
      completed: 0,
      failed: 0,
    }));

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const max = Math.max(...points.map((p) => p.count), 4);
    const step = innerW / Math.max(points.length - 1, 1);

    const coords = points.map((p, i) => {
      const x = PADDING.left + i * step;
      const y = PADDING.top + innerH - (p.count / max) * innerH;
      return { x, y };
    });

    const linePath = coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(" ");

    const first = coords[0];
    const last = coords[coords.length - 1];
    const baselineY = PADDING.top + innerH;
    const areaPath =
      `M ${first.x.toFixed(1)} ${baselineY.toFixed(1)} ` +
      coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ") +
      ` L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => PADDING.top + innerH - f * innerH);
    const yTicks = [0, 0.5, 1].map((f) => ({
      y: PADDING.top + innerH - f * innerH,
      value: Math.round(f * max),
    }));
    const tickIndices = points.length > 7 ? [0, Math.floor(points.length / 2), points.length - 1] : points.map((_, i) => i);
    const xTicks = tickIndices.map((i) => {
      const c = coords[i];
      const label = formatDate(points[i].date, i18n.language);
      return { x: c.x, label };
    });

    return { areaPath, linePath, gridLines, xTicks, yTicks, max };
  }, [daily, i18n.language]);

  useEffect(() => {
    const path = lineRef.current;
    if (!path) return;
    setLineLength(path.getTotalLength());
  }, [linePath]);

  return (
    <section className={`adm-dash-card adm-dash-card--chart${className ? ` ${className}` : ""}`}>
      <header className="adm-dash-card-head">
        <h2 className="adm-dash-card-title">{t("admin.v2.dash_sessions_title")}</h2>
      </header>
      <svg
        className="adm-dash-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("admin.v2.dash_sessions_title")}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="adm-dash-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink-3)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--ink-3)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y}
            y2={y}
            stroke="var(--line-2)"
            strokeWidth={1}
            strokeDasharray={i === gridLines.length - 1 ? "0" : "2 3"}
          />
        ))}
        <path d={areaPath} fill="url(#adm-dash-area)" className="adm-dash-chart-area" />
        <path
          ref={lineRef}
          d={linePath}
          fill="none"
          stroke="var(--ink-2)"
          strokeWidth={1.5}
          className="adm-dash-chart-line"
          style={lineLength > 0 ? { "--chart-path-length": `${lineLength}px` } as CSSProperties : undefined}
        />
        {yTicks.map((tick) => (
          <text
            key={tick.value}
            x={PADDING.left - 8}
            y={tick.y + 3}
            fontSize={10}
            textAnchor="end"
            fill="var(--ink-4)"
            fontFamily="var(--font-sans)"
          >
            {tick.value}
          </text>
        ))}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={HEIGHT - 8}
            fontSize={10}
            textAnchor="middle"
            fill="var(--ink-4)"
            fontFamily="var(--font-sans)"
          >
            {tick.label}
          </text>
        ))}
      </svg>
      {(daily?.length ?? 0) > 0 ? (
        <ul className="sr-only">
          {daily.map((point) => (
            <li key={point.date}>
              {`${formatDate(point.date, i18n.language)}: ${point.count}`}
            </li>
          ))}
        </ul>
      ) : null}
      <footer className="adm-dash-card-foot">
        <span className="adm-dash-card-hint">
          {ready ? t("admin.v2.dash_sessions_hint", { count: max }) : t("admin.v2.dash_loading")}
        </span>
      </footer>
    </section>
  );
}

function formatDate(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale || undefined, { month: "short", day: "numeric" }).format(parsed);
}
