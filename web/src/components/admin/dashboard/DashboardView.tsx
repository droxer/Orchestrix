"use client";

import { useTranslation } from "react-i18next";
import { useDashboardActivity } from "../../../hooks/useDashboardActivity";
import { useDashboardSessions } from "../../../hooks/useDashboardSessions";
import { useTokenUsage } from "../../../hooks/useTokenUsage";
import type { FleetMetrics } from "../../../hooks/useFleetMetrics";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../../types";
import { ActivityChart } from "./ActivityChart";
import { ActivityFeed } from "./ActivityFeed";
import { FleetHealthCard } from "./FleetHealthCard";
import { KpiTile } from "./KpiTile";
import { TokenUsageChart } from "./TokenUsageChart";
import { TopEmployees } from "./TopEmployees";

interface DashboardViewProps {
  nodes: ControlPanelDaemonNodeRecord[];
  employees: EmployeeRecord[];
  metrics: FleetMetrics;
}

export function DashboardView({ nodes, employees, metrics }: DashboardViewProps) {
  const { t, i18n } = useTranslation();
  const sessionsQuery = useDashboardSessions(true);
  const activity = useDashboardActivity(true);
  const tokens = useTokenUsage();

  const sessionsReady = !sessionsQuery.isLoading;
  const sessions = sessionsQuery.data;
  const fleetReady = nodes.length > 0 || employees.length > 0;

  const dash = "—";
  const showTokens = tokens.available;

  const fleetSpark = sparkFromCounts([metrics.failed, metrics.running, metrics.ready]);

  const last24h = sessions.last24h;
  const prior24h = clampNonNeg(sessions.last7d - last24h) / 6;
  const trend = compareTrend(last24h, prior24h);

  return (
    <div className="adm-dash">
      <div className="adm-dash-kpis-wrap">
        <section
          className={`adm-dash-kpis${showTokens ? "" : " adm-dash-kpis--lean"}`}
          aria-label={t("admin.v2.dash_kpis_label")}
        >
          <KpiTile
            slot="sessions"
            hero
            enterIndex={0}
            eyebrow={t("admin.v2.dash_kpi_sessions")}
            value={sessionsReady ? formatCompact(sessions.total, i18n.language) : dash}
            delta={
              sessionsReady
                ? {
                    direction: trend.direction,
                    label: t("admin.v2.dash_kpi_sessions_delta", {
                      count: last24h,
                      diff: trend.label,
                    }),
                  }
                : undefined
            }
          />
          <KpiTile
            slot="nodes"
            enterIndex={1}
            eyebrow={t("admin.v2.dash_kpi_nodes")}
            value={fleetReady ? formatCompact(metrics.total, i18n.language) : dash}
            hint={
              fleetReady
                ? t("admin.v2.dash_kpi_nodes_hint", { ready: metrics.ready, failed: metrics.failed })
                : undefined
            }
            spark={fleetReady && fleetSpark.length > 1 ? fleetSpark : undefined}
          />
          <KpiTile
            slot="employees"
            enterIndex={2}
            eyebrow={t("admin.v2.dash_kpi_employees")}
            value={fleetReady ? formatCompact(metrics.employeeTotal, i18n.language) : dash}
            hint={fleetReady ? t("admin.v2.dash_kpi_employees_hint", { count: employees.length }) : undefined}
          />
          {showTokens ? (
            <KpiTile
              slot="tokens"
              enterIndex={3}
              eyebrow={t("admin.v2.dash_kpi_tokens")}
              value={formatCompact(tokens.total, i18n.language)}
              hint={t("admin.v2.dash_kpi_tokens_hint")}
            />
          ) : null}
        </section>
      </div>

      <div className={`adm-dash-belt${showTokens ? "" : " adm-dash-belt--lean"}`}>
        <ActivityChart
          daily={sessions.dailyCounts}
          ready={sessionsReady}
          className="relay-enter relay-enter-delay-5"
        />
        <FleetHealthCard nodes={nodes} className="relay-enter relay-enter-delay-6" />
        <TopEmployees
          employees={employees}
          nodes={nodes}
          ranked={sessions.topEmployees}
          className="relay-enter relay-enter-delay-7"
        />
        {showTokens ? (
          <TokenUsageChart snapshot={tokens} compact className="relay-enter relay-enter-delay-8" />
        ) : null}
      </div>

      <ActivityFeed items={activity.items} employees={employees} className="relay-enter relay-enter-delay-9" />
    </div>
  );
}

function clampNonNeg(value: number): number {
  return value < 0 ? 0 : value;
}

interface Trend {
  direction: "up" | "down" | "flat";
  label: string;
}

function compareTrend(current: number, prior: number): Trend {
  if (prior <= 0 && current <= 0) return { direction: "flat", label: "0" };
  if (prior <= 0) return { direction: "up", label: `+${current}` };
  const diff = current - prior;
  if (Math.abs(diff) < 0.5) return { direction: "flat", label: "±0" };
  const pct = Math.round((diff / prior) * 100);
  return {
    direction: diff > 0 ? "up" : "down",
    label: `${pct > 0 ? "+" : ""}${pct}%`,
  };
}

function sparkFromCounts(values: number[]): number[] {
  if (values.every((v) => v === 0)) return [];
  return values;
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
