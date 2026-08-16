"use client";

import { useMemo, type CSSProperties, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getWorkspaceBrief } from "../api";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { computerId as stableComputerId } from "../lib/createAgent";
import { agentLabel } from "../lib/plan";
import {
  orderedProjectMembers,
  parseProjectPageTab,
  projectActivitiesState,
  projectMemberState,
  projectPageActions,
  projectPageTabForKey,
  PROJECT_PAGE_TABS,
  type ProjectPageTab,
} from "../lib/projectPage";
import { truncateId, formatRelativeTime } from "../lib/adminHelpers";
import type { DaemonNodeMonitorRecord, EmployeeAgent, ProjectMember, ProjectRecord } from "../types";
import { AgentStateBadge } from "./AgentStateBadge";
import { ActionCompose, ActionEdit, NavBack, WorkspaceFolder } from "./icons";
import { PageHeader } from "./PageHeader";
import { ProjectWorkspaceFiles } from "./ThreadWorkspaceFiles";
import {
  ActivitiesSkeleton,
  WorkspaceActivities,
  WorkspaceEmpty,
  WorkspaceError,
} from "./workspace/WorkspacePrimitives";
import { RecordBand, type RecordFact } from "./workspace/RecordBand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PROJECT_ACTIVITY_POLL_MS = 3000;

function ProjectMark({ size = 18 }: { size?: number }) {
  return (
    <span className="project-mark" aria-hidden="true">
      <WorkspaceFolder size={size} />
    </span>
  );
}

function ProjectMemberLane({
  member,
  agent,
  index,
  lead,
}: {
  member: ProjectMember;
  agent?: EmployeeAgent;
  index: number;
  lead: boolean;
}) {
  const { t } = useTranslation();
  const { available, enabled, availability } = projectMemberState(member, agent);
  const name = agent?.displayName || t("project.member_unavailable");

  return (
    <article
      className={`project-member-lane${lead ? " is-lead" : ""}${available ? "" : " is-missing"}`}
      style={{ "--project-member-index": index } as CSSProperties}
    >
      <header className="project-member-lane-head">
        <span className="project-member-lane-index tnum">{String(index + 1).padStart(2, "0")}</span>
        <AgentStateBadge
          agent={agent?.executorKind}
          ready={enabled && availability === "ready"}
          availability={availability}
          imageUrl={agent?.profileImageUrl}
          name={name}
        />
        <span className="project-member-lane-identity">
          <strong>{name}</strong>
          <span>
            {agent ? agentLabel(agent.executorKind) : member.agentId}
          </span>
        </span>
        <span className="project-member-lane-badges">
          {lead ? <Badge variant="info">{t("project.lead_badge")}</Badge> : null}
          {!member.enabled ? <Badge variant="neutral">{t("project.member_disabled")}</Badge> : null}
          {!available ? <Badge variant="warning">{t("project.member_missing")}</Badge> : null}
        </span>
      </header>

      <div className="project-member-lane-brief">
        <div className="project-member-lane-role">
          <span>{t(`project.roles.${member.role}`)}</span>
          <strong>{member.functionTitle}</strong>
        </div>
        <p>{member.responsibilities}</p>
        {member.instructions ? (
          <div className="project-member-lane-instructions">
            <span>{t("project.instructions_short")}</span>
            <p>{member.instructions}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ProjectProfile({
  project,
  agents,
}: {
  project: ProjectRecord;
  agents: EmployeeAgent[];
}) {
  const { t } = useTranslation();
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const members = useMemo(() => orderedProjectMembers(project), [project]);

  return (
    <div
      className="workspace-profile project-profile"
      role="tabpanel"
      id="project-page-panel-profile"
      aria-labelledby="project-page-tab-profile"
    >
      <div className="project-profile-intro">
        <div>
          <span className="project-profile-eyebrow">{t("project.profile_eyebrow")}</span>
          <h2>{t("project.profile_title")}</h2>
        </div>
        <p>{t("project.profile_body")}</p>
      </div>

      {members.length ? (
        <div className="project-member-lanes">
          {members.map((member, index) => (
            <ProjectMemberLane
              key={member.agentId}
              member={member}
              agent={agentsById.get(member.agentId)}
              index={index}
              lead={member.agentId === project.leadAgentId}
            />
          ))}
        </div>
      ) : (
        <WorkspaceEmpty
          title={t("project.profile_empty")}
          hint={t("project.profile_empty_hint")}
          mark={<ProjectMark />}
        />
      )}
    </div>
  );
}

export function ProjectWorkspacePage({
  project,
  agents,
  computers,
  onOpenThread,
  onNewThread,
  onOpenSettings,
  onBack,
}: {
  project: ProjectRecord;
  agents: EmployeeAgent[];
  computers: DaemonNodeMonitorRecord[];
  onOpenThread: (sessionId: string) => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useUrlSearchState(
    "tab",
    "profile" as ProjectPageTab,
    parseProjectPageTab,
    (value) => value === "profile" ? null : value,
    "push",
  );
  const briefQuery = useQuery({
    queryKey: ["project-workspace-brief", project.id],
    queryFn: ({ signal }) => getWorkspaceBrief({ projectId: project.id }, signal),
    enabled: pageTab === "activities",
    refetchInterval: pageTab === "activities" ? PROJECT_ACTIVITY_POLL_MS : false,
  });
  const computer = computers.find((node) => stableComputerId(node) === project.computerId);
  const computerLabel = computer?.displayName?.trim()
    || project.computerId.replace(/^device:[^:]+:/, "");
  const state = project.archivedAt ? "archived" : project.enabled ? "active" : "disabled";
  const bandFacts: RecordFact[] = [
    {
      key: "state",
      label: t("project.band_state"),
      value: (
        <Badge variant={state === "active" ? "success" : state === "disabled" ? "warning" : "neutral"}>
          {t(`project.state_${state}`)}
        </Badge>
      ),
    },
    {
      key: "computer",
      label: t("project.computer"),
      value: computerLabel,
      title: project.computerId,
    },
    {
      key: "updated",
      label: t("workspace.band_updated"),
      value: formatRelativeTime(project.updatedAt, t),
    },
    {
      key: "id",
      label: t("project.band_id"),
      value: truncateId(project.id),
      technical: true,
      title: project.id,
    },
  ];

  function movePageTab(event: KeyboardEvent<HTMLButtonElement>) {
    const target = projectPageTabForKey(pageTab, event.key);
    if (!target) return;
    event.preventDefault();
    setPageTab(target);
    requestAnimationFrame(() => document.getElementById(`project-page-tab-${target}`)?.focus());
  }

  const error = briefQuery.error instanceof Error
    ? briefQuery.error.message
    : briefQuery.error
      ? String(briefQuery.error)
      : "";
  const actions = projectPageActions(project);
  const activitiesState = projectActivitiesState({
    isLoading: briefQuery.isLoading,
    hasData: Boolean(briefQuery.data),
    hasError: Boolean(error),
  });

  return (
    <section id="project-detail-panel" className="workspace-page project-workspace-page" aria-label={t("project.page_label", { project: project.name })} tabIndex={-1}>
      <PageHeader
        kicker={t("project.page_kicker")}
        title={(
          <span className="workspace-header-title">
            <span className="workspace-header-mark"><ProjectMark size={14} /></span>
            {project.name}
          </span>
        )}
        subtitle={t("project.page_subtitle", { count: project.members.length })}
        titleVariant="display"
        layout="stacked"
        actions={(
          <>
            <Button type="button" variant="ghost" size="sm" className="project-mobile-back" onClick={onBack}>
              <NavBack size={14} aria-hidden="true" />
              {t("project.back")}
            </Button>
            {actions.settings ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
                <ActionEdit size={14} aria-hidden="true" />
                {t("project.edit")}
              </Button>
            ) : null}
            {actions.newThread ? (
              <Button
                type="button"
                size="sm"
                onClick={onNewThread}
                aria-label={t("project.new_thread", { project: project.name })}
              >
                <ActionCompose size={14} aria-hidden="true" />
                <span className="project-new-thread-label-wide">{t("project.new_thread", { project: project.name })}</span>
                <span className="project-new-thread-label-compact">{t("project.new_thread_short")}</span>
              </Button>
            ) : null}
          </>
        )}
        toolbar={(
          <div className="workspace-page-tabs" role="tablist" aria-label={t("project.sections")}>
            {PROJECT_PAGE_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`project-page-tab-${tab}`}
                aria-selected={pageTab === tab}
                aria-controls={pageTab === tab ? `project-page-panel-${tab}` : undefined}
                tabIndex={pageTab === tab ? 0 : -1}
                className={`workspace-page-tab${pageTab === tab ? " is-active" : ""}`}
                onClick={() => setPageTab(tab)}
                onKeyDown={movePageTab}
              >
                {tab === "profile"
                  ? t("workspace.tab_profile")
                  : tab === "workspace"
                    ? t("workspace.tab_workspace")
                    : t("workspace.tab_activities")}
                {tab === "activities" && briefQuery.data?.metrics.sessionCount ? (
                  <span className="workspace-page-tab-count tnum">{briefQuery.data.metrics.sessionCount}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      />
      <RecordBand facts={bandFacts} label={t("project.band_label")} />

      <div className="workspace-body">
        {pageTab === "profile" ? (
          <ProjectProfile project={project} agents={agents} />
        ) : pageTab === "workspace" ? (
          <div className="workspace-inspect" role="tabpanel" id="project-page-panel-workspace" aria-labelledby="project-page-tab-workspace">
            <ProjectWorkspaceFiles projectId={project.id} emptyMark={<ProjectMark />} />
          </div>
        ) : activitiesState === "loading" ? (
          <ActivitiesSkeleton panelId="project-page-panel-activities" labelledBy="project-page-tab-activities" />
        ) : activitiesState === "error" || !briefQuery.data ? (
          <WorkspaceError
            message={error || t("workspace.load_failed")}
            onRetry={() => void briefQuery.refetch()}
            panelId="project-page-panel-activities"
            labelledBy="project-page-tab-activities"
          />
        ) : (
          <WorkspaceActivities
            brief={briefQuery.data}
            panelId="project-page-panel-activities"
            labelledBy="project-page-tab-activities"
            emptyMark={<ProjectMark />}
            onOpenThread={onOpenThread}
          />
        )}
      </div>
    </section>
  );
}
