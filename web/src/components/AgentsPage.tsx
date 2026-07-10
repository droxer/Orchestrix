"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { readViewPreference, writeViewPreference } from "../lib/viewPreference";
import type { AgentName, CurrentUser, EmployeeAgent, LogicalAgentAvailability } from "../types";
import { ActionSearch, NavConversations, NavRefresh, NavWorkspace, ViewGrid, ViewList } from "./icons";
import { AgentProfileDrawer } from "./admin/AgentProfileDrawer";
import { AgentStateBadge } from "./AgentStateBadge";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface AgentsPageProps {
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenWorkspace: (agent: EmployeeAgent) => void;
  onStartConversation: (agent: EmployeeAgent) => void;
}

type AvailabilityFilter = "all" | LogicalAgentAvailability;
type AgentsView = "card" | "list";

const AVAILABILITY_FILTERS: readonly AvailabilityFilter[] = [
  "all",
  "ready",
  "busy",
  "pending",
  "offline",
];

const AGENTS_VIEWS: readonly AgentsView[] = ["card", "list"];
const AGENTS_VIEW_STORAGE_KEY = "relay-web.agentsView";

function parseAvailabilityFilter(value: string | null): AvailabilityFilter {
  return AVAILABILITY_FILTERS.includes(value as AvailabilityFilter)
    ? value as AvailabilityFilter
    : "all";
}

function parseAgentsView(value: string | null): AgentsView {
  return AGENTS_VIEWS.includes(value as AgentsView)
    ? value as AgentsView
    : readViewPreference(AGENTS_VIEW_STORAGE_KEY, "list", AGENTS_VIEWS);
}

function activePlacements(agent: EmployeeAgent) {
  return agent.placements.filter((placement) => placement.desiredState !== "removed");
}

function availabilityTaskStatus(availability: LogicalAgentAvailability): string {
  if (availability === "ready") return "done";
  if (availability === "busy") return "running";
  if (availability === "pending") return "waiting_for_human";
  if (availability === "offline") return "blocked";
  return "backlog";
}

function availabilityRowStatus(availability: LogicalAgentAvailability): string {
  return availabilityTaskStatus(availability);
}

function formatRelativeTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function agentDescriptors(
  t: ReturnType<typeof useTranslation>["t"],
): Record<AgentName, { role: string; blurb: string }> {
  return {
    claude: { role: t("agent.claude.role"), blurb: t("agent.claude.blurb") },
    pi: { role: t("agent.pi.role"), blurb: t("agent.pi.blurb") },
    codex: { role: t("agent.codex.role"), blurb: t("agent.codex.blurb") },
    kimi: { role: t("agent.kimi.role"), blurb: t("agent.kimi.blurb") },
  };
}

function AgentsStats({ agents }: { agents: EmployeeAgent[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const ready = agents.filter((agent) => agent.availability === "ready").length;
    const busy = agents.filter((agent) => agent.availability === "busy").length;
    const offline = agents.filter((agent) => agent.availability === "offline").length;
    return { total: agents.length, ready, busy, offline };
  }, [agents]);

  return (
    <div className="backlog-stats" aria-label={t("agents_page.metrics")}>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("agents_page.metric_total")}</span>
        <span className="backlog-stat-value">{stats.total}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("agents_page.metric_ready")}</span>
        <span className="backlog-stat-value tone-active">{stats.ready}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("agents_page.metric_busy")}</span>
        <span className="backlog-stat-value">{stats.busy}</span>
      </div>
      <div className="backlog-stat">
        <span className="backlog-stat-eyebrow">{t("agents_page.metric_offline")}</span>
        <span className={cn("backlog-stat-value", stats.offline > 0 && "tone-overdue")}>{stats.offline}</span>
      </div>
    </div>
  );
}

function AgentsFiltersBar({
  query,
  availability,
  onQueryChange,
  onAvailabilityChange,
}: {
  query: string;
  availability: AvailabilityFilter;
  onQueryChange: (value: string) => void;
  onAvailabilityChange: (value: AvailabilityFilter) => void;
}) {
  const { t } = useTranslation();
  const hasFilter = availability !== "all";

  return (
    <div className="backlog-filter-bar" aria-label={t("agents_page.filters")}>
      <div className="backlog-filter-primary agents-filter-primary">
        <div className="backlog-filter-search-wrap">
          <ActionSearch size={15} aria-hidden="true" />
          <input
            className="backlog-filter-search"
            name="agents-query"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={t("agents_page.search_placeholder")}
            aria-label={t("agents_page.search_label")}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <select
          className="agents-filter-select"
          name="agents-availability-filter"
          value={availability}
          aria-label={t("agents_page.filter_availability")}
          onChange={(event) => onAvailabilityChange(event.target.value as AvailabilityFilter)}
        >
          {AVAILABILITY_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {t(`agents_page.filter_${filter}`)}
            </option>
          ))}
        </select>
        {hasFilter ? (
          <div className="backlog-filter-actions">
            <button
              type="button"
              className="backlog-filter-clear"
              onClick={() => onAvailabilityChange("all")}
            >
              {t("backlog.clear_filters")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentsViewToggle({ view, onChange }: { view: AgentsView; onChange: (view: AgentsView) => void }) {
  const { t } = useTranslation();
  return (
    <div className="backlog-view-toggle" role="group" aria-label={t("agents_page.view")}>
      <button
        type="button"
        className="backlog-view-btn"
        data-active={view === "card" ? "true" : "false"}
        aria-pressed={view === "card"}
        aria-label={t("agents_page.view_card")}
        title={t("agents_page.view_card")}
        onClick={() => onChange("card")}
      >
        <ViewGrid size={15} />
      </button>
      <button
        type="button"
        className="backlog-view-btn"
        data-active={view === "list" ? "true" : "false"}
        aria-pressed={view === "list"}
        aria-label={t("agents_page.view_list")}
        title={t("agents_page.view_list")}
        onClick={() => onChange("list")}
      >
        <ViewList size={15} />
      </button>
    </div>
  );
}

function AgentCard({
  agent,
  roleLabel,
  blurb,
  locale,
  onOpenWorkspace,
  onStartConversation,
  onOpenProfile,
}: {
  agent: EmployeeAgent;
  roleLabel: string;
  blurb: string;
  locale: string;
  onOpenWorkspace: (agent: EmployeeAgent) => void;
  onStartConversation: (agent: EmployeeAgent) => void;
  onOpenProfile: (agent: EmployeeAgent) => void;
}) {
  const { t } = useTranslation();
  const placements = activePlacements(agent);
  const readyPlacements = placements.filter((placement) => placement.status === "ready").length;
  const ready = agent.enabled && agent.availability === "ready";
  const canChat = ready;

  return (
    <article
      className="agents-card routine-card backlog-task"
      data-priority={agent.enabled ? "normal" : "low"}
      onClick={() => onOpenProfile(agent)}
      role="listitem"
      tabIndex={0}
      aria-label={t("agents_page.view_profile_for", { name: agent.displayName })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenProfile(agent);
        }
      }}
    >
      <div className="backlog-task-badges">
        <AgentStateBadge agent={agent.executorKind} ready={ready} />
        <Badge variant={agent.enabled ? "success" : "neutral"}>
          {agent.enabled ? t("agents_page.enabled") : t("agents_page.disabled")}
        </Badge>
      </div>

      <h2 className="agents-card-title">{agent.displayName}</h2>

      <p className="backlog-description">{blurb}</p>

      {agent.instructions?.trim() ? (
        <p className="agents-card-instructions">{agent.instructions.trim()}</p>
      ) : null}

      <div className="backlog-meta">
        <span className="task-status" data-status={availabilityTaskStatus(agent.availability)}>
          {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
        </span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span>{agent.executorKind} · {roleLabel}</span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span>
          {placements.length === 0
            ? t("agents_page.no_placements")
            : t("agents_page.placements_ready", { ready: readyPlacements, total: placements.length })}
        </span>
        <span className="backlog-meta-sep" aria-hidden="true">·</span>
        <span>{t("agents_page.meta_updated")} {formatRelativeTime(agent.updatedAt, locale)}</span>
      </div>

      <div className="backlog-task-actions" role="group" aria-label={t("agents_page.actions")}>
        <div className="backlog-action-group" aria-label={t("agents_page.actions_dispatch")}>
          <button
            type="button"
            className="backlog-action-primary backlog-action-icon"
            disabled={!canChat}
            onClick={(event) => {
              event.stopPropagation();
              onStartConversation(agent);
            }}
            aria-label={t("agents_page.start_chat")}
            title={t("agents_page.start_chat")}
          >
            <NavConversations size={14} />
          </button>
        </div>
        <div className="backlog-action-group">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspace(agent);
            }}
            aria-label={t("agents_page.open_workspace")}
            title={t("agents_page.open_workspace")}
          >
            {t("agents_page.open_workspace")}
          </button>
        </div>
      </div>
    </article>
  );
}

function AgentRow({
  agent,
  roleLabel,
  locale,
  onOpenWorkspace,
  onStartConversation,
  onOpenProfile,
}: {
  agent: EmployeeAgent;
  roleLabel: string;
  locale: string;
  onOpenWorkspace: (agent: EmployeeAgent) => void;
  onStartConversation: (agent: EmployeeAgent) => void;
  onOpenProfile: (agent: EmployeeAgent) => void;
}) {
  const { t } = useTranslation();
  const placements = activePlacements(agent);
  const readyPlacements = placements.filter((placement) => placement.status === "ready").length;
  const ready = agent.enabled && agent.availability === "ready";
  const canChat = ready;

  return (
    <article
      className="backlog-row group agents-row"
      role="listitem"
      tabIndex={0}
      data-status={availabilityRowStatus(agent.availability)}
      data-priority={agent.enabled ? "normal" : "low"}
      aria-label={t("agents_page.view_profile_for", { name: agent.displayName })}
      onClick={() => onOpenProfile(agent)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenProfile(agent);
        }
      }}
    >
      <div className="backlog-row-lead">
        <span className="backlog-row-dot" aria-hidden="true" />
        <span className="agents-row-title">{agent.displayName}</span>
      </div>
      <span className="backlog-row-status">
        {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
      </span>
      <div className="backlog-row-tags">
        <AgentStateBadge agent={agent.executorKind} ready={ready} />
        <Badge variant={agent.enabled ? "success" : "neutral"}>
          {agent.enabled ? t("agents_page.enabled") : t("agents_page.disabled")}
        </Badge>
      </div>
      <span className="backlog-row-assignee">
        {agent.executorKind} · {roleLabel}
      </span>
      <span className="backlog-row-due">
        {placements.length === 0
          ? t("agents_page.no_placements")
          : t("agents_page.placements_ready", { ready: readyPlacements, total: placements.length })}
        <span className="agents-row-updated">
          {t("agents_page.meta_updated")} {formatRelativeTime(agent.updatedAt, locale)}
        </span>
      </span>
      <div className="backlog-row-actions" role="group" aria-label={t("agents_page.actions")}>
        <div className="backlog-action-group" aria-label={t("agents_page.actions_dispatch")}>
          <button
            type="button"
            className="backlog-action-primary backlog-action-icon"
            disabled={!canChat}
            onClick={(event) => {
              event.stopPropagation();
              onStartConversation(agent);
            }}
            aria-label={t("agents_page.start_chat")}
            title={t("agents_page.start_chat")}
          >
            <NavConversations size={14} />
          </button>
        </div>
        <div className="backlog-action-group">
          <button
            type="button"
            className="backlog-action-icon"
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspace(agent);
            }}
            aria-label={t("agents_page.open_workspace")}
            title={t("agents_page.open_workspace")}
          >
            <NavWorkspace size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function AgentsPage({
  currentUser,
  isRefreshing,
  onRefresh,
  onOpenWorkspace,
  onStartConversation,
}: AgentsPageProps) {
  const { t, i18n } = useTranslation();
  const { agents, isFetching } = useEmployeeAgents(currentUser.employeeId);
  const descriptors = useMemo(() => agentDescriptors(t), [t]);
  const [profileAgent, setProfileAgent] = useState<EmployeeAgent | null>(null);
  const [query, setQuery] = useUrlSearchState("agentsQ", "", (value) => value ?? "", (value) => value || null);
  const [availability, setAvailability] = useUrlSearchState(
    "agentsFilter",
    "all" as AvailabilityFilter,
    parseAvailabilityFilter,
    (value) => value === "all" ? null : value,
  );
  const [view, setView] = useUrlSearchState("agentsView", parseAgentsView(null), parseAgentsView, (value) => value);

  const activeAgents = useMemo(
    () => agents.filter((agent) => !agent.deletedAt),
    [agents],
  );

  const visibleAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return activeAgents
      .filter((agent) => availability === "all" || agent.availability === availability)
      .filter((agent) => {
        if (!normalized) return true;
        const descriptor = descriptors[agent.executorKind];
        const haystack = [
          agent.displayName,
          agent.id,
          agent.executorKind,
          descriptor.role,
          descriptor.blurb,
          agent.instructions ?? "",
        ].join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((left, right) => {
        const rank = (agent: EmployeeAgent) => {
          if (agent.availability === "ready") return 0;
          if (agent.availability === "busy") return 1;
          if (agent.availability === "pending") return 2;
          return 3;
        };
        const rankDelta = rank(left) - rank(right);
        if (rankDelta !== 0) return rankDelta;
        return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
      });
  }, [activeAgents, availability, descriptors, query]);

  function changeView(next: AgentsView) {
    setView(next);
    writeViewPreference(AGENTS_VIEW_STORAGE_KEY, next);
  }

  const loading = isFetching && agents.length === 0;

  return (
    <section
      id="agents-panel"
      className="agents-page backlog-page"
      data-view={view}
      aria-label={t("agents_page.title")}
      tabIndex={-1}
    >
      <PageHeader
        title={t("agents_page.title")}
        count={t("agents_page.sub", { count: activeAgents.length })}
        actions={(
          <>
            <AgentsViewToggle view={view} onChange={changeView} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nav.refresh")}
              disabled={isRefreshing}
              onClick={() => void onRefresh()}
            >
              <NavRefresh size={16} className={isRefreshing ? "spin" : undefined} />
            </Button>
          </>
        )}
      />

      <AgentsStats agents={activeAgents} />
      <AgentsFiltersBar
        query={query}
        availability={availability}
        onQueryChange={setQuery}
        onAvailabilityChange={setAvailability}
      />

      {loading ? (
        <div className="route-loading" role="status" aria-live="polite">
          {t("admin.loading")}
        </div>
      ) : visibleAgents.length === 0 ? (
        <RelayEmptyState
          fill
          mark
          title={activeAgents.length === 0 ? t("agents_page.empty_title") : t("agents_page.empty_filtered_title")}
          body={activeAgents.length === 0 ? t("agents_page.empty_body") : t("agents_page.empty_filtered_body")}
          hint={t("agents_page.empty_hint")}
        />
      ) : view === "list" ? (
        <div className="backlog-rows agents-rows" role="list" aria-label={t("agents_page.title")}>
          <div className="backlog-rows-head" aria-hidden="true">
            <span className="backlog-rows-head-cell backlog-rows-head-lead">{t("agents_page.col_agent")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-status">{t("agents_page.col_status")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-tags">{t("agents_page.col_runtime")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-assignee">{t("agents_page.col_role")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-due">{t("agents_page.col_placements")}</span>
            <span className="backlog-rows-head-cell backlog-rows-head-actions">{t("backlog.actions")}</span>
          </div>
          {visibleAgents.map((agent) => {
            const descriptor = descriptors[agent.executorKind];
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                roleLabel={descriptor.role}
                locale={i18n.language}
                onOpenWorkspace={onOpenWorkspace}
                onStartConversation={onStartConversation}
                onOpenProfile={setProfileAgent}
              />
            );
          })}
        </div>
      ) : (
        <div className="routine-list agents-list" role="list">
          {visibleAgents.map((agent) => {
            const descriptor = descriptors[agent.executorKind];
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                roleLabel={descriptor.role}
                blurb={descriptor.blurb}
                locale={i18n.language}
                onOpenWorkspace={onOpenWorkspace}
                onStartConversation={onStartConversation}
                onOpenProfile={setProfileAgent}
              />
            );
          })}
        </div>
      )}

      <AgentProfileDrawer
        open={profileAgent !== null}
        onClose={() => setProfileAgent(null)}
        agentId={profileAgent?.id ?? null}
        agent={profileAgent}
        canManage={false}
      />
    </section>
  );
}
