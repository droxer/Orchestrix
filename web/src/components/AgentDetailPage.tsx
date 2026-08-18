"use client";

import type { KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getWorkspaceBrief } from "../api";
import type { EmployeeAgent } from "../types";
import { agentLabel } from "../lib/plan";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { AgentMark } from "./AgentMark";
import { AgentPlacementBadge } from "./AgentPlacementBadge";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { IdentityMark } from "./IdentityMark";
import { PageHeader } from "./PageHeader";
import { ProfileImage } from "./ProfileImagePicker";
import { StatusPill } from "./StatusPill";
import { describeAgentPlacements } from "../lib/agentPlacements";
import { truncateId } from "../lib/adminHelpers";
import {
  ActivitiesSkeleton,
  WorkspaceActivities,
  WorkspaceError,
} from "./workspace/WorkspacePrimitives";
import { RecordBand, type RecordFact } from "./workspace/RecordBand";

export type AgentDetailTab = "profile" | "activities";

const DETAIL_TABS: readonly AgentDetailTab[] = ["profile", "activities"];
const ACTIVITY_POLL_MS = 3000;

interface AgentDetailPageProps {
  agent: EmployeeAgent;
  onOpenThread: (sessionId: string) => void;
  canEditMeta?: boolean;
  onProfileDirtyChange?: (dirty: boolean) => void;
}

function parseDetailTab(value: string | null): AgentDetailTab {
  return DETAIL_TABS.includes(value as AgentDetailTab) ? value as AgentDetailTab : "profile";
}

export function AgentDetailPage({
  agent,
  onOpenThread,
  canEditMeta = false,
  onProfileDirtyChange,
}: AgentDetailPageProps) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useUrlSearchState(
    "tab",
    "profile" as AgentDetailTab,
    parseDetailTab,
    (value) => value === "profile" ? null : value,
    "push",
  );
  const activityQuery = useQuery({
    queryKey: ["agent-activity-brief", agent.id],
    refetchInterval: pageTab === "activities" ? ACTIVITY_POLL_MS : false,
    queryFn: ({ signal }) => getWorkspaceBrief({ agentId: agent.id }, signal),
    enabled: pageTab === "activities",
  });
  const brief = activityQuery.data;
  const activitiesLoading = pageTab === "activities" && activityQuery.isLoading && !brief;
  const activitiesError = pageTab === "activities" && !brief && activityQuery.error
    ? activityQuery.error instanceof Error ? activityQuery.error.message : String(activityQuery.error)
    : "";

  function movePageTab(event: KeyboardEvent<HTMLButtonElement>, next: AgentDetailTab): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home"
      ? DETAIL_TABS[0]
      : event.key === "End"
        ? DETAIL_TABS[DETAIL_TABS.length - 1]
        : next;
    setPageTab(target);
    requestAnimationFrame(() => document.getElementById(`agent-detail-tab-${target}`)?.focus());
  }

  const placementDescriptions = describeAgentPlacements(agent.placements);
  const primaryPlacement = placementDescriptions.find(
    ({ placement }) => placement.desiredState === "active",
  ) ?? placementDescriptions[0];

  const bandFacts: RecordFact[] = [
    {
      key: "runtime",
      label: t("admin.v2.agent_runtime"),
      value: (
        <span className="record-band-inline" translate="no">
          <AgentMark agent={agent.executorKind} size={13} />
          {agentLabel(agent.executorKind)}
        </span>
      ),
    },
    {
      key: "computer",
      label: t("agents_page.runtime_host"),
      value: primaryPlacement ? (
        <AgentPlacementBadge description={primaryPlacement} showSandbox />
      ) : (
        <span className="record-band-value--empty">{t("admin.v2.no_runtime_placement")}</span>
      ),
    },
    {
      key: "availability",
      label: t("admin.v2.agent_availability_label"),
      value: <StatusPill value={agent.availability} />,
    },
    {
      key: "id",
      label: t("agents_page.agent_id"),
      value: truncateId(agent.id),
      technical: true,
      title: agent.id,
    },
  ];

  return (
    <section
      id="agent-detail-panel"
      className="workspace-page"
      aria-label={t("agents_page.detail_label", { name: agent.displayName })}
      tabIndex={-1}
    >
      <PageHeader
        kicker={t("nav.workforce")}
        title={(
          <span className="workspace-header-title">
            <span className="workspace-header-mark" aria-hidden="true">
              <ProfileImage
                src={agent.profileImageUrl}
                alt=""
                fallback={<IdentityMark kind="agent" />}
              />
            </span>
            {agent.displayName}
          </span>
        )}
        titleVariant="record"
        titleAs="h2"
        layout="stacked"
        toolbar={(
          <div className="workspace-page-tabs" role="tablist" aria-label={t("agents_page.detail_sections")}>
            {DETAIL_TABS.map((tab, index) => {
              const previous = DETAIL_TABS[index - 1] ?? DETAIL_TABS[DETAIL_TABS.length - 1];
              const next = DETAIL_TABS[index + 1] ?? DETAIL_TABS[0];
              const count = tab === "activities" && brief ? brief.metrics.sessionCount || undefined : undefined;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={`agent-detail-tab-${tab}`}
                  aria-selected={pageTab === tab}
                  aria-controls={pageTab === tab ? `agent-detail-panel-${tab}` : undefined}
                  tabIndex={pageTab === tab ? 0 : -1}
                  className={`workspace-page-tab${pageTab === tab ? " is-active" : ""}`}
                  onClick={() => setPageTab(tab)}
                  onKeyDown={(event) => movePageTab(event, event.key === "ArrowLeft" ? previous : next)}
                >
                  {t(`agents_page.tab_${tab}`)}
                  {count !== undefined ? <span className="workspace-page-tab-count tnum">{count}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      />

      <RecordBand facts={bandFacts} label={t("agents_page.record_label")} />

      <div className="workspace-body">
        {pageTab === "profile" ? (
          <div
            className="workspace-profile"
            role="tabpanel"
            id="agent-detail-panel-profile"
            aria-labelledby="agent-detail-tab-profile"
          >
            <AgentProfilePanel
              agent={agent}
              canEditMeta={canEditMeta}
              variant="detail"
              onDirtyChange={onProfileDirtyChange}
            />
          </div>
        ) : activitiesLoading ? (
          <ActivitiesSkeleton panelId="agent-detail-panel-activities" labelledBy="agent-detail-tab-activities" />
        ) : activitiesError ? (
          <WorkspaceError
            message={activitiesError}
            eyebrow={t("agents_page.activities_load_failed")}
            onRetry={() => void activityQuery.refetch()}
            panelId="agent-detail-panel-activities"
            labelledBy="agent-detail-tab-activities"
          />
        ) : (
          <WorkspaceActivities
            brief={brief}
            panelId="agent-detail-panel-activities"
            labelledBy="agent-detail-tab-activities"
            emptyPulse
            onOpenThread={onOpenThread}
          />
        )}
      </div>
    </section>
  );
}
