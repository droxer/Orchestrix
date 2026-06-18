"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { visualStatus } from "../../../lib/adminHelpers";
import type { ControlPanelDaemonNodeRecord } from "../../../types";

interface FleetHealthCardProps {
  nodes: ControlPanelDaemonNodeRecord[];
}

type Tone = "good" | "info" | "bad" | "muted";
type Slot = { key: string; tone: Tone; count: number; share: number };

const ORDER: Array<{ key: string; tone: Tone }> = [
  { key: "ready", tone: "good" },
  { key: "running", tone: "info" },
  { key: "failed", tone: "bad" },
  { key: "stale", tone: "bad" },
  { key: "unknown", tone: "muted" },
];

export function FleetHealthCard({ nodes }: FleetHealthCardProps) {
  const { t } = useTranslation();

  const { slots, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const key = visualStatus(node);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = nodes.length;
    const slots: Slot[] = ORDER.map(({ key, tone }) => {
      const count = counts.get(key) ?? 0;
      return { key, tone, count, share: total > 0 ? count / total : 0 };
    });
    return { slots, total };
  }, [nodes]);

  const segments = slots.filter((s) => s.count > 0);
  const grid = slots.filter((s) => s.key !== "unknown" || s.count > 0);

  return (
    <section className="adm-dash-card">
      <header className="adm-dash-card-head">
        <div className="adm-dash-card-eyebrow">{t("admin.v2.dash_health_eyebrow")}</div>
        <h3 className="adm-dash-card-title">{t("admin.v2.dash_health_title")}</h3>
      </header>

      <div
        className="adm-dash-bar"
        role="img"
        aria-label={t("admin.v2.dash_health_title")}
      >
        {total === 0 ? (
          <span className="adm-dash-bar-empty" />
        ) : (
          segments.map((seg) => (
            <span
              key={seg.key}
              className={`adm-dash-bar-seg tone-${seg.tone}`}
              style={{ flexBasis: `${seg.share * 100}%` }}
              title={`${t(`admin.v2.dash_health_${seg.key}`)}: ${seg.count}`}
            />
          ))
        )}
      </div>

      <dl className="adm-dash-stat-grid">
        {grid.map((slot) => (
          <div key={slot.key} className={`adm-dash-stat tone-${slot.tone}`}>
            <dt className="adm-dash-stat-label">
              <span className="adm-dash-stat-dot" aria-hidden="true" />
              {t(`admin.v2.dash_health_${slot.key}`)}
            </dt>
            <dd className="adm-dash-stat-value mono">{slot.count}</dd>
          </div>
        ))}
      </dl>

      <footer className="adm-dash-card-foot">
        <span className="adm-dash-card-hint">{t("admin.v2.dash_health_total", { count: total })}</span>
      </footer>
    </section>
  );
}
