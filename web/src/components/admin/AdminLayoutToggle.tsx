"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ViewGrid, ViewList } from "../icons";

export type AdminLayout = "card" | "list";

interface AdminLayoutToggleProps {
  layout: AdminLayout;
  onChange: (next: AdminLayout) => void;
}

// Card/list density switch shared by the Employees and Nodes views. Reuses the
// backlog toggle geometry so it reads identically to the Backlog/Routine pages.
export function AdminLayoutToggle({ layout, onChange }: AdminLayoutToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle adm-layout-toggle" role="group" aria-label={t("admin.v2.layout_label")}>
      <Button
        variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={layout === "card" ? "true" : "false"}
        aria-pressed={layout === "card"}
        aria-label={t("admin.v2.view_card")}
        title={t("admin.v2.view_card")}
        onClick={() => onChange("card")}
      >
        <ViewGrid size={15} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={layout === "list" ? "true" : "false"}
        aria-pressed={layout === "list"}
        aria-label={t("admin.v2.view_list")}
        title={t("admin.v2.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}
