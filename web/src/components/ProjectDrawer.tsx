"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { computerId as stableComputerId } from "../lib/createAgent";
import { agentsForThreadNode } from "../lib/threadRuntime";
import {
  AGENT_ROLE_OPTIONS,
  type AgentRole,
  type DaemonNodeMonitorRecord,
  type EmployeeAgent,
  type ProjectRecord,
} from "../types";
import { AgentMark } from "./AgentMark";
import { AdminDelete } from "./icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type MemberDraft = {
  agentId: string;
  role: AgentRole;
  functionTitle: string;
  responsibilities: string;
  instructions: string;
  enabled: boolean;
};

function projectDraftKey(
  name: string,
  computerId: string,
  members: MemberDraft[],
  leadAgentId: string,
): string {
  return JSON.stringify({ name, computerId, members, leadAgentId });
}

export function ProjectDrawer({
  open,
  agents,
  computers,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  agents: EmployeeAgent[];
  computers: DaemonNodeMonitorRecord[];
  project?: ProjectRecord | null;
  onClose: () => void;
  onSaved: (project: ProjectRecord) => void;
}) {
  const maxProjectMembers = 32;
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const { createProjectMutation, updateProjectMutation, archiveProjectMutation } = useRelayMutations();
  const [name, setName] = useState("");
  const [computerId, setComputerId] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [leadAgentId, setLeadAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const initializedKeyRef = useRef<string | null>(null);
  const initialDraftKeyRef = useRef(projectDraftKey("", "", [], ""));
  const projectComputers = useMemo(
    () => computers.filter((computer) => computer.capabilities?.includes("project-workspaces")),
    [computers],
  );
  const projectRuntimeNodeId = useMemo(() => (
    project
      ? computers.find((computer) => stableComputerId(computer) === project.computerId)?.id ?? ""
      : ""
  ), [computers, project]);
  const selectedComputerId = project ? projectRuntimeNodeId : computerId;
  const availableAgents = useMemo(
    () => agentsForThreadNode(agents.filter((agent) => !agent.deletedAt), selectedComputerId),
    [agents, selectedComputerId],
  );
  const busy = createProjectMutation.isPending || updateProjectMutation.isPending || archiveProjectMutation.isPending;

  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = null;
      return;
    }
    const initializationKey = project ? `${project.id}:${project.version}` : "new";
    if (initializedKeyRef.current === initializationKey) return;
    initializedKeyRef.current = initializationKey;
    if (!project) {
      reset();
      initialDraftKeyRef.current = projectDraftKey("", "", [], "");
      return;
    }
    const draftMembers = project.members.map((member) => ({
      agentId: member.agentId,
      role: member.role,
      functionTitle: member.functionTitle,
      responsibilities: member.responsibilities,
      instructions: member.instructions ?? "",
      enabled: member.enabled,
    }));
    setName(project.name);
    setComputerId(projectRuntimeNodeId);
    setMembers(draftMembers);
    setLeadAgentId(project.leadAgentId ?? "");
    setError(null);
    initialDraftKeyRef.current = projectDraftKey(
      project.name,
      projectRuntimeNodeId,
      draftMembers,
      project.leadAgentId ?? "",
    );
  }, [open, project, projectRuntimeNodeId]);
  const currentDraftKey = projectDraftKey(name, computerId, members, leadAgentId);
  const hasUnsavedChanges = initializedKeyRef.current !== null && currentDraftKey !== initialDraftKeyRef.current;
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !busy);

  function reset() {
    setName("");
    setComputerId("");
    setMembers([]);
    setLeadAgentId("");
    setError(null);
  }

  async function requestClose() {
    if (busy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  function selectComputer(value: string | null) {
    setComputerId(value ?? "");
    setMembers([]);
    setLeadAgentId("");
    setError(null);
  }

  function toggleMember(agent: EmployeeAgent) {
    setMembers((current) => {
      const selected = current.some((member) => member.agentId === agent.id);
      if (!selected && current.length >= maxProjectMembers) {
        setError(t("project.members_too_many", { count: maxProjectMembers }));
        return current;
      }
      const next = selected
        ? current.filter((member) => member.agentId !== agent.id)
        : [
            ...current,
            {
              agentId: agent.id,
              role: agent.defaultRole ?? "implementer",
              functionTitle: agent.displayName,
              responsibilities: "",
              instructions: "",
              enabled: true,
            },
          ];
      if (selected && leadAgentId === agent.id) setLeadAgentId(next[0]?.agentId ?? "");
      if (!selected && !leadAgentId) setLeadAgentId(agent.id);
      return next;
    });
    setError(null);
  }

  function updateMember(agentId: string, patch: Partial<MemberDraft>) {
    setMembers((current) => current.map((member) => (
      member.agentId === agentId ? { ...member, ...patch } : member
    )));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("project.name_required"));
      nameRef.current?.focus();
      return;
    }
    if (!selectedComputerId) {
      setError(t("project.computer_required"));
      return;
    }
    if (members.length && !leadAgentId) {
      setError(t("project.members_required"));
      return;
    }
    if (members.some((member) => !member.functionTitle.trim() || !member.responsibilities.trim())) {
      setError(t("project.member_fields_required"));
      return;
    }
    const roster = members.map((member) => ({
      agentId: member.agentId,
      role: member.role,
      functionTitle: member.functionTitle.trim(),
      responsibilities: member.responsibilities.trim(),
      ...(member.instructions.trim() ? { instructions: member.instructions.trim() } : {}),
      enabled: member.enabled,
    }));
    try {
      const result = project
        ? await updateProjectMutation.mutateAsync({
            projectId: project.id,
            input: {
              expectedVersion: project.version,
              name: name.trim(),
              leadAgentId: leadAgentId || null,
              members: roster,
            },
          })
        : await createProjectMutation.mutateAsync({
            name: name.trim(),
            daemonNodeId: computerId,
            leadAgentId: leadAgentId || null,
            members: roster,
          });
      onClose();
      onSaved(result.project);
    } catch {
      // The shared mutation handler announces the server error; preserve the form.
    }
  }

  async function archive() {
    if (!project || busy) return;
    const accepted = await confirm({
      title: t("project.archive_confirm_title", { project: project.name }),
      message: t("project.archive_confirm_message"),
      confirmLabel: t("project.archive"),
      tone: "danger",
    });
    if (!accepted) return;
    try {
      const result = await archiveProjectMutation.mutateAsync({
        projectId: project.id,
        expectedVersion: project.version,
      });
      onClose();
      onSaved(result.project);
    } catch {
      // The shared mutation handler announces the error and keeps settings open.
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      kicker={t("project.setup_kicker")}
      title={t(project ? "project.edit" : "project.setup_title")}
      subtitle={t(project ? "project.edit_subtitle" : "project.setup_subtitle")}
      width="wide"
      closeLabel={t("admin.v2.close_drawer")}
      bodyClassName="adm-drawer-body--column"
      onClosed={reset}
    >
      <form className="project-setup-form" onSubmit={(event) => void submit(event)} noValidate>
        {!project ? (
          <div className="project-setup-intro">
            <div className="project-setup-step"><span>01</span><div><strong>{t("project.setup_step_brief")}</strong><small>{t("project.setup_step_brief_hint")}</small></div></div>
            <div className="project-setup-step"><span>02</span><div><strong>{t("project.setup_step_crew")}</strong><small>{t("project.setup_step_crew_hint")}</small></div></div>
          </div>
        ) : null}

        <section className="project-setup-section project-setup-basics" aria-labelledby="project-setup-basics-title">
          <div className="project-setup-section-heading"><span className="project-setup-eyebrow">{t("project.setup_identity")}</span><h2 id="project-setup-basics-title">{t("project.setup_identity_title")}</h2></div>
          <div className="project-setup-basics-grid">
            <Field label={t("project.name")}>
              <Input ref={nameRef} data-modal-initial-focus className="project-name-input" maxLength={120} placeholder={t("project.setup_name_placeholder")} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("project.computer")} hint={projectComputers.length === 0 ? t("project.no_computers") : t("project.setup_computer_hint")}>
              <Select value={selectedComputerId} onValueChange={selectComputer}>
                <SelectTrigger className="w-full project-computer-select" disabled={Boolean(project) || projectComputers.length === 0}><SelectValue placeholder={t("project.choose_computer")} /></SelectTrigger>
                <SelectContent>
                  {projectComputers.map((computer) => <SelectItem key={computer.id} value={computer.id}>{computer.displayName || computer.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        <section className="project-setup-section" aria-labelledby="project-setup-roster-title">
          <div className="project-setup-section-heading project-setup-roster-heading"><div><span className="project-setup-eyebrow">{t("project.setup_roster")}</span><h2 id="project-setup-roster-title">{t("project.setup_roster_title")}</h2></div><span className="project-setup-count">{members.length.toString().padStart(2, "0")} / 32 {t("project.setup_selected")}</span></div>
          {availableAgents.length > 0 ? (
            <div className="project-setup-agent-grid">
              {availableAgents.map((agent) => {
                const selected = members.some((member) => member.agentId === agent.id);
                return (
                  <label key={agent.id} className={`project-agent-option${selected ? " is-selected" : ""}`}>
                    <Checkbox checked={selected} onCheckedChange={() => toggleMember(agent)} aria-label={agent.displayName} />
                    <span className="project-agent-mark"><AgentMark agent={agent.executorKind} size={18} /></span>
                    <span className="project-agent-copy"><strong>{agent.displayName}</strong><small>{agent.executorKind} · {agent.availability}</small></span>
                    <span className="project-agent-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
                  </label>
                );
              })}
            </div>
          ) : <p className="project-empty-hint">{selectedComputerId ? t("project.no_agents_on_computer") : t("project.choose_computer_hint")}</p>}
        </section>

        {members.length ? (
          <section className="project-setup-section project-setup-briefs" aria-labelledby="project-setup-briefs-title">
            <div className="project-setup-section-heading"><span className="project-setup-eyebrow">{t("project.setup_briefs")}</span><h2 id="project-setup-briefs-title">{t("project.setup_briefs_title")}</h2></div>
            <Field label={t("project.lead")} hint={t("project.setup_lead_hint")}>
              <Select value={leadAgentId} onValueChange={(value) => setLeadAgentId(value ?? "")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{members.map((member) => { const agent = agents.find((candidate) => candidate.id === member.agentId); return <SelectItem key={member.agentId} value={member.agentId}>{agent?.displayName ?? member.agentId}</SelectItem>; })}</SelectContent>
              </Select>
            </Field>
            <div className="project-member-brief-grid">{members.map((member, index) => {
              const agent = agents.find((candidate) => candidate.id === member.agentId);
              return (
                <section key={member.agentId} className="project-member-card">
                  <div className="project-member-card-heading"><span className="project-member-index">{String(index + 1).padStart(2, "0")}</span><div><h3>{agent?.displayName ?? member.agentId}</h3><small>{agent?.executorKind}</small></div></div>
                  <Field label={t("project.role")}>
                    <Select value={member.role} onValueChange={(value) => updateMember(member.agentId, { role: value as AgentRole })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{AGENT_ROLE_OPTIONS.map((role) => <SelectItem key={role} value={role}>{t(`project.roles.${role}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("project.function_title")}><Input maxLength={120} value={member.functionTitle} onChange={(event) => updateMember(member.agentId, { functionTitle: event.target.value })} /></Field>
                  <Field label={t("project.responsibilities")}><Textarea maxLength={4000} value={member.responsibilities} onChange={(event) => updateMember(member.agentId, { responsibilities: event.target.value })} /></Field>
                  <Field label={t("project.instructions")}><Textarea maxLength={8000} value={member.instructions} onChange={(event) => updateMember(member.agentId, { instructions: event.target.value })} /></Field>
                </section>
              );
            })}</div>
          </section>
        ) : null}
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <div className="project-setup-actions adm-form-actions">
          {project ? (
            <Button size="cta" type="button" variant="destructive" onClick={() => void archive()} loading={archiveProjectMutation.isPending} loadingLabel={t("project.archiving")} disabled={updateProjectMutation.isPending}>
              <AdminDelete size={14} aria-hidden="true" />
              {t("project.archive")}
            </Button>
          ) : null}
          <span className="project-setup-action-note">{members.length ? t("project.setup_members_ready", { count: members.length }) : t("project.setup_members_empty")}</span>
          <Button size="cta" type="button" variant="ghost" onClick={() => void requestClose()} disabled={busy}>{t("dialog.cancel")}</Button>
          <Button size="cta" type="submit" loading={createProjectMutation.isPending || updateProjectMutation.isPending}>{t(project ? "project.save" : "project.create")}</Button>
        </div>
      </form>
    </Drawer>
  );
}
