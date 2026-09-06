"use client";

import { useTranslation } from "react-i18next";
import type { AdminPageView } from "../../lib/store";
import { Button } from "@/components/ui/button";
import {
  AdminDashboard,
  AdminEmployees,
  AdminNode,
  AdminSettings,
  ICON,
} from "../icons";

export type AdminView = AdminPageView;

interface AdminViewToggleProps {
  view: AdminView;
  onChange: (next: AdminView) => void;
}

// Section navigation retains pressed-state semantics and keyboard-operable buttons.
export function AdminViewToggle({ view, onChange }: AdminViewToggleProps) {
  const { t } = useTranslation();
  const items: Array<{ id: AdminView; label: string; icon: typeof AdminEmployees }> = [
    { id: "dashboard", label: t("admin.v2.nav_dashboard"), icon: AdminDashboard },
    { id: "employees", label: t("admin.v2.nav_employees"), icon: AdminEmployees },
    { id: "nodes", label: t("admin.v2.nav_nodes"), icon: AdminNode },
    { id: "settings", label: t("admin.v2.nav_settings"), icon: AdminSettings },
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
            tooltip={item.label}
            onClick={() => onChange(item.id)}
          >
            <Icon size={ICON.sm} aria-hidden="true" />
            <span className="adm-view-toggle-label">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
