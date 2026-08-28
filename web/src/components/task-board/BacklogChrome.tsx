"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type EmployeeAgent, type RelayTaskListItem } from "../../types";
import {
  ActionAdd,
  ActionApprove,
  ActionCalendar,
  ActionStart,
  ActionStop,
  ICON,
  NavAgents,
  NavRefresh,
  ViewBoard,
  ViewList,
} from "../icons";
import { dueTone, TASK_PRIORITIES, TASK_STATUSES, type BacklogFilters } from "../../lib/backlog";
import { Button } from "@/components/ui/button";
import { FiltersBar, FilterSelect } from "../FiltersBar";
import { Input } from "@/components/ui/input";
import { StateMark } from "../StateMark";

import { ACTIVE_STATUSES, activeFilterCount, initialFilters, type BacklogView } from "./backlogVocabulary";

/**
 * The board's chrome, as against its records: the inline stat bar, the filter
 * bar, and the board/list view toggle. Split out of a 971-line BacklogPage.tsx.
 */

export function BacklogStats({ tasks }: { tasks: RelayTaskListItem[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const active = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    const overdue = tasks.filter((task) => dueTone(task) === "bad").length;
    return { total: tasks.length, active, blocked, overdue };
  }, [tasks]);

  return (
    <p className="backlog-stats" aria-label={t("backlog.metrics")}>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_active")}</span>
        <span className="backlog-stat-value">{stats.active}</span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_blocked")}</span>
        <span className="backlog-stat-value">
          {stats.blocked > 0 ? <StateMark shape="ring" className="backlog-stat-mark" /> : null}
          {stats.blocked}
        </span>
      </span>
      <span className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("backlog.metric_overdue")}</span>
        <span className="backlog-stat-value">
          {stats.overdue > 0 ? <StateMark shape="ring" className="backlog-stat-mark" /> : null}
          {stats.overdue}
        </span>
      </span>
    </p>
  );
}
export function formatDueDate(value: string): string {
  // Date-only values ("2026-07-19") parse as UTC midnight; construct a local
  // date so the rendered day does not shift with the viewer's timezone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
export function BacklogFiltersBar({
  filters,
  agents,
  onChange,
}: {
  filters: BacklogFilters;
  agents: EmployeeAgent[];
  onChange: (next: BacklogFilters) => void;
}) {
  const { t } = useTranslation();

  return (
    <FiltersBar
      ariaLabel={t("backlog.filters")}
      searchName="backlog-query"
      searchLabel={t("backlog.search")}
      query={filters.query}
      onQueryChange={(query) => onChange({ ...filters, query })}
      activeCount={activeFilterCount(filters)}
      onClear={() => onChange(initialFilters)}
    >
      <FilterSelect
        name="backlog-status-filter"
        label={t("backlog.status")}
        value={filters.status}
        onValueChange={(status) => onChange({ ...filters, status })}
        options={[
          { value: "all" as const, label: t("backlog.all_statuses") },
          ...TASK_STATUSES.map((status) => ({
            value: status,
            label: t(`backlog.statuses.${status}`),
          })),
        ]}
      />
      <FilterSelect
        name="backlog-priority-filter"
        label={t("backlog.priority")}
        value={filters.priority}
        onValueChange={(priority) => onChange({ ...filters, priority })}
        options={[
          { value: "all" as const, label: t("backlog.all_priorities") },
          ...TASK_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(`backlog.priorities.${priority}`),
          })),
        ]}
      />
      <FilterSelect
        name="backlog-agent-filter"
        label={t("backlog.agent")}
        value={filters.agent}
        onValueChange={(agent) => onChange({ ...filters, agent })}
        options={[
          { value: "all", label: t("backlog.all_agents") },
          ...agents.map((agent) => ({ value: agent.id, label: agent.displayName })),
        ]}
      />
      <Input
        name="backlog-assignee-filter"
        autoComplete="off"
        spellCheck={false}
        value={filters.assignee}
        placeholder={t("backlog.assignee_filter")}
        aria-label={t("backlog.assignee_filter")}
        onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
      />
      <FilterSelect
        name="backlog-due-filter"
        label={t("backlog.due")}
        value={filters.due}
        onValueChange={(due) => onChange({ ...filters, due })}
        options={[
          { value: "all", label: t("backlog.all_due") },
          { value: "overdue", label: t("backlog.overdue") },
          { value: "today", label: t("backlog.today") },
          { value: "unscheduled", label: t("backlog.unscheduled") },
        ]}
      />
    </FiltersBar>
  );
}
export function BacklogViewToggle({ view, onChange }: { view: BacklogView; onChange: (view: BacklogView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle" role="group" aria-label={t("backlog.view")}>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "board" ? "true" : "false"}
        aria-pressed={view === "board"}
        aria-label={t("backlog.view_board")}
        title={t("backlog.view_board")}
        onClick={() => onChange("board")}
      >
        <ViewBoard size={ICON.sm} />
      </Button>
      <Button variant="ghost"
        type="button"
        className="backlog-view-btn"
        data-active={view === "list" ? "true" : "false"}
        aria-pressed={view === "list"}
        aria-label={t("backlog.view_list")}
        title={t("backlog.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={ICON.sm} />
      </Button>
    </div>
  );
}
