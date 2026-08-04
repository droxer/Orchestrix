"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeeAgents } from "../../hooks/useEmployeeAgents";
import { useRelayMutations } from "../../hooks/useRelayMutations";
import {
  canAddAgentToNodeScopedTeam,
  nodeScopedTeamIssue,
  teamMutationInput,
} from "../../lib/teamForm";
import type { AgentTeam } from "../../types";
import { Button } from "../ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useDialogs } from "../ui/DialogProvider";
import { Drawer } from "../ui/Drawer";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

export function TeamDrawer({
  open,
  team,
  employeeId,
  onClose,
}: {
  open: boolean;
  team?: AgentTeam | null;
  employeeId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const { createTeamMutation, updateTeamMutation, deleteTeamMutation } = useRelayMutations();
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [validationError, setValidationError] = useState<
    "members" | "lead" | "unplaced" | "different-nodes" | null
  >(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const membersRef = useRef<HTMLFieldSetElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setName(team?.name ?? "");
    setMemberIds(team?.memberAgentIds ?? []);
    setLeadId(team?.leadAgentId ?? "");
    setValidationError(null);
  }, [open, team]);

  const { agents: employeeAgents } = useEmployeeAgents(open ? employeeId : undefined);
  const agents = useMemo(
    () => employeeAgents.filter((agent) => !agent.deletedAt),
    [employeeAgents],
  );
  const selectedAgents = useMemo(
    () => agents.filter((agent) => memberIds.includes(agent.id)),
    [agents, memberIds],
  );
  const busy = createTeamMutation.isPending || updateTeamMutation.isPending || deleteTeamMutation.isPending;
  const saving = createTeamMutation.isPending || updateTeamMutation.isPending;
  const hasUnsavedChanges = open && (
    name.trim() !== (team?.name ?? "").trim()
    || leadId !== (team?.leadAgentId ?? "")
    || memberIds.length !== (team?.memberAgentIds ?? []).length
    || memberIds.some((id) => !(team?.memberAgentIds ?? []).includes(id))
  );
  const confirmDiscardChanges = useUnsavedChangesGuard(hasUnsavedChanges && !busy);

  async function requestClose() {
    if (busy) return;
    if (await confirmDiscardChanges()) onClose();
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

  async function submit(event: FormEvent<HTMLFormElement>) {
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
    const input = teamMutationInput({
      name,
      leadAgentId: leadId,
      memberAgentIds: memberIds,
      enabled: team?.enabled ?? true,
    });
    try {
      if (team) await updateTeamMutation.mutateAsync({ teamId: team.id, input });
      else await createTeamMutation.mutateAsync(input);
      onClose();
    } catch {
      // The shared mutation error handler keeps the drawer open for correction.
    }
  }

  async function remove() {
    if (!team) return;
    if (!(await confirm({
      title: t("teams.delete_title", { name: team.name }),
      message: t("teams.delete_message", { name: team.name }),
      confirmLabel: t("teams.delete"),
      tone: "danger",
    }))) return;
    try {
      await deleteTeamMutation.mutateAsync(team.id);
      onClose();
    } catch {
      // Error already announced.
    }
  }

  return (
    <Drawer open={open} onClose={() => { void requestClose(); }} title={team ? t("teams.edit") : t("teams.add")} subtitle={t("teams.drawer_subtitle")} width={500} closeLabel={t("admin.v2.close_drawer")} ariaLabel={team ? t("teams.edit") : t("teams.add")} bodyClassName="adm-drawer-body--column">
      <form className="adm-form team-drawer-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t("teams.name")}>
          <Input
            ref={nameRef}
            data-modal-initial-focus
            name="team-name"
            autoComplete="off"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <fieldset
          ref={membersRef}
          className="team-member-fieldset"
          tabIndex={-1}
          aria-invalid={validationError && validationError !== "lead" ? true : undefined}
          aria-describedby={validationError && validationError !== "lead" ? "team-members-error" : undefined}
        >
          <legend>{t("teams.members")}</legend>
          <div className="team-member-options">
            {agents.map((agent) => {
              const selected = memberIds.includes(agent.id);
              const incompatible = !selected
                && !canAddAgentToNodeScopedTeam(agent, selectedAgents);
              return (
                <label
                  key={agent.id}
                  className="team-member-option"
                  title={incompatible ? t("teams.node_scope_required") : undefined}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={incompatible}
                    onChange={() => toggleMember(agent.id)}
                  />
                  <span>{agent.displayName}</span>
                  <small>{agent.executorKind}</small>
                </label>
              );
            })}
          </div>
          {agents.length === 0 ? <span className="adm-form-hint">{t("teams.no_agents")}</span> : null}
          {validationError && validationError !== "lead" ? (
            <span id="team-members-error" className="text-sm text-danger" role="alert">
              {validationError === "members"
                ? t("teams.members_required")
                : validationError === "unplaced"
                  ? t("teams.members_unplaced")
                  : t("teams.members_different_nodes")}
            </span>
          ) : null}
        </fieldset>
        <Field label={t("teams.lead")}>
          <Select value={leadId} disabled={memberIds.length === 0} onValueChange={(value) => {
            if (value) setLeadId(value);
            setValidationError(null);
          }}>
            <SelectTrigger
              ref={leadRef}
              className="w-full"
              aria-invalid={validationError === "lead" || undefined}
              aria-describedby={validationError === "lead" ? "team-lead-error" : undefined}
            >
              <SelectValue>
                {(value: string) => agents.find((agent) => agent.id === value)?.displayName ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {agents.filter((agent) => memberIds.includes(agent.id)).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          {validationError === "lead" ? <span id="team-lead-error" className="text-sm text-danger" role="alert">{t("teams.lead_required")}</span> : null}
        </Field>
        <div className="adm-form-actions">
          {team ? <Button size="cta" type="button" variant="destructive" className="adm-form-actions-leading" onClick={() => void remove()} disabled={busy} loading={deleteTeamMutation.isPending}>{t("teams.delete")}</Button> : null}
          <Button size="cta" type="button" variant="ghost" onClick={() => { void requestClose(); }} disabled={busy}>{t("dialog.cancel")}</Button>
          <Button size="cta" type="submit" loading={saving} disabled={deleteTeamMutation.isPending}>{saving ? t("admin.saving") : team ? t("teams.save") : t("teams.create")}</Button>
        </div>
      </form>
    </Drawer>
  );
}
