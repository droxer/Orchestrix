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
import { teamAvailability, teamReady } from "../lib/taskAssignment";
import { teamMutationInput } from "../lib/teamForm";
import { teamWorkspaceAgentId } from "../lib/teamWorkspace";
import type { AgentTeam } from "../types";
import { ActionEdit, AdminDelete } from "./icons";
import { AgentStateBadge } from "./AgentStateBadge";
import { PageHeader } from "./PageHeader";
import { IdentityMonogram } from "./IdentityMonogram";
import { TeamMark } from "./TeamMark";
import { TeamMemberOption } from "./TeamMemberOption";
import { ProfileImage, ProfileImagePicker } from "./ProfileImagePicker";
import { ActivitiesSkeleton, WorkspaceActivities, WorkspaceEmpty, WorkspaceError } from "./workspace/WorkspacePrimitives";
import { WorkspaceFilesBrowser } from "./AgentWorkspacePage";
import { RecordBand, type RecordFact } from "./workspace/RecordBand";
import { StatusPill } from "./StatusPill";
import { truncateId } from "../lib/adminHelpers";
import { formatRelativeTime } from "./admin/helpers";
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
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [memberIds, setMemberIds] = useState<string[]>(team.memberAgentIds);
  const [leadId, setLeadId] = useState(team.leadAgentId ?? "");
  const [imageSaving, setImageSaving] = useState(false);
  const [validationError, setValidationError] = useState<
    "members" | "lead" | null
  >(null);
  const membersRef = useRef<HTMLFieldSetElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);
  const busy = updateTeamMutation.isPending || deleteTeamMutation.isPending
    || imageSaving;
  const draftDirty = leadId !== (team.leadAgentId ?? "")
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
    setMemberIds(team.memberAgentIds);
    setLeadId(team.leadAgentId ?? "");
    setValidationError(null);
  }

  function startRename() {
    setNameDraft(team.name);
    setRenaming(true);
  }

  async function saveRename() {
    const next = nameDraft.trim();
    if (!next) return;
    if (next === team.name.trim()) {
      setRenaming(false);
      return;
    }
    try {
      await updateTeamMutation.mutateAsync({
        teamId: team.id,
        input: teamMutationInput({
          name: next,
          memberAgentIds: team.memberAgentIds,
          leadAgentId: team.leadAgentId ?? "",
          enabled: team.enabled,
        }),
      });
      setRenaming(false);
    } catch {
      // The shared mutation handler announces the error and keeps the draft open.
    }
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
    if (memberIds.length === 0) {
      setValidationError("members");
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
          name: team.name,
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
      {/* Same dossier grammar as the agent record: a document column holding
          the thing you can change (the roster), an identity rail beside it,
          and record-wide management below both. Facts that only name the
          record (status, member count, id) live in the RecordBand above. */}
      <div className="workspace-profile-panel workspace-profile-dossier">
        <div className="workspace-dossier-doc">
          <form className="team-profile-inline-form" onSubmit={(event) => void save(event)}>
            <section aria-labelledby="team-profile-members">
              <div className="team-profile-section-head">
                <h2 id="team-profile-members" className="workspace-dossier-section-title">{t("teams.members")}</h2>
                <span className="team-profile-section-head-side">
                  <span className="tnum">{editing ? memberIds.length : team.members.length}</span>
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
                </span>
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
                      return (
                        <TeamMemberOption
                          key={agent.id}
                          agentId={agent.id}
                          displayName={agent.displayName}
                          executorKind={agent.executorKind}
                          selected={selected}
                          disabled={busy}
                          onToggle={toggleMember}
                        />
                      );
                    })}
                  </div>
                  {agents.length === 0 ? <span className="adm-form-hint">{t("teams.no_agents")}</span> : null}
                  {validationError && validationError !== "lead" ? (
                    <span id="team-profile-members-error" className="text-sm text-danger" role="alert">
                      {t("teams.members_required")}
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
        </div>

        <aside className="workspace-dossier-rail" aria-label={t("workspace.identity_label")}>
          <div className="workspace-dossier-portrait">
            <ProfileImagePicker
              imageUrl={team.profileImageUrl}
              name={team.name}
              fallback={<IdentityMonogram name={team.name} size={22} />}
              editable
              disabled={busy}
              onUpload={uploadImage}
              onRemove={removeImage}
            />
          </div>

          <div className="workspace-dossier-field">
            <span className="workspace-dossier-field-label">{t("teams.name")}</span>
            {renaming ? (
              <div className="workspace-dossier-rename">
                <Input
                  name="team-name"
                  type="text"
                  aria-label={t("teams.name")}
                  autoComplete="off"
                  autoFocus
                  required
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveRename();
                    if (event.key === "Escape") setRenaming(false);
                  }}
                  disabled={busy}
                />
                <div className="workspace-dossier-rename-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenaming(false)}
                    disabled={busy}
                  >
                    {t("dialog.cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void saveRename()}
                    disabled={busy}
                  >
                    {t("teams.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="workspace-dossier-name-row">
                <span className="workspace-dossier-name-value" translate="no">{team.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="workspace-dossier-icon-btn"
                  aria-label={t("teams.edit")}
                  title={t("teams.edit")}
                  onClick={startRename}
                >
                  <ActionEdit size={14} aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>

          <p className="workspace-dossier-stamp">
            {t("admin.v2.agent_meta_created", { time: formatRelativeTime(team.createdAt, t) })}
            {" · "}
            {t("admin.v2.agent_meta_updated", { time: formatRelativeTime(team.updatedAt, t) })}
          </p>
        </aside>

        {/* Management spans both columns — it acts on the whole record, not
            on the roster document or the identity rail. */}
        <div className="workspace-dossier-admin">
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
    </div>
  );
}

export function TeamWorkspacePage({
  team,
  employeeId,
  onOpenThread,
  onDeleted,
}: {
  team: AgentTeam;
  employeeId?: string;
  onOpenThread: (sessionId: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useUrlSearchState("tab", "activities" as TeamPageTab, parseTeamTab, (value) => value === "activities" ? null : value, "push");
  const briefQuery = useQuery({
    queryKey: ["team-workspace-brief", team.id],
    queryFn: ({ signal }) => getWorkspaceBrief({ teamId: team.id }, signal),
    enabled: pageTab !== "profile",
    refetchInterval: pageTab === "activities" ? TEAM_BRIEF_POLL_MS : false,
  });
  const workspaceAgentId = teamWorkspaceAgentId(team);

  /* The band is the record's read-only spine, identical on all three tabs —
     the same rule the agent record follows: facts live here and no tab panel
     may restate them. Every field comes off the team record itself. */
  const bandFacts: RecordFact[] = [
    {
      key: "availability",
      label: t("admin.v2.agent_availability_label"),
      value: !team.enabled
        ? <Badge variant="neutral">{t("teams.disabled")}</Badge>
        : <StatusPill value={teamAvailability(team)} />,
    },
    {
      key: "members",
      label: t("teams.members"),
      value: <span className="tnum">{team.members.length}</span>,
    },
    {
      key: "lead",
      label: t("teams.lead"),
      value: team.lead?.displayName ?? <span className="record-band-value--empty">—</span>,
    },
    {
      key: "id",
      label: t("workspace.band_team_id"),
      value: truncateId(team.id),
      technical: true,
      title: team.id,
    },
  ];

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
      />
      <RecordBand facts={bandFacts} label={t("workspace.band_team_label")} />

      {/* One body shell for all three tabs, matching the agent record — it
          owns the container query the profile dossier grid reads. */}
      <div className="workspace-body">
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
      </div>
    </section>
  );
}
