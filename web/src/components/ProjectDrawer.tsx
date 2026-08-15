"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRelayMutations } from "../hooks/useRelayMutations";
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

  function reset() {
    setName("");
    setComputerId("");
    setMembers([]);
    setLeadAgentId("");
    setError(null);
  }

  function close() {
    if (createProjectMutation.isPending) return;
    reset();
    onClose();
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
    if (!members.length || !leadAgentId) {
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
        leadAgentId,
        members: members.map((member) => ({
          agentId: member.agentId,
          role: member.role,
          functionTitle: member.functionTitle.trim(),
          responsibilities: member.responsibilities.trim(),
          ...(member.instructions.trim() ? { instructions: member.instructions.trim() } : {}),
        })),
      });
      reset();
      onClose();
      onCreated(result.project);
    } catch {
      // The shared mutation handler announces the server error; preserve the form.
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t("project.create")}
      subtitle={t("project.drawer_subtitle")}
      width="form"
      closeLabel={t("admin.v2.close_drawer")}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form project-drawer-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t("project.name")}>
          <Input ref={nameRef} data-modal-initial-focus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t("project.computer")} hint={projectComputers.length === 0 ? t("project.no_computers") : t("project.choose_computer_hint")}>
          <Select value={computerId} onValueChange={selectComputer}>
            <SelectTrigger className="w-full" disabled={projectComputers.length === 0}><SelectValue placeholder={t("project.choose_computer")} /></SelectTrigger>
            <SelectContent>
              {projectComputers.map((computer) => (
                <SelectItem key={computer.id} value={computer.id}>
                  {computer.displayName || computer.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <fieldset className="team-member-fieldset">
          <legend>{t("project.members")}</legend>
          {availableAgents.length > 0 ? (
            <div className="team-member-options">
              {availableAgents.map((agent) => {
                const selected = members.some((member) => member.agentId === agent.id);
                return (
                  <label key={agent.id} className="team-member-option">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleMember(agent)}
                      aria-label={agent.displayName}
                    />
                    <span className="team-member-option-main">
                      <span className="team-member-option-name">{agent.displayName}</span>
                      <span className="team-member-option-meta">{agent.executorKind}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="project-empty-hint">
              {computerId ? t("project.no_agents_on_computer") : t("project.choose_computer_hint")}
            </p>
          )}
        </fieldset>
        {members.length ? (
          <Field label={t("project.lead")}>
            <Select value={leadAgentId} onValueChange={(value) => setLeadAgentId(value ?? "")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {members.map((member) => {
                  const agent = agents.find((candidate) => candidate.id === member.agentId);
                  return <SelectItem key={member.agentId} value={member.agentId}>{agent?.displayName ?? member.agentId}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {members.map((member) => {
          const agent = agents.find((candidate) => candidate.id === member.agentId);
          return (
            <section key={member.agentId} className="project-member-card">
              <h3>{agent?.displayName ?? member.agentId}</h3>
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
            </section>
          );
        })}
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <div className="adm-form-actions">
          <Button size="cta" type="button" variant="ghost" onClick={close} disabled={createProjectMutation.isPending}>{t("dialog.cancel")}</Button>
          <Button size="cta" type="submit" loading={createProjectMutation.isPending}>{t("project.create")}</Button>
        </div>
      </form>
    </Drawer>
  );
}
