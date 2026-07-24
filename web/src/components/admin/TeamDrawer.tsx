"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeeAgents } from "../../hooks/useEmployeeAgents";
import { useRelayMutations } from "../../hooks/useRelayMutations";
import { teamMutationInput } from "../../lib/teamForm";
import type { AgentTeam } from "../../types";
import { Button } from "../ui/button";
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

  useEffect(() => {
    setName(team?.name ?? "");
    setMemberIds(team?.memberAgentIds ?? []);
    setLeadId(team?.leadAgentId ?? "");
  }, [open, team]);

  const { agents: employeeAgents } = useEmployeeAgents(open ? employeeId : undefined);
  const agents = useMemo(
    () => employeeAgents.filter((agent) => !agent.deletedAt),
    [employeeAgents],
  );
  const busy = createTeamMutation.isPending || updateTeamMutation.isPending || deleteTeamMutation.isPending;
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
    if (!name.trim() || !leadId || memberIds.length === 0) return;
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
    <Drawer open={open} onClose={() => { void requestClose(); }} title={team ? t("teams.edit") : t("teams.add")} subtitle={t("teams.drawer_subtitle")} width={500} closeLabel={t("dialog.cancel")} bodyClassName="adm-drawer-body--column">
      <form className="adm-form team-drawer-form" onSubmit={(event) => void submit(event)}>
        <label className="adm-field">
          <span>{t("teams.name")}</span>
          <Input name="team-name" autoComplete="off" value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className="adm-field team-member-fieldset">
          <legend>{t("teams.members")}</legend>
          <div className="team-member-options">
            {agents.map((agent) => (
              <label key={agent.id} className="team-member-option">
                <input type="checkbox" checked={memberIds.includes(agent.id)} onChange={() => toggleMember(agent.id)} />
                <span>{agent.displayName}</span>
                <small>{agent.executorKind}</small>
              </label>
            ))}
          </div>
          {agents.length === 0 ? <span className="adm-form-hint">{t("teams.no_agents")}</span> : null}
        </fieldset>
        <label className="adm-field">
          <span>{t("teams.lead")}</span>
          <Select value={leadId} disabled={memberIds.length === 0} onValueChange={(value) => value && setLeadId(value)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(value: string) => agents.find((agent) => agent.id === value)?.displayName ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {agents.filter((agent) => memberIds.includes(agent.id)).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <div className="adm-form-actions">
          {team ? <Button size="cta" type="button" variant="destructive" className="adm-form-actions-leading" onClick={() => void remove()} disabled={busy}>{t("teams.delete")}</Button> : null}
          <Button size="cta" type="button" variant="outline" onClick={() => { void requestClose(); }} disabled={busy}>{t("dialog.cancel")}</Button>
          <Button size="cta" type="submit" disabled={busy || !name.trim() || !leadId || memberIds.length === 0}>{busy ? t("admin.saving") : team ? t("teams.save") : t("teams.create")}</Button>
        </div>
      </form>
    </Drawer>
  );
}
