"use client";

import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AgentName, CurrentUser, EmployeeAgent, LogicalAgentAvailability } from "../types";
import { AgentStateBadge } from "./AgentStateBadge";
import { StatusPill } from "./StatusPill";
import { AgentWorkspacePage, type WorkspacePageTab } from "./AgentWorkspacePage";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "./FiltersBar";
import { SearchInput } from "@/components/ui/search-input";
import { describeAgentPlacements } from "../lib/agentPlacements";
import { OWNERSHIP_ICON } from "./AgentPlacementBadge";

interface AgentsPageProps {
  currentUser: CurrentUser;
  /** The agent currently inspected in the detail pane, driven by the pathname. */
  workspaceAgent: EmployeeAgent | null;
  isDetailRoute: boolean;
  onOpenWorkspace: (agent: EmployeeAgent, tab?: WorkspacePageTab) => void;
  onOpenThread: (sessionId: string) => void;
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
      <SearchInput
        className="agents-roster-search-wrap"
        inputClassName="agents-roster-search"
        iconSize={14}
        label={t("agents_page.search_label")}
        name="agents-query"
        value={query}
        placeholder={t("agents_page.search_placeholder")}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <FilterSelect
        className="agents-roster-select"
        name="agents-availability-filter"
        label={t("agents_page.filter_availability")}
        value={availability}
        onValueChange={onAvailabilityChange}
        options={AVAILABILITY_FILTERS.map((filter) => ({
          value: filter,
          label: t(`agents_page.filter_${filter}`),
        }))}
      />
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
  const ComputerIcon = computer ? OWNERSHIP_ICON[computer.ownership] : null;
  const computerKindLabel = computer ? t(`admin.v2.node_ownership_${computer.ownership}`) : "";

  return (
    <li className="list-virtual">
      <article
        className="agents-roster-row"
        data-availability={agent.availability}
        data-selected={selected ? "true" : "false"}
      >
        <Button
          variant="ghost"
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
              name={agent.displayName}
            />
          </span>
          <span className="agents-roster-row-main">
            <span className="agents-roster-row-title">
              <span className="agents-roster-row-name">{agent.displayName}</span>
              {!agent.enabled ? <Badge variant="neutral">{t("agents_page.disabled")}</Badge> : null}
            </span>
            {/* Name + computer travel together: the roster is the one place
                every agent's home machine can be scanned side by side. An
                agent with nowhere to run still says so — that is a defect,
                not a fact to quiet. */}
            <span
              className="agents-roster-row-meta"
              title={computer ? `${computerKindLabel} · ${computer.nodeName}` : undefined}
            >
              {computer && ComputerIcon ? (
                <>
                  <ComputerIcon size={12} aria-hidden="true" />
                  <span className="agents-roster-row-computer" translate="no">{computer.nodeName}</span>
                </>
              ) : (
                <span>{t("agents_page.no_placements")}</span>
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
        </Button>
      </article>
    </li>
  );
}

export function AgentsPage({
  currentUser,
  workspaceAgent,
  isDetailRoute,
  onOpenWorkspace,
  onOpenThread,
}: AgentsPageProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const { agents, isFetching } = useEmployeeAgents(currentUser.employeeId);
  const descriptors = useMemo(() => agentDescriptors(t), [t]);
  const [query, setQuery] = useUrlSearchState("q", "", (value) => value ?? "", (value) => value || null);
  const [availability, setAvailability] = useUrlSearchState(
    "availability",
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

  // The detail pane remounts per agent (key={workspaceAgent.id}), so an
  // in-flight profile draft cannot survive a roster switch — hold the
  // selection here until the owner confirms the discard.
  const profileDirtyRef = useRef(false);
  const handleProfileDirtyChange = useCallback((dirty: boolean) => {
    profileDirtyRef.current = dirty;
  }, []);
  const handleSelectAgent = useCallback(async (agent: EmployeeAgent) => {
    if (agent.id === workspaceAgent?.id) return;
    if (profileDirtyRef.current) {
      const ok = await confirm({
        title: t("unsaved.title"),
        message: t("unsaved.message"),
        confirmLabel: t("unsaved.confirm"),
        cancelLabel: t("dialog.cancel"),
        tone: "danger",
      });
      if (!ok) return;
      profileDirtyRef.current = false;
    }
    onOpenWorkspace(agent);
  }, [confirm, onOpenWorkspace, t, workspaceAgent?.id]);

  return (
    <section
      id="agents-panel"
      className="agents-page"
      aria-label={t("agents_page.title")}
      tabIndex={-1}
    >
      <div className="agents-roster" aria-label={t("agents_page.title")}>
        {/* Agents was the only primary route with no PageHeader — it rendered
            with zero headings in the document, so the panel had no title and
            the page had no h1 for the accessibility tree. Mirrors TeamsPage. */}
        <PageHeader
          kicker={t("nav.workforce")}
          title={t("agents_page.title")}
          count={t("agents_page.sub", { count: activeAgents.length })}
          titleVariant="display"
          layout="stacked"
        />

        {isDetailRoute ? null : (
          <RosterFilterBar
            query={query}
            availability={availability}
            onQueryChange={setQuery}
            onAvailabilityChange={setAvailability}
          />
        )}

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
                onSelect={(agent) => void handleSelectAgent(agent)}
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
            onOpenThread={onOpenThread}
            canEditMeta
            onProfileDirtyChange={handleProfileDirtyChange}
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
