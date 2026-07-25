"use client";

import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { deleteTeamProfileImage, getTeamArtifacts, getWorkspaceBrief, updateTeamProfileImage } from "../api";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { TEAMS_QUERY_KEY } from "../hooks/useTeams";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { agentLabel } from "../lib/plan";
import { teamReady } from "../lib/taskAssignment";
import { teamMutationInput } from "../lib/teamForm";
import { compactDate } from "../lib/workspaceFormat";
import type { AgentTeam, ArtifactIndexItem, WorkspaceBriefResponse, WorkspaceBriefSession, WorkspaceBriefTask } from "../types";
import { ActionEdit, AdminDelete, NavRefresh, ViewBoard } from "./icons";
import { AgentStateBadge } from "./AgentStateBadge";
import { PageHeader } from "./PageHeader";
import { TeamMark } from "./TeamMark";
import { ProfileImage, ProfileImagePicker } from "./ProfileImagePicker";
import { ArtifactBody } from "./artifact/ArtifactBody";
import { ArtifactsEmpty } from "./artifact/ArtifactsEmpty";
import { MetricItem, WorkspaceEmpty, WorkspaceLoading } from "./workspace/WorkspacePrimitives";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useDialogs } from "./ui/DialogProvider";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type TeamPageTab = "profile" | "artifacts" | "activities";

const TEAM_PAGE_TABS: readonly TeamPageTab[] = ["profile", "artifacts", "activities"];
const TEAM_BRIEF_POLL_MS = 3000;

function parseTeamTab(value: string | null): TeamPageTab {
  return TEAM_PAGE_TABS.includes(value as TeamPageTab) ? value as TeamPageTab : "activities";
}

function WorkspaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="workspace-error" role="alert">
      <p>{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t("workspace.retry")}</Button>
    </div>
  );
}

function sessionTitle(session: WorkspaceBriefSession): string {
  return session.title?.trim() || session.taskGoal?.trim() || session.id;
}

function taskTitle(task: WorkspaceBriefTask): string {
  return task.title?.trim() || task.id;
}

function ActivitySection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="workspace-activity-section">
      <header className="workspace-activity-head">
        <h2>{title}</h2>
        <span className="mono">{count}</span>
      </header>
      {children}
    </section>
  );
}

function ActivityRow({ title, meta, onClick }: { title: string; meta: string; onClick?: () => void }) {
  const className = `workspace-pick workspace-activity-pick${onClick ? "" : " is-static"}`;
  const content = (
    <>
      <span className="workspace-pick-title">{title}</span>
      <span className="workspace-pick-meta mono">{meta}</span>
    </>
  );
  return onClick
    ? <button type="button" className={className} onClick={onClick}>{content}</button>
    : <div className={className}>{content}</div>;
}

function TeamProfile({
  team,
  employeeId,
  onDeleted,
}: {
  team: AgentTeam;
  employeeId?: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const { updateTeamMutation, deleteTeamMutation } = useRelayMutations();
  const { agents: employeeAgents } = useEmployeeAgents(employeeId);
  const agents = useMemo(
    () => employeeAgents.filter((agent) => !agent.deletedAt),
    [employeeAgents],
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [memberIds, setMemberIds] = useState<string[]>(team.memberAgentIds);
  const [leadId, setLeadId] = useState(team.leadAgentId ?? "");
  const [imageSaving, setImageSaving] = useState(false);
  const readyMembers = team.members.filter((member) => member.enabled && member.availability === "ready").length;
  const busy = updateTeamMutation.isPending || deleteTeamMutation.isPending || imageSaving;
  const draftDirty = name.trim() !== team.name.trim()
    || leadId !== (team.leadAgentId ?? "")
    || memberIds.length !== team.memberAgentIds.length
    || memberIds.some((id) => !team.memberAgentIds.includes(id));
  const confirmDiscardChanges = useUnsavedChangesGuard(editing && draftDirty && !busy);

  function applyTeamUpdate(updated: AgentTeam) {
    queryClient.setQueriesData<{ teams: AgentTeam[] }>(
      { queryKey: [TEAMS_QUERY_KEY] },
      (current) => current
        ? { teams: current.teams.map((item) => item.id === updated.id ? updated : item) }
        : current,
    );
  }

  async function uploadImage(dataUrl: string) {
    setImageSaving(true);
    try {
      const result = await updateTeamProfileImage(team.id, dataUrl);
      applyTeamUpdate(result.team);
    } finally {
      setImageSaving(false);
    }
  }

  async function removeImage() {
    setImageSaving(true);
    try {
      const result = await deleteTeamProfileImage(team.id);
      applyTeamUpdate(result.team);
    } finally {
      setImageSaving(false);
    }
  }

  function resetDraft() {
    setName(team.name);
    setMemberIds(team.memberAgentIds);
    setLeadId(team.leadAgentId ?? "");
  }

  function startEditing() {
    resetDraft();
    setEditing(true);
  }

  async function cancelEditing() {
    if (!(await confirmDiscardChanges())) return;
    resetDraft();
    setEditing(false);
  }

  function toggleMember(agentId: string) {
    setMemberIds((current) => {
      if (current.includes(agentId)) {
        const next = current.filter((id) => id !== agentId);
        if (leadId === agentId) setLeadId(next[0] ?? "");
        return next;
      }
      const next = [...current, agentId];
      if (!leadId) setLeadId(agentId);
      return next;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || memberIds.length === 0 || !leadId) return;
    try {
      await updateTeamMutation.mutateAsync({
        teamId: team.id,
        input: teamMutationInput({
          name,
          memberAgentIds: memberIds,
          leadAgentId: leadId,
          enabled: team.enabled,
        }),
      });
      setEditing(false);
    } catch {
      // The shared mutation handler announces the error and leaves the form editable.
    }
  }

  async function remove() {
    if (!(await confirm({
      title: t("teams.delete_title", { name: team.name }),
      message: t("teams.delete_message", { name: team.name }),
      confirmLabel: t("teams.delete"),
      tone: "danger",
    }))) return;
    try {
      await deleteTeamMutation.mutateAsync(team.id);
      onDeleted();
    } catch {
      // The shared mutation handler announces the error and keeps the profile open.
    }
  }

  return (
    <div className="workspace-profile" role="tabpanel" id="team-page-panel-profile" aria-labelledby="team-page-tab-profile">
      <div className="workspace-profile-panel workspace-profile-dossier team-profile-dossier">
        <header className="workspace-dossier-hero">
          <ProfileImagePicker
            imageUrl={team.profileImageUrl}
            name={team.name}
            fallback={<TeamMark size={23} />}
            editable
            disabled={busy}
            onUpload={uploadImage}
            onRemove={removeImage}
          />
          <p className="workspace-dossier-blurb">{t("teams.profile_blurb")}</p>
          <div className="workspace-dossier-status">
            <span
              className={`workspace-status-pip tone-${team.enabled ? "good" : "neutral"}`}
              role="img"
              aria-label={team.enabled ? t("teams.enabled") : t("teams.disabled")}
              title={team.enabled ? t("teams.enabled") : t("teams.disabled")}
            />
            <span className="workspace-dossier-runtime mono">
              {t("teams.ready_members", { ready: readyMembers, count: team.members.length })}
            </span>
          </div>
        </header>

        <form className="team-profile-inline-form" onSubmit={(event) => void save(event)}>
          <section className="workspace-dossier-name" aria-labelledby="team-profile-name">
            <div className="workspace-dossier-instructions-head">
              <h2 id="team-profile-name">{t("teams.name")}</h2>
              {!editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="workspace-dossier-icon-btn"
                  aria-label={t("teams.edit")}
                  title={t("teams.edit")}
                  onClick={startEditing}
                >
                  <ActionEdit size={14} aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            {editing ? (
              <Input
                name="team-name"
                type="text"
                aria-label={t("teams.name")}
                autoComplete="off"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") void cancelEditing();
                }}
                disabled={busy}
              />
            ) : (
              <p className="workspace-dossier-name-value">{team.name}</p>
            )}
          </section>

          <section className="team-profile-section" aria-labelledby="team-profile-members">
            <div className="team-profile-section-head">
              <h2 id="team-profile-members" className="workspace-dossier-section-title">{t("teams.members")}</h2>
              <span className="mono">{editing ? memberIds.length : team.members.length}</span>
            </div>
            {editing ? (
              <fieldset className="team-profile-member-fieldset" aria-label={t("teams.members")}>
                <div className="team-member-options team-profile-member-options">
                  {agents.map((agent) => (
                    <label key={agent.id} className="team-member-option">
                      <input
                        type="checkbox"
                        checked={memberIds.includes(agent.id)}
                        onChange={() => toggleMember(agent.id)}
                        disabled={busy}
                      />
                      <span>{agent.displayName}</span>
                      <small>{agentLabel(agent.executorKind)}</small>
                    </label>
                  ))}
                </div>
                {agents.length === 0 ? <span className="adm-form-hint">{t("teams.no_agents")}</span> : null}
              </fieldset>
            ) : (
              <ul className="team-profile-members">
                {team.members.map((member) => {
                  const ready = member.enabled && member.availability === "ready";
                  return (
                    <li key={member.id} className="team-profile-member">
                      <AgentStateBadge
                        agent={member.executorKind}
                        ready={ready}
                        availability={member.enabled ? member.availability : undefined}
                        imageUrl={member.profileImageUrl}
                      />
                      <span className="team-profile-member-copy">
                        <strong>{member.displayName}</strong>
                        <small>{agentLabel(member.executorKind)}</small>
                      </span>
                      {member.id === team.leadAgentId ? <Badge variant="outline">{t("teams.lead_badge")}</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {editing ? (
            <>
              <label className="adm-field team-profile-lead-field">
                <span>{t("teams.lead")}</span>
                <Select value={leadId} disabled={busy || memberIds.length === 0} onValueChange={(value) => value && setLeadId(value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(value: string) => agents.find((agent) => agent.id === value)?.displayName ?? value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {agents.filter((agent) => memberIds.includes(agent.id)).map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="team-profile-inline-actions">
                <span className="team-profile-inline-actions-spacer" />
                <Button type="button" variant="ghost" onClick={() => void cancelEditing()} disabled={busy}>
                  {t("dialog.cancel")}
                </Button>
                <Button type="submit" disabled={busy || !name.trim() || memberIds.length === 0 || !leadId}>
                  {busy ? t("admin.saving") : t("teams.save")}
                </Button>
              </div>
            </>
          ) : null}
        </form>

        <section className="adm-drawer-section" aria-labelledby="team-profile-danger-title">
          <p id="team-profile-danger-title" className="workspace-dossier-section-title">
            {t("admin.v2.danger_zone")}
          </p>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
            <AdminDelete size={14} aria-hidden="true" />
            {deleteTeamMutation.isPending ? t("teams.deleting") : t("teams.delete")}
          </Button>
        </section>
      </div>
    </div>
  );
}

function TeamArtifacts({
  artifacts,
  selected,
  isLoading,
  onSelect,
  onOpenThread,
}: {
  artifacts: ArtifactIndexItem[];
  selected?: ArtifactIndexItem;
  isLoading: boolean;
  onSelect: (artifact: ArtifactIndexItem) => void;
  onOpenThread: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="workspace-inspect" role="tabpanel" id="team-page-panel-artifacts" aria-labelledby="team-page-tab-artifacts">
      {/* No artifacts means nothing to preview — the empty state owns the
          whole panel instead of sitting beside a dead preview pane. */}
      {artifacts.length === 0 ? (
        isLoading ? (
          <WorkspaceLoading label={t("workspace.loading")} />
        ) : (
          <ArtifactsEmpty title={t("workspace.no_artifacts")} hint={t("workspace.empty_artifacts_hint")} />
        )
      ) : (
      <div className="workspace-panes">
        <section className="workspace-pane workspace-pane-browse" aria-label={t("workspace.artifacts")}>
          <div className="workspace-pane-body">
            <ul className="workspace-pick-list">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    className={`workspace-pick${selected?.id === artifact.id ? " is-active" : ""}`}
                    aria-pressed={selected?.id === artifact.id}
                    onClick={() => onSelect(artifact)}
                  >
                    <span className={`artifact-kind-tag is-${artifact.kind}`}>{t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind })}</span>
                    <span className="workspace-pick-title">{artifact.title}</span>
                    <span className="workspace-pick-meta mono">{compactDate(artifact.createdAt, i18n.language)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="workspace-pane workspace-pane-preview" aria-label={t("workspace.preview")}>
          <header className="workspace-pane-head">
            <h2>{selected?.title ?? t("workspace.preview")}</h2>
            {selected ? (
              <div className="workspace-pane-head-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenThread(selected.sessionId)}>
                  {t("workspace.open_thread")}
                </Button>
              </div>
            ) : null}
          </header>
          <div className="workspace-pane-body workspace-preview-body">
            {selected ? (
              <div className="workspace-preview-viewport workspace-preview-viewport--artifact">
                <div className="artifact-viewer-body"><ArtifactBody artifact={selected} sessionId={selected.sessionId} /></div>
              </div>
            ) : (
              <WorkspaceEmpty title={t("workspace.select_to_preview")} hint={t("workspace.empty_preview_hint")} mark={<ViewBoard size={18} />} />
            )}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}

function TeamActivities({ team, brief, onOpenThread }: { team: AgentTeam; brief: WorkspaceBriefResponse; onOpenThread: (sessionId: string) => void }) {
  const { t, i18n } = useTranslation();
  const hasActivity = brief.activeRuns.length > 0 || brief.sessions.length > 0 || brief.tasks.length > 0;
  const available = teamReady(team);

  return (
    <div className="workspace-inspect workspace-activities" role="tabpanel" id="team-page-panel-activities" aria-labelledby="team-page-tab-activities">
      <div className="workspace-metric-strip" aria-label={t("workspace.metrics")}>
        <MetricItem label={t("workspace.metric_runs")} value={brief.metrics.activeRunCount} emphasis={brief.metrics.activeRunCount > 0} live={brief.metrics.activeRunCount > 0} />
        <MetricItem label={t("workspace.metric_tasks")} value={brief.metrics.activeTaskCount} zero={brief.metrics.activeTaskCount === 0} />
        <MetricItem label={t("workspace.metric_sessions")} value={brief.metrics.sessionCount} zero={brief.metrics.sessionCount === 0} />
        <MetricItem label={t("workspace.metric_artifacts")} value={brief.metrics.artifactCount} zero={brief.metrics.artifactCount === 0} />
        <div className="workspace-metric-item workspace-metric-item--status">
          <span className={`workspace-status-pill tone-${available ? "good" : "neutral"}`}>{available ? t("teams.available") : t("teams.unavailable")}</span>
        </div>
      </div>
      <div className="workspace-activity-sections">
        {brief.activeRuns.length ? (
          <ActivitySection title={t("workspace.activity_runs")} count={brief.activeRuns.length}>
            <ul className="workspace-pick-list">
              {brief.activeRuns.map((run) => (
                <li key={run.runId}>
                  <ActivityRow
                    title={run.taskGoal}
                    meta={[agentLabel(run.agent), t(`mode.${run.mode}`, { defaultValue: run.mode }), compactDate(run.startedAt, i18n.language)].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(run.sessionId)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}
        {brief.sessions.length ? (
          <ActivitySection title={t("workspace.activity_threads")} count={brief.sessions.length}>
            <ul className="workspace-pick-list">
              {brief.sessions.map((session) => (
                <li key={session.id}>
                  <ActivityRow
                    title={sessionTitle(session)}
                    meta={[
                      session.status ? t(`backlog.statuses.${session.status}`, { defaultValue: session.status }) : "",
                      session.runCount ? t("workspace.session_runs", { count: session.runCount }) : "",
                      session.artifactCount ? t("workspace.session_artifacts", { count: session.artifactCount }) : "",
                      compactDate(session.updatedAt, i18n.language),
                    ].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(session.id)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}
        {brief.tasks.length ? (
          <ActivitySection title={t("workspace.activity_tasks")} count={brief.tasks.length}>
            <ul className="workspace-pick-list">
              {brief.tasks.map((task) => {
                const sessionId = task.linkedSessionIds[0];
                return (
                  <li key={task.id}>
                    <ActivityRow
                      title={taskTitle(task)}
                      meta={[
                        task.status ? t(`backlog.statuses.${task.status}`, { defaultValue: task.status }) : "",
                        task.dueDate ? t("workspace.task_due", { date: compactDate(task.dueDate, i18n.language) }) : "",
                        compactDate(task.updatedAt, i18n.language),
                      ].filter(Boolean).join(" · ")}
                      onClick={sessionId ? () => onOpenThread(sessionId) : undefined}
                    />
                  </li>
                );
              })}
            </ul>
          </ActivitySection>
        ) : null}
        {!hasActivity ? <WorkspaceEmpty title={t("workspace.no_activity")} hint={t("workspace.empty_activity_hint")} mark={<TeamMark size={18} />} /> : null}
      </div>
    </div>
  );
}

export function TeamWorkspacePage({
  team,
  employeeId,
  isRefreshing,
  onRefresh,
  onOpenThread,
  onDeleted,
}: {
  team: AgentTeam;
  employeeId?: string;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useUrlSearchState("teamTab", "activities" as TeamPageTab, parseTeamTab, (value) => value === "activities" ? null : value);
  const [selectedArtifactId, setSelectedArtifactId] = useUrlSearchState("teamArtifact", "", (value) => value ?? "", (value) => value || null);
  const briefQuery = useQuery({
    queryKey: ["team-workspace-brief", team.id],
    queryFn: ({ signal }) => getWorkspaceBrief({ teamId: team.id }, signal),
    enabled: pageTab === "activities",
    refetchInterval: pageTab === "activities" ? TEAM_BRIEF_POLL_MS : false,
  });
  const artifactsQuery = useQuery({
    queryKey: ["team-artifacts", team.id],
    queryFn: ({ signal }) => getTeamArtifacts(team.id, signal),
    enabled: pageTab === "artifacts",
  });
  const artifacts = artifactsQuery.data?.artifacts ?? [];
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId);

  async function refreshTeam(): Promise<void> {
    await Promise.all([
      pageTab === "activities" ? briefQuery.refetch() : Promise.resolve(),
      pageTab === "artifacts" ? artifactsQuery.refetch() : Promise.resolve(),
      onRefresh(),
    ]);
  }

  function movePageTab(event: KeyboardEvent<HTMLButtonElement>, previous: TeamPageTab, next: TeamPageTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? TEAM_PAGE_TABS[0] : event.key === "End" ? TEAM_PAGE_TABS.at(-1)! : event.key === "ArrowLeft" ? previous : next;
    setPageTab(target);
    requestAnimationFrame(() => document.getElementById(`team-page-tab-${target}`)?.focus());
  }

  const error = briefQuery.error instanceof Error ? briefQuery.error.message : briefQuery.error ? String(briefQuery.error) : "";
  return (
    <section className="workspace-page team-workspace-page" aria-label={t("teams.profile_title", { name: team.name })}>
      <PageHeader
        kicker={t("teams.title")}
        title={(
          <span className="workspace-header-title">
            <span className="workspace-header-mark" aria-hidden="true">
              <ProfileImage
                src={team.profileImageUrl}
                alt=""
                fallback={<TeamMark size={15} />}
              />
            </span>
            {team.name}
          </span>
        )}
        subtitle={t("teams.profile_sub", { count: team.members.length })}
        titleVariant="display"
        layout="stacked"
        toolbar={(
          <div className="workspace-page-tabs" role="tablist" aria-label={t("teams.sections")}>
            {TEAM_PAGE_TABS.map((tab, index) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`team-page-tab-${tab}`}
                aria-selected={pageTab === tab}
                aria-controls={pageTab === tab ? `team-page-panel-${tab}` : undefined}
                tabIndex={pageTab === tab ? 0 : -1}
                className={`workspace-page-tab${pageTab === tab ? " is-active" : ""}`}
                onClick={() => setPageTab(tab)}
                onKeyDown={(event) => movePageTab(event, TEAM_PAGE_TABS[index - 1] ?? TEAM_PAGE_TABS.at(-1)!, TEAM_PAGE_TABS[index + 1] ?? TEAM_PAGE_TABS[0])}
              >
                {tab === "profile" ? t("workspace.tab_profile") : tab === "artifacts" ? t("workspace.artifacts") : t("workspace.tab_activities")}
                {tab === "artifacts" && artifacts.length ? <span className="workspace-page-tab-count mono">{artifacts.length}</span> : null}
                {tab === "activities" && briefQuery.data?.metrics.sessionCount ? <span className="workspace-page-tab-count mono">{briefQuery.data.metrics.sessionCount}</span> : null}
              </button>
            ))}
          </div>
        )}
        actions={(
          <Button type="button" variant="outline" size="icon" aria-label={t("nav.refresh")} disabled={isRefreshing || briefQuery.isFetching || artifactsQuery.isFetching} onClick={() => void refreshTeam()}>
            <NavRefresh size={16} className={isRefreshing || briefQuery.isFetching || artifactsQuery.isFetching ? "spin" : undefined} />
          </Button>
        )}
      />
      {pageTab === "profile" ? (
        <TeamProfile team={team} employeeId={employeeId} onDeleted={onDeleted} />
      ) : pageTab === "artifacts" ? (
        <TeamArtifacts artifacts={artifacts} selected={selectedArtifact} isLoading={artifactsQuery.isLoading} onSelect={(artifact) => setSelectedArtifactId(artifact.id)} onOpenThread={onOpenThread} />
      ) : briefQuery.isLoading && !briefQuery.data ? (
        <WorkspaceLoading label={t("workspace.loading")} />
      ) : error || !briefQuery.data ? (
        <WorkspaceError message={error || t("workspace.load_failed")} onRetry={() => void briefQuery.refetch()} />
      ) : (
        <TeamActivities team={team} brief={briefQuery.data} onOpenThread={onOpenThread} />
      )}
    </section>
  );
}
