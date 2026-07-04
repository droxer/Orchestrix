"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmployeeAvatar } from "../../EmployeeAvatar";
import type { ControlPanelDaemonNodeRecord, EmployeeRecord } from "../../../types";

interface TopEmployeesProps {
  employees: EmployeeRecord[];
  nodes: ControlPanelDaemonNodeRecord[];
  ranked: Array<{ employeeId: string; sessionCount: number }>;
  className?: string;
}

export function TopEmployees({ employees, nodes, ranked, className }: TopEmployeesProps) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const nodeCountByEmployee = new Map<string, number>();
    for (const node of nodes) {
      if (!node.employeeId) continue;
      nodeCountByEmployee.set(node.employeeId, (nodeCountByEmployee.get(node.employeeId) ?? 0) + 1);
    }
    const employeeMap = new Map(employees.map((e) => [e.id, e] as const));
    const maxCount = ranked[0]?.sessionCount ?? 0;
    return ranked.map((row) => {
      const employee = employeeMap.get(row.employeeId);
      return {
        id: row.employeeId,
        displayName: employee?.displayName ?? row.employeeId,
        sessionCount: row.sessionCount,
        nodeCount: nodeCountByEmployee.get(row.employeeId) ?? 0,
        share: maxCount > 0 ? row.sessionCount / maxCount : 0,
      };
    });
  }, [ranked, employees, nodes]);

  return (
    <section className={`adm-dash-card${className ? ` ${className}` : ""}`}>
      <header className="adm-dash-card-head">
        <div className="adm-dash-card-eyebrow">{t("admin.v2.dash_top_eyebrow")}</div>
        <h3 className="adm-dash-card-title">{t("admin.v2.dash_top_title")}</h3>
      </header>
      {rows.length === 0 ? (
        <p className="adm-dash-card-hint">{t("admin.v2.dash_top_empty")}</p>
      ) : (
        <ol className="adm-dash-top-list">
          {rows.map((row, index) => (
            <li key={row.id} className="adm-dash-top-row">
              <span className="adm-dash-top-rank mono">{String(index + 1).padStart(2, "0")}</span>
              <EmployeeAvatar employeeId={row.id} running={false} size={28} />
              <div className="adm-dash-top-meta">
                <span className="adm-dash-top-name">{row.displayName}</span>
                <span className="adm-dash-top-sub mono">
                  {t("admin.v2.dash_top_nodes", { count: row.nodeCount })}
                </span>
              </div>
              <div className="adm-dash-top-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(row.share * 100, 4)}%` }} />
              </div>
              <span className="adm-dash-top-count mono">{row.sessionCount}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
