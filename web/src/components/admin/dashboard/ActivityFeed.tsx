"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleDot, MessageSquarePlus, XCircle, type LucideIcon } from "lucide-react";
import type { DashboardActivityItem } from "../../../api";
import type { EmployeeRecord } from "../../../types";

interface ActivityFeedProps {
  items: DashboardActivityItem[];
  employees: EmployeeRecord[];
}

const ICONS: Record<string, { Icon: LucideIcon; tone: "info" | "good" | "bad" | "muted" }> = {
  "session.created": { Icon: CircleDot, tone: "info" },
  "session.completed": { Icon: CheckCircle2, tone: "good" },
  "session.failed": { Icon: XCircle, tone: "bad" },
  "task.created": { Icon: MessageSquarePlus, tone: "muted" },
};

export function ActivityFeed({ items, employees }: ActivityFeedProps) {
  const { t } = useTranslation();
  const employeeMap = new Map(employees.map((e) => [e.id, e.displayName] as const));

  return (
    <section className="adm-dash-card adm-dash-card--feed">
      <header className="adm-dash-card-head">
        <div className="adm-dash-card-eyebrow">{t("admin.v2.dash_feed_eyebrow")}</div>
        <h3 className="adm-dash-card-title">{t("admin.v2.dash_feed_title")}</h3>
      </header>
      {items.length === 0 ? (
        <p className="adm-dash-card-hint">{t("admin.v2.dash_feed_empty")}</p>
      ) : (
        <ul className="adm-dash-feed">
          {items.map((item, index) => {
            const meta = ICONS[item.kind] ?? { Icon: CircleDot, tone: "muted" as const };
            const Icon = meta.Icon;
            const ownerName = item.employeeId ? employeeMap.get(item.employeeId) ?? item.employeeId : null;
            return (
              <li key={`${item.kind}-${index}-${item.timestamp}`} className="adm-dash-feed-row">
                <span className={`adm-dash-feed-icon tone-${meta.tone}`} aria-hidden="true">
                  <Icon size={14} />
                </span>
                <div className="adm-dash-feed-body">
                  <span className="adm-dash-feed-message">{item.message}</span>
                  <span className="adm-dash-feed-meta mono">
                    {ownerName ? `${ownerName} · ` : ""}
                    {formatRelative(item.timestamp)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatRelative(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  const delta = Math.max(0, Date.now() - parsed);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
