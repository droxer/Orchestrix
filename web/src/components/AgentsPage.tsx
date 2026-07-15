"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { agentAvailabilityTone } from "../lib/adminHelpers";
import { agentLabel } from "../lib/plan";
import type { AgentName, CurrentUser, EmployeeAgent, LogicalAgentAvailability } from "../types";
import { ActionSearch, NavConversations, StreamInfo } from "./icons";
import { AgentStateBadge } from "./AgentStateBadge";
import { AgentWorkspacePage, type WorkspacePageTab } from "./AgentWorkspacePage";
import { RelayEmptyState } from "./RelayEmptyState";
import { Badge } from "./ui/badge";

interface AgentsPageProps {
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  /** The agent currently inspected in the detail pane, driven by the URL hash. */
  workspaceAgent: EmployeeAgent | null;
  onOpenWorkspace: (agent: EmployeeAgent, tab?: WorkspacePageTab) => void;
  onStartConversation: (agent: EmployeeAgent) => void;
  onOpenConversation: (sessionId: string) => void;
}

type AvailabilityFilter = "all" | LogicalAgentAvailability;

const AVAILABILITY_FILTERS: readonly AvailabilityFilter[] = [
  "all",
  "ready",
  "busy",
  "pending",
  "offline",
];

function parseAvailabilityFilter(value: string | null): AvailabilityFilter {
  return AVAILABILITY_FILTERS.includes(value as AvailabilityFilter)
    ? value as AvailabilityFilter
    : "all";
}

function activePlacements(agent: EmployeeAgent) {
  return agent.placements.filter((placement) => placement.desiredState !== "removed");
}

function formatRelativeTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  const relativeTime = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto", style: "short" });
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return relativeTime.format(0, "second");
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return relativeTime.format(-hours, "hour");
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function agentDescriptors(t: ReturnType<typeof useTranslation>["t"]): Record<AgentName, { blurb: string }> {
  return {
    claude: { blurb: t("agent.claude.blurb") },
    pi: { blurb: t("agent.pi.blurb") },
    codex: { blurb: t("agent.codex.blurb") },
    kimi: { blurb: t("agent.kimi.blurb") },
  };
}

function RosterFilterBar({
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

  return (
    <div className="agents-roster-filter" aria-label={t("agents_page.filters")}>
      <div className="agents-roster-search-wrap">
        <ActionSearch size={14} aria-hidden="true" />
        <input
          className="agents-roster-search"
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
        className="agents-roster-select"
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
    </div>
  );
}

function RosterRow({
  agent,
  executorLabel,
  locale,
  selected,
  onSelect,
  onStartConversation,
  onOpenProfile,
}: {
  agent: EmployeeAgent;
  executorLabel: string;
  locale: string;
  selected: boolean;
  onSelect: (agent: EmployeeAgent) => void;
  onStartConversation: (agent: EmployeeAgent) => void;
  onOpenProfile: (agent: EmployeeAgent) => void;
}) {
  const { t } = useTranslation();
  const placements = activePlacements(agent);
  const readyPlacements = placements.filter((placement) => placement.status === "ready").length;
  const ready = agent.enabled && agent.availability === "ready";
  const canChat = ready;

  return (
    <li>
      <article
        className="agents-roster-row"
        data-availability={agent.availability}
        data-selected={selected ? "true" : "false"}
      >
        <button
          type="button"
          className="agents-roster-row-select"
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(agent)}
        >
          <span className="agents-roster-row-badge">
            <AgentStateBadge agent={agent.executorKind} ready={ready} />
          </span>
          <span className="agents-roster-row-main">
            <span className="agents-roster-row-title">
              <span className="agents-roster-row-name">{agent.displayName}</span>
              {!agent.enabled ? <Badge variant="neutral">{t("agents_page.disabled")}</Badge> : null}
            </span>
            <span className="agents-roster-row-meta">
              <span className={cn("agents-availability", `tone-${agentAvailabilityTone(agent.availability)}`)}>
                {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
              </span>
              <span className="agents-roster-row-sep" aria-hidden="true">·</span>
              <span translate="no">{executorLabel}</span>
              <span className="agents-roster-row-sep" aria-hidden="true">·</span>
              <span className="mono">
                {placements.length === 0
                  ? t("agents_page.no_placements")
                  : t("agents_page.placements_ready", { ready: readyPlacements, total: placements.length })}
              </span>
            </span>
            <span className="agents-roster-row-updated">
              {t("agents_page.meta_updated")} {formatRelativeTime(agent.updatedAt, locale)}
            </span>
          </span>
        </button>
        <span className="agents-roster-row-actions" role="group" aria-label={t("agents_page.actions")}>
          <button
            type="button"
            className="agents-roster-row-action"
            disabled={!canChat}
            onClick={(event) => {
              event.stopPropagation();
              onStartConversation(agent);
            }}
            aria-label={t("agents_page.start_chat")}
            title={t("agents_page.start_chat")}
          >
            <NavConversations size={13} />
          </button>
          <button
            type="button"
            className="agents-roster-row-action"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile(agent);
            }}
            aria-label={t("agents_page.view_profile_for", { name: agent.displayName })}
            title={t("agents_page.view_profile_for", { name: agent.displayName })}
          >
            <StreamInfo size={13} />
          </button>
        </span>
      </article>
    </li>
  );
}

export function AgentsPage({
  currentUser,
  isRefreshing,
  onRefresh,
  workspaceAgent,
  onOpenWorkspace,
  onStartConversation,
  onOpenConversation,
}: AgentsPageProps) {
  const { t, i18n } = useTranslation();
  const { agents, isFetching } = useEmployeeAgents(currentUser.employeeId);
  const descriptors = useMemo(() => agentDescriptors(t), [t]);
  const [query, setQuery] = useUrlSearchState("agentsQ", "", (value) => value ?? "", (value) => value || null);
  const [availability, setAvailability] = useUrlSearchState(
    "agentsFilter",
    "all" as AvailabilityFilter,
    parseAvailabilityFilter,
    (value) => value === "all" ? null : value,
  );

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

  const loading = isFetching && agents.length === 0;

  return (
    <section
      id="agents-panel"
      className="agents-page"
      aria-label={t("agents_page.title")}
      tabIndex={-1}
    >
      <div className="agents-roster" aria-label={t("agents_page.title")}>
        <RosterFilterBar
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
            title={activeAgents.length === 0 ? t("agents_page.empty_title") : t("agents_page.empty_filtered_title")}
            body={activeAgents.length === 0 ? t("agents_page.empty_body") : t("agents_page.empty_filtered_body")}
          />
        ) : (
          <ul className="agents-roster-list" aria-label={t("agents_page.title")}>
            {visibleAgents.map((agent) => {
              const descriptor = descriptors[agent.executorKind];
              return (
                <RosterRow
                  key={agent.id}
                  agent={agent}
                  executorLabel={agentLabel(agent.executorKind)}
                  locale={i18n.language}
                  selected={workspaceAgent?.id === agent.id}
                  onSelect={onOpenWorkspace}
                  onStartConversation={onStartConversation}
                  onOpenProfile={(selected) => onOpenWorkspace(selected, "profile")}
                />
              );
            })}
          </ul>
        )}
      </div>

      <div className="agents-detail">
        {workspaceAgent ? (
          <AgentWorkspacePage
            key={workspaceAgent.id}
            agent={workspaceAgent}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
            onOpenConversation={onOpenConversation}
            canEditMeta
          />
        ) : (
          <RelayEmptyState
            fill
            title={t("agents_page.select_title")}
            body={t("agents_page.select_body")}
          />
        )}
      </div>

    </section>
  );
}
