"use client";

import { useTranslation } from "react-i18next";
import type { AdminPageView } from "../../lib/store";
import { Button } from "../ui/button";
import { AdminDashboard, AdminEmployees, AdminNode } from "../icons";

export type AdminView = AdminPageView;

interface AdminViewToggleProps {
  view: AdminView;
  onChange: (next: AdminView) => void;
}

// Segmented view switcher — mirrors the backlog board/list toggle geometry
// (hairline track, 4px corners, canvas lift on the active segment).
export function AdminViewToggle({ view, onChange }: AdminViewToggleProps) {
  const { t } = useTranslation();
  const items: Array<{ id: AdminView; label: string; icon: typeof AdminEmployees }> = [
    { id: "dashboard", label: t("admin.v2.nav_dashboard"), icon: AdminDashboard },
    { id: "employees", label: t("admin.v2.nav_employees"), icon: AdminEmployees },
    { id: "nodes", label: t("admin.v2.nav_nodes"), icon: AdminNode },
  ];

  return (
    <div className="adm-view-toggle" role="group" aria-label={t("admin.v2.nav_label")}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <Button variant="ghost"
            key={item.id}
            type="button"
            className="adm-view-toggle-btn"
            data-active={active ? "true" : "false"}
            aria-pressed={active}
            aria-label={item.label}
            title={item.label}
            onClick={() => onChange(item.id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span className="adm-view-toggle-label">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
