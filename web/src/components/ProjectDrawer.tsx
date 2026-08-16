"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { agentsForThreadNode } from "../lib/threadRuntime";
import {
  AGENT_ROLE_OPTIONS,
  type AgentRole,
  type DaemonNodeMonitorRecord,
  type EmployeeAgent,
  type ProjectRecord,
} from "../types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AgentMark } from "./AgentMark";

type MemberDraft = {
  agentId: string;
  role: AgentRole;
  functionTitle: string;
  responsibilities: string;
  instructions: string;
};

export function ProjectDrawer({
  open,
  agents,
  computers,
  onClose,
  onCreated,
}: {
  open: boolean;
  agents: EmployeeAgent[];
  computers: DaemonNodeMonitorRecord[];
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
}) {
  const maxProjectMembers = 32;
  const { t } = useTranslation();
  const { createProjectMutation } = useRelayMutations();
  const [name, setName] = useState("");
  const [computerId, setComputerId] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [leadAgentId, setLeadAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const projectComputers = useMemo(
    () => computers.filter((computer) => computer.capabilities?.includes("project-workspaces")),
    [computers],
  );
  const availableAgents = useMemo(
    () => agentsForThreadNode(agents.filter((agent) => !agent.deletedAt), computerId),
    [agents, computerId],
  );
  const hasUnsavedChanges = Boolean(
    name.trim()
    || computerId
    || members.some((member) => member.functionTitle.trim() || member.responsibilities.trim() || member.instructions.trim()),
  );
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !createProjectMutation.isPending);

  function reset() {
    setName("");
    setComputerId("");
    setMembers([]);
    setLeadAgentId("");
    setError(null);
  }

  async function requestClose() {
    if (createProjectMutation.isPending) return;
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
    if (!computerId) {
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
    try {
      const result = await createProjectMutation.mutateAsync({
        name: name.trim(),
        daemonNodeId: computerId,
        leadAgentId: leadAgentId || null,
        members: members.map((member) => ({
          agentId: member.agentId,
          role: member.role,
          functionTitle: member.functionTitle.trim(),
          responsibilities: member.responsibilities.trim(),
          ...(member.instructions.trim() ? { instructions: member.instructions.trim() } : {}),
        })),
      });
      onClose();
      onCreated(result.project);
    } catch {
      // The shared mutation handler announces the server error; preserve the form.
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      kicker={t("project.setup_kicker")}
      title={t("project.setup_title")}
      subtitle={t("project.setup_subtitle")}
      width="wide"
      closeLabel={t("admin.v2.close_drawer")}
      bodyClassName="adm-drawer-body--column"
      onClosed={reset}
    >
      <form className="project-setup-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="project-setup-intro">
          <div className="project-setup-step"><span>01</span><div><strong>{t("project.setup_step_brief")}</strong><small>{t("project.setup_step_brief_hint")}</small></div></div>
          <div className="project-setup-step"><span>02</span><div><strong>{t("project.setup_step_crew")}</strong><small>{t("project.setup_step_crew_hint")}</small></div></div>
        </div>

        <section className="project-setup-section project-setup-basics" aria-labelledby="project-setup-basics-title">
          <div className="project-setup-section-heading"><span className="project-setup-eyebrow">{t("project.setup_identity")}</span><h2 id="project-setup-basics-title">{t("project.setup_identity_title")}</h2></div>
          <div className="project-setup-basics-grid">
            <Field label={t("project.name")}>
              <Input ref={nameRef} data-modal-initial-focus className="project-name-input" maxLength={120} placeholder={t("project.setup_name_placeholder")} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("project.computer")} hint={projectComputers.length === 0 ? t("project.no_computers") : t("project.setup_computer_hint")}>
              <Select value={computerId} onValueChange={selectComputer}>
                <SelectTrigger className="w-full project-computer-select" disabled={projectComputers.length === 0}><SelectValue placeholder={t("project.choose_computer")} /></SelectTrigger>
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
          ) : <p className="project-empty-hint">{computerId ? t("project.no_agents_on_computer") : t("project.choose_computer_hint")}</p>}
        </section>

        {members.length ? <section className="project-setup-section project-setup-briefs" aria-labelledby="project-setup-briefs-title">
          <div className="project-setup-section-heading"><span className="project-setup-eyebrow">{t("project.setup_briefs")}</span><h2 id="project-setup-briefs-title">{t("project.setup_briefs_title")}</h2></div>
          <Field label={t("project.lead")} hint={t("project.setup_lead_hint")}>
            <Select value={leadAgentId} onValueChange={(value) => setLeadAgentId(value ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{members.map((member) => { const agent = agents.find((candidate) => candidate.id === member.agentId); return <SelectItem key={member.agentId} value={member.agentId}>{agent?.displayName ?? member.agentId}</SelectItem>; })}</SelectContent></Select>
          </Field>
          <div className="project-member-brief-grid">{members.map((member, index) => {
          const agent = agents.find((candidate) => candidate.id === member.agentId);
          return <section key={member.agentId} className="project-member-card">
              <div className="project-member-card-heading"><span className="project-member-index">0{index + 1}</span><div><h3>{agent?.displayName ?? member.agentId}</h3><small>{agent?.executorKind}</small></div></div>
              <Field label={t("project.role")}>
                <Select value={member.role} onValueChange={(value) => updateMember(member.agentId, { role: value as AgentRole })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{AGENT_ROLE_OPTIONS.map((role) => <SelectItem key={role} value={role}>{t(`project.roles.${role}`)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t("project.function_title")}>
                <Input maxLength={120} value={member.functionTitle} onChange={(event) => updateMember(member.agentId, { functionTitle: event.target.value })} />
              </Field>
              <Field label={t("project.responsibilities")}>
                <Textarea maxLength={4000} value={member.responsibilities} onChange={(event) => updateMember(member.agentId, { responsibilities: event.target.value })} />
              </Field>
              <Field label={t("project.instructions")}>
                <Textarea maxLength={8000} value={member.instructions} onChange={(event) => updateMember(member.agentId, { instructions: event.target.value })} />
              </Field>
            </section>;
        })}</div>
        </section> : null}
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <div className="project-setup-actions adm-form-actions">
          <span className="project-setup-action-note">{members.length ? t("project.setup_members_ready", { count: members.length }) : t("project.setup_members_empty")}</span>
          <Button size="cta" type="button" variant="ghost" onClick={() => void requestClose()} disabled={createProjectMutation.isPending}>{t("dialog.cancel")}</Button>
          <Button size="cta" type="submit" loading={createProjectMutation.isPending}>{t("project.create")}</Button>
        </div>
      </form>
    </Drawer>
  );
}
