"use client";

import { useTranslation } from "react-i18next";
import type { TokenUsageSnapshot } from "../../../hooks/useTokenUsage";

const WIDTH = 720;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 };

const PLACEHOLDER_FULL = [
  0.32, 0.48, 0.41, 0.58, 0.66, 0.52, 0.71, 0.6, 0.78, 0.69, 0.84, 0.74, 0.91, 0.82,
];
const PLACEHOLDER_COMPACT = [0.36, 0.52, 0.45, 0.62, 0.74, 0.66, 0.88];

function PlaceholderBars({ compact }: { compact?: boolean }) {
  const heights = compact ? PLACEHOLDER_COMPACT : PLACEHOLDER_FULL;
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;
  const gap = compact ? 10 : 6;
  const barW = (innerW - gap * (heights.length - 1)) / heights.length;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="adm-dash-chart adm-dash-chart--empty"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {heights.map((ratio, i) => {
        const h = ratio * innerH;
        const x = PADDING.left + i * (barW + gap);
        const y = PADDING.top + innerH - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill="var(--color-hairline)"
            opacity={0.55}
          />
        );
      })}
      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={PADDING.top + innerH + 0.5}
        y2={PADDING.top + innerH + 0.5}
        stroke="var(--color-hairline-soft)"
        strokeWidth={1}
      />
    </svg>
  );
}

interface TokenUsageChartProps {
  snapshot: TokenUsageSnapshot;
  compact?: boolean;
}

export function TokenUsageChart({ snapshot, compact }: TokenUsageChartProps) {
  const { t } = useTranslation();

  if (!snapshot.available || snapshot.daily.length === 0) {
    return (
      <section className="adm-dash-card">
        <header className="adm-dash-card-head">
          <div className="adm-dash-card-eyebrow">{t("admin.v2.dash_tokens_eyebrow")}</div>
          <h3 className="adm-dash-card-title">{t("admin.v2.dash_tokens_title")}</h3>
        </header>
        <div className={`adm-dash-empty${compact ? " adm-dash-empty--compact" : ""}`}>
          <PlaceholderBars compact={compact} />
          <div className="adm-dash-empty-overlay">
            <span className="adm-dash-empty-tag mono">{t("admin.v2.dash_coming_soon_tag")}</span>
            <p className="adm-dash-empty-copy">{t("admin.v2.dash_tokens_empty")}</p>
          </div>
        </div>
      </section>
    );
  }

  // Live path — kept minimal; when backend lands this renders stacked bars.
  return (
    <section className="adm-dash-card">
      <header className="adm-dash-card-head">
        <div className="adm-dash-card-eyebrow">{t("admin.v2.dash_tokens_eyebrow")}</div>
        <h3 className="adm-dash-card-title">{t("admin.v2.dash_tokens_title")}</h3>
      </header>
      <p className="adm-dash-card-hint">
        {t("admin.v2.dash_tokens_summary", {
          input: snapshot.totalInput.toLocaleString(),
          output: snapshot.totalOutput.toLocaleString(),
        })}
      </p>
    </section>
  );
}
