"use client";

import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { ActionEdit, AdminDelete, AdminEmployees } from "../icons";
import {
  employeeSummaryStatus,
  isOverLocalComputerLimit,
  localComputerUsageLabel,
  type EmployeeNodeSummary,
} from "./helpers";
import { EmployeeComputers } from "./EmployeeComputers";

interface EmployeeCardProps {
  member: EmployeeNodeSummary;
  highlight: boolean;
  onDelete?: (employeeId: string) => void;
  onEdit?: (employeeId: string) => void;
  deletePending: boolean;
  t: TFunction;
}

export function EmployeeCard({
  member,
  highlight,
  onDelete,
  onEdit,
  deletePending,
  t,
}: EmployeeCardProps) {
  const { tone, key } = employeeSummaryStatus(member);
  return (
    <article
      className={`adm-node-card adm-emp-card tone-${tone}${highlight ? " is-pulse" : ""}`}
      data-employee={member.id}
    >
      <header className="adm-node-card-head">
        <span className="adm-node-avatar adm-emp-avatar" aria-hidden="true" translate="no">
          <AdminEmployees size={18} aria-hidden="true" />
        </span>
        <div className="adm-node-card-identity">
          <span className="adm-node-card-name" translate="no">{member.displayName}</span>
          <span className="adm-node-card-handle code" translate="no">@{member.id}</span>
        </div>
        <div className="adm-node-card-meta-col">
          {/* "Ready" is the default healthy state — the good tone on the card
              already carries it; only running / idle / no-nodes get named. */}
          {key !== "ready" ? (
            <span className={`adm-status-pill tone-${tone}`}>
              <i className="adm-status-dot" aria-hidden="true" />
              {t(`admin.v2.emp_state_${key}`, { defaultValue: key })}
            </span>
          ) : null}
          {member.departmentName ? (
            <span className="adm-emp-card-dept">{member.departmentName}</span>
          ) : null}
        </div>
      </header>

      <div className="adm-node-card-body">
        {member.email ? (
          <p className="adm-emp-card-email code tone-muted" translate="no">{member.email}</p>
        ) : null}
        <div className="adm-agents adm-emp-nodes">
          <EmployeeComputers nodes={member.nodes} t={t} />
        </div>
      </div>

      <footer className="adm-node-card-foot">
        <div
          className="adm-emp-card-metrics"
          aria-label={t("admin.v2.emp_metrics_aria", {
            running: member.runningCount,
            ready: member.readyCount,
            total: member.nodeCount,
          })}
        >
          <span className="adm-emp-card-metric">
            <span className="adm-emp-metric-label">{t("admin.v2.col_running")}</span>
            <span className={`tnum ${member.runningCount > 0 ? "tone-neutral" : "tone-muted"}`}>
              {member.runningCount}
            </span>
          </span>
          <span className="adm-emp-card-metric">
            <span className="adm-emp-metric-label">{t("admin.v2.col_ready")}</span>
            <span className="tnum tone-muted">{member.readyCount}/{member.nodeCount}</span>
          </span>
          <span className="adm-emp-card-metric">
            <span className="adm-emp-metric-label">{t("admin.v2.col_local_limit")}</span>
            <span className={`tnum ${isOverLocalComputerLimit(member) ? "" : "tone-muted"}`}>
              {localComputerUsageLabel(member)}
            </span>
            {/* The palette is monochrome, so a colour cannot say "over" — the
                pill carries a word, like every other state on this card. */}
            {isOverLocalComputerLimit(member) ? (
              <span className="adm-status-pill tone-bad" title={t("admin.v2.emp_limit_over")}>
                <i className="adm-status-dot" aria-hidden="true" />
                {t("admin.v2.emp_limit_over_short")}
              </span>
            ) : null}
          </span>
        </div>
        {onDelete || onEdit ? (
          <div className="adm-node-card-actions">
            {onEdit ? (
              <Button
                variant="ghost"
                type="button"
                className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn"
                onClick={() => onEdit(member.id)}
                aria-label={t("admin.v2.edit_employee_action")}
                title={t("admin.v2.edit_employee_action")}
              >
                <ActionEdit size={14} aria-hidden="true" />
              </Button>
            ) : null}
            {onDelete ? (
            <Button
              variant="ghost"
              type="button"
              className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn danger"
              onClick={() => onDelete(member.id)}
              disabled={deletePending}
              aria-label={t("admin.v2.delete_employee_action")}
              title={t("admin.v2.delete_employee_action")}
            >
              <AdminDelete size={14} aria-hidden="true" />
            </Button>
            ) : null}
          </div>
        ) : null}
      </footer>
    </article>
  );
}
