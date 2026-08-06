"use client";

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { deleteTeamProfileImage, getWorkspaceBrief, updateTeamProfileImage } from "../api";
import { useEmployeeAgents } from "../hooks/useEmployeeAgents";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { TEAMS_QUERY_KEY } from "../hooks/useTeams";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { agentLabel } from "../lib/plan";
import { teamReady } from "../lib/taskAssignment";
import {
  canAddAgentToNodeScopedTeam,
  nodeScopedTeamIssue,
  teamMutationInput,
} from "../lib/teamForm";
import { teamWorkspaceAgentId } from "../lib/teamWorkspace";
import type { AgentTeam } from "../types";
import { ActionEdit, AdminDelete, NavRefresh } from "./icons";
import { AgentStateBadge } from "./AgentStateBadge";
import { PageHeader } from "./PageHeader";
import { IdentityMonogram } from "./IdentityMonogram";
import { TeamMark } from "./TeamMark";
import { TeamMemberOption } from "./TeamMemberOption";
import { ProfileImage, ProfileImagePicker } from "./ProfileImagePicker";
import { ActivitiesSkeleton, WorkspaceActivities, WorkspaceEmpty, WorkspaceError } from "./workspace/WorkspacePrimitives";
import { WorkspaceFilesBrowser } from "./AgentWorkspacePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TeamPageTab = "profile" | "workspace" | "activities";

const TEAM_PAGE_TABS: readonly TeamPageTab[] = ["profile", "workspace", "activities"];
const TEAM_BRIEF_POLL_MS = 3000;

function parseTeamTab(value: string | null): TeamPageTab {
  return TEAM_PAGE_TABS.includes(value as TeamPageTab) ? value as TeamPageTab : "activities";
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
  const [validationError, setValidationError] = useState<
    "members" | "lead" | "unplaced" | "different-nodes" | null
  >(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const membersRef = useRef<HTMLFieldSetElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);
  const readyMembers = team.members.filter((member) => member.enabled && member.availability === "ready").length;
  const selectedAgents = useMemo(
    () => agents.filter((agent) => memberIds.includes(agent.id)),
    [agents, memberIds],
  );
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
    setValidationError(null);
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
    setValidationError(null);
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
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (memberIds.length === 0) {
      setValidationError("members");
      membersRef.current?.focus();
      return;
    }
    const nodeIssue = nodeScopedTeamIssue(agents, memberIds);
    if (nodeIssue) {
      setValidationError(nodeIssue);
      membersRef.current?.focus();
      return;
    }
    if (!leadId) {
      setValidationError("lead");
      leadRef.current?.focus();
      return;
    }
    setValidationError(null);
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
            fallback={<IdentityMonogram name={team.name} size={22} />}
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
            <span className="workspace-dossier-runtime tnum">
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
                ref={nameRef}
                name="team-name"
                type="text"
                aria-label={t("teams.name")}
                autoComplete="off"
                autoFocus
                required
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
              <span className="tnum">{editing ? memberIds.length : team.members.length}</span>
            </div>
            {editing ? (
              <fieldset
                ref={membersRef}
                className="team-profile-member-fieldset"
                aria-label={t("teams.members")}
                tabIndex={-1}
                aria-invalid={validationError && validationError !== "lead" ? true : undefined}
                aria-describedby={validationError && validationError !== "lead" ? "team-profile-members-error" : undefined}
              >
                <div className="team-member-options team-profile-member-options">
                  {agents.map((agent) => {
                    const selected = memberIds.includes(agent.id);
                    const incompatible = !selected
                      && !canAddAgentToNodeScopedTeam(agent, selectedAgents);
                    return (
                      <TeamMemberOption
                        key={agent.id}
                        agentId={agent.id}
                        displayName={agent.displayName}
                        executorKind={agent.executorKind}
                        selected={selected}
                        incompatible={incompatible}
                        disabled={busy}
                        onToggle={toggleMember}
                      />
                    );
                  })}
                </div>
                {agents.length === 0 ? <span className="adm-form-hint">{t("teams.no_agents")}</span> : null}
                {validationError && validationError !== "lead" ? (
                  <span id="team-profile-members-error" className="text-sm text-danger" role="alert">
                    {validationError === "members"
                      ? t("teams.members_required")
                      : validationError === "unplaced"
                        ? t("teams.members_unplaced")
                        : t("teams.members_different_nodes")}
                  </span>
                ) : null}
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
                        name={member.displayName}
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
              <Field
                label={t("teams.lead")}
                wrapper="div"
                className="team-profile-lead-field"
                error={validationError === "lead" ? t("teams.lead_required") : undefined}
                errorId="team-profile-lead-error"
              >
                <Select value={leadId} disabled={busy || memberIds.length === 0} onValueChange={(value) => {
                  if (value) setLeadId(value);
                  setValidationError(null);
                }}>
                  <SelectTrigger
                    ref={leadRef}
                    className="w-full"
                    aria-invalid={validationError === "lead" || undefined}
                    aria-describedby={validationError === "lead" ? "team-profile-lead-error" : undefined}
                  >
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
              </Field>
              <div className="team-profile-inline-actions">
                <span className="team-profile-inline-actions-spacer" />
                <Button type="button" variant="ghost" onClick={() => void cancelEditing()} disabled={busy}>
                  {t("dialog.cancel")}
                </Button>
                <Button type="submit" loading={updateTeamMutation.isPending} loadingLabel={t("admin.saving")} disabled={deleteTeamMutation.isPending || imageSaving}>
                  {t("teams.save")}
                </Button>
              </div>
            </>
          ) : null}
        </form>

        <section className="adm-drawer-section" aria-labelledby="team-profile-danger-title">
          <p id="team-profile-danger-title" className="workspace-dossier-section-title">
            {t("admin.v2.danger_zone")}
          </p>
          <Button type="button" variant="destructive" onClick={() => void remove()} loading={deleteTeamMutation.isPending} loadingLabel={t("teams.deleting")} disabled={updateTeamMutation.isPending || imageSaving}>
            <AdminDelete size={14} aria-hidden="true" />
            {t("teams.delete")}
          </Button>
        </section>
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
  const [pageTab, setPageTab] = useUrlSearchState("tab", "activities" as TeamPageTab, parseTeamTab, (value) => value === "activities" ? null : value, "push");
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0);
  const briefQuery = useQuery({
    queryKey: ["team-workspace-brief", team.id],
    queryFn: ({ signal }) => getWorkspaceBrief({ teamId: team.id }, signal),
    enabled: pageTab !== "profile",
    refetchInterval: pageTab === "activities" ? TEAM_BRIEF_POLL_MS : false,
  });
  const workspaceAgentId = teamWorkspaceAgentId(team);

  async function refreshTeam(): Promise<void> {
    if (pageTab === "workspace") setWorkspaceRefreshVersion((current) => current + 1);
    await Promise.all([
      pageTab !== "profile" ? briefQuery.refetch() : Promise.resolve(),
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
        kicker={t("nav.workforce")}
        title={(
          <span className="workspace-header-title">
            <span className="workspace-header-mark" aria-hidden="true">
              <ProfileImage
                src={team.profileImageUrl}
                alt=""
                fallback={<IdentityMonogram name={team.name} size={10} />}
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
                {tab === "profile" ? t("workspace.tab_profile") : tab === "workspace" ? t("workspace.tab_workspace") : t("workspace.tab_activities")}
                {tab === "activities" && briefQuery.data?.metrics.sessionCount ? <span className="workspace-page-tab-count tnum">{briefQuery.data.metrics.sessionCount}</span> : null}
              </button>
            ))}
          </div>
        )}
        actions={(
          <Button type="button" variant="outline" size="icon" aria-label={t("nav.refresh")} disabled={isRefreshing || (pageTab === "activities" && briefQuery.isFetching)} onClick={() => void refreshTeam()}>
            <NavRefresh size={16} className={isRefreshing || (pageTab === "activities" && briefQuery.isFetching) ? "spin" : undefined} />
          </Button>
        )}
      />
      {pageTab === "profile" ? (
        <TeamProfile team={team} employeeId={employeeId} onDeleted={onDeleted} />
      ) : pageTab === "workspace" ? (
        <div className="workspace-inspect" role="tabpanel" id="team-page-panel-workspace" aria-labelledby="team-page-tab-workspace">
          {workspaceAgentId ? (
            <WorkspaceFilesBrowser
              agentId={workspaceAgentId}
              teamId={team.id}
              threads={briefQuery.data?.sessions ?? []}
              fixedScope="shared"
              emptyMark={<TeamMark size={18} />}
              refreshVersion={workspaceRefreshVersion}
            />
          ) : (
            <WorkspaceEmpty title={t("teams.no_workspace")} mark={<TeamMark size={18} />} announce />
          )}
        </div>
      ) : briefQuery.isLoading && !briefQuery.data ? (
        <ActivitiesSkeleton panelId="team-page-panel-activities" labelledBy="team-page-tab-activities" />
      ) : error || !briefQuery.data ? (
        <WorkspaceError
          message={error || t("workspace.load_failed")}
          onRetry={() => void briefQuery.refetch()}
          panelId="team-page-panel-activities"
          labelledBy="team-page-tab-activities"
        />
      ) : (
        <WorkspaceActivities
          brief={briefQuery.data}
          panelId="team-page-panel-activities"
          labelledBy="team-page-tab-activities"
          statusPill={(
            <span className={`workspace-status-pill tone-${teamReady(team) ? "good" : "neutral"}`}>
              {teamReady(team) ? t("teams.available") : t("teams.unavailable")}
            </span>
          )}
          emptyMark={<TeamMark size={18} />}
          onOpenThread={onOpenThread}
        />
      )}
    </section>
  );
}
