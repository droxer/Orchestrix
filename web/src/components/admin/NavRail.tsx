"use client";

import { useTranslation } from "react-i18next";
import { LayoutDashboard, Server, Users } from "lucide-react";
import type { CurrentUser } from "../../types";
import { RelayMark } from "../RelayMark";

export type AdminView = "dashboard" | "people" | "fleet";

interface NavRailProps {
  view: AdminView;
  onChange: (next: AdminView) => void;
  admin: CurrentUser;
}

export function NavRail({ view, onChange, admin }: NavRailProps) {
  const { t } = useTranslation();
  const items: Array<{ id: AdminView; label: string; icon: typeof Users }> = [
    { id: "dashboard", label: t("admin.v2.nav_dashboard"), icon: LayoutDashboard },
    { id: "people", label: t("admin.v2.nav_people"), icon: Users },
    { id: "fleet", label: t("admin.v2.nav_fleet"), icon: Server },
  ];

  return (
    <nav className="adm-nav" aria-label={t("admin.v2.nav_label")}>
      <div className="adm-nav-brand" aria-hidden="true">
        <RelayMark width={32} height={22} />
      </div>
      <div className="adm-nav-items">
        {items.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`adm-nav-item ${active ? "active" : ""}`}
              onClick={() => onChange(item.id)}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="adm-nav-item-label">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="adm-nav-foot">
        <span className="adm-nav-user mono" translate="no">@{admin.username}</span>
      </div>
    </nav>
  );
}
