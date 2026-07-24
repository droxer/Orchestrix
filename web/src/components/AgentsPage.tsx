"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import type { AgentName, CurrentUser, EmployeeAgent, LogicalAgentAvailability } from "../types";
import { ActionSearch } from "./icons";
import { AgentStateBadge } from "./AgentStateBadge";
import { StatusPill } from "./StatusPill";
import { AgentWorkspacePage, type WorkspacePageTab } from "./AgentWorkspacePage";
import { RelayEmptyState } from "./RelayEmptyState";
import { Badge } from "./ui/badge";
import { AgentPlacementBadge } from "./AgentPlacementBadge";
import { describeAgentPlacements } from "../lib/agentPlacements";

interface AgentsPageProps {
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  /** The agent currently inspected in the detail pane, driven by the URL hash. */
  workspaceAgent: EmployeeAgent | null;
  onOpenWorkspace: (agent: EmployeeAgent, tab?: WorkspacePageTab) => void;
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

function agentDescriptors(t: ReturnType<typeof useTranslation>["t"]):
Record<AgentName, { blurb: string }> {
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
    <div className="agents-roster-filter" role="group" aria-label={t("agents_page.filters")}>
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
  selected,
  onSelect,
}: {
  agent: EmployeeAgent;
  selected: boolean;
  onSelect: (agent: EmployeeAgent) => void;
}) {
  const { t } = useTranslation();
  const placements = activePlacements(agent);
  const placementDescriptions = describeAgentPlacements(placements);
  // One agent lives on exactly one computer.
  const computer = placementDescriptions[0] ?? null;
  const ready = agent.enabled && agent.availability === "ready";

  return (
    <li className="list-virtual">
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
            <AgentStateBadge
              agent={agent.executorKind}
              ready={ready}
              availability={agent.enabled ? agent.availability : undefined}
              imageUrl={agent.profileImageUrl}
            />
          </span>
          <span className="agents-roster-row-main">
            <span className="agents-roster-row-title">
              <span className="agents-roster-row-name">{agent.displayName}</span>
              {!agent.enabled ? <Badge variant="neutral">{t("agents_page.disabled")}</Badge> : null}
            </span>
            {/* The executor is carried by the AgentStateBadge glyph; the row's
                one infra line is the computer the agent runs on. */}
            <span className="agents-roster-row-meta">
              {computer ? (
                <AgentPlacementBadge description={computer} plain />
              ) : (
                <span className="mono">{t("agents_page.no_placements")}</span>
              )}
            </span>
          </span>
          {/* Explicit live status only when it adds information — "ready" is
              the default healthy state, already carried by the row accent and
              the glyph pip. Busy / Pending / Offline still get named. */}
          {agent.enabled && agent.availability !== "ready" ? (
            <span className="agents-roster-row-status">
              <StatusPill value={agent.availability} />
            </span>
          ) : null}
        </button>
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
  onOpenConversation,
}: AgentsPageProps) {
  const { t } = useTranslation();
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
            {visibleAgents.map((agent) => (
              <RosterRow
                key={agent.id}
                agent={agent}
                selected={workspaceAgent?.id === agent.id}
                onSelect={onOpenWorkspace}
              />
            ))}
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
            mark
            title={t("agents_page.select_title")}
            body={t("agents_page.select_body")}
          />
        )}
      </div>
    </section>
  );
}
