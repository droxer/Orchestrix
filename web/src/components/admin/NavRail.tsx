"use client";

import { useTranslation } from "react-i18next";
import { LayoutDashboard, MessageSquareMore, Server, Users } from "lucide-react";

export type AdminView = "dashboard" | "people" | "fleet" | "integrations";

interface NavRailProps {
  view: AdminView;
  onChange: (next: AdminView) => void;
}

export function NavRail({ view, onChange }: NavRailProps) {
  const { t } = useTranslation();
  const items: Array<{ id: AdminView; label: string; icon: typeof Users }> = [
    { id: "dashboard", label: t("admin.v2.nav_dashboard"), icon: LayoutDashboard },
    { id: "people", label: t("admin.v2.nav_people"), icon: Users },
    { id: "fleet", label: t("admin.v2.nav_fleet"), icon: Server },
    { id: "integrations", label: t("admin.v2.nav_integrations"), icon: MessageSquareMore },
  ];

  return (
    <nav className="adm-nav" aria-label={t("admin.v2.nav_label")}>
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
    </nav>
  );
}
