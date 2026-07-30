"use client";

import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentTeam, EmployeeAgent, LogicalAgentAvailability, TaskPriority, TaskRoutineCadence, TaskRoutineType, TaskStatus } from "../../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../lib/backlog";
import { TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, isoToday } from "../../lib/routine";
import { teamAvailability } from "../../lib/taskAssignment";
import {
  nextRoutineRunDate,
  parseTaskAssignmentValue,
  taskAssignmentValue,
  teamAssignmentPatch,
  type BacklogTaskFormState,
  type RoutineTaskFormState,
  type TaskBoardFormState,
} from "../../lib/taskBoardForm";
import { Drawer } from "../ui/Drawer";
import { TaskDrawerArtifacts } from "./TaskDrawerArtifacts";
import { AgentMark } from "../AgentMark";
import { AgentStateBadge } from "../AgentStateBadge";
import { NavAgents } from "../icons";
import { TeamMark } from "../TeamMark";
import { ProfileImage } from "../ProfileImagePicker";
import { cn } from "@/lib/utils";

const NO_AGENT = "__none__";

// Status is carried by the glyph's corner pip (the designed agent-state
// indicator), never by a text label. Map availability onto the shared
// `.agent-state` tone classes so agents and teams read the same status
// language as the backlog/routine boards.
function availabilityTone(availability: LogicalAgentAvailability): "tone-good" | "tone-info" | "tone-warn" | "tone-bad" {
  if (availability === "ready") return "tone-good";
  if (availability === "busy") return "tone-info";
  if (availability === "offline") return "tone-bad";
  return "tone-warn";
}

// The picker only reads a handful of fields off an agent/team, so accept a
// narrowed view. This lets us synthesize a placeholder for an assignment that
// references an agent/team no longer present in the fetched roster (deleted or
// scoped out) instead of leaking a raw `agent:<id>` value into the UI.
type AgentView = Pick<EmployeeAgent, "displayName" | "profileImageUrl" | "executorKind" | "enabled" | "availability">;
type TeamView = Pick<AgentTeam, "name" | "profileImageUrl" | "members" | "lead" | "enabled">;

function effectiveAgentAvailability(agent: Pick<EmployeeAgent, "enabled" | "availability">): LogicalAgentAvailability {
  return agent.enabled ? agent.availability : "offline";
}

function AssignmentOption({
  agent,
  team,
}: {
  agent?: AgentView;
  team?: TeamView;
}) {
  const { t } = useTranslation();
  if (agent) {
    const availability = effectiveAgentAvailability(agent);
    return (
      <span className="task-assignment-option">
        <AgentStateBadge
          agent={agent.executorKind}
          ready={availability === "ready"}
          availability={availability}
          imageUrl={agent.profileImageUrl}
        />
        <span className="task-assignment-option-copy">
          <span>{agent.displayName}</span>
          <span>{agent.executorKind}</span>
        </span>
      </span>
    );
  }

  if (!team) return null;
  const availability = teamAvailability(team);
  const stateLabel = `${team.name} · ${t(`status.${availability}`, { defaultValue: availability })}`;
  return (
    <span className="task-assignment-option">
      <span className={cn("agent-state", availabilityTone(availability))} role="img" aria-label={stateLabel} title={stateLabel}>
        <ProfileImage src={team.profileImageUrl} alt="" fallback={<TeamMark size={14} />} />
      </span>
      <span className="task-assignment-option-copy">
        <span>{team.name}</span>
        <span>{t("backlog.team_member_count", { count: team.members.length })}</span>
      </span>
    </span>
  );
}

function AssignmentSummary({
  agent,
  team,
  variant,
  id,
}: {
  agent?: AgentView;
  team?: TeamView;
  variant: TaskBoardFormState["variant"];
  id: string;
}) {
  const { t } = useTranslation();
  const availability = team
    ? teamAvailability(team)
    : agent
      ? effectiveAgentAvailability(agent)
      : undefined;

  if (!agent && !team) {
    return (
      <span id={id} className="task-assignment-summary is-empty" aria-live="polite">
        <span className="task-assignment-summary-mark" aria-hidden="true">
          <NavAgents size={16} />
        </span>
        <span className="task-assignment-summary-copy">
          <span className="task-assignment-summary-title">{t("backlog.assign_later")}</span>
          <span className="task-assignment-summary-meta">
            {t(variant === "backlog" ? "backlog.unassigned_backlog_hint" : "backlog.unassigned_routine_hint")}
          </span>
        </span>
      </span>
    );
  }

  const ready = availability === "ready";
  const leadName = team?.lead?.displayName;
  const name = agent?.displayName ?? team?.name ?? "";
  const statusLabel = availability ? t(`status.${availability}`, { defaultValue: availability }) : "";
  return (
    <span
      id={id}
      className="task-assignment-summary"
      data-tone={availability ? availabilityTone(availability).replace("tone-", "") : undefined}
      aria-live="polite"
    >
      <span className="task-assignment-summary-mark" role="img" aria-label={`${name} · ${statusLabel}`}>
        {agent ? (
          <ProfileImage
            src={agent.profileImageUrl}
            alt=""
            fallback={<AgentMark agent={agent.executorKind} size={18} />}
          />
        ) : (
          <ProfileImage src={team?.profileImageUrl} alt="" fallback={<TeamMark size={20} />} />
        )}
      </span>
      <span className="task-assignment-summary-body">
        <span className="task-assignment-summary-head">
          <span className="task-assignment-summary-title">{name}</span>
        </span>
        <span className="task-assignment-summary-meta">
          {agent
            ? t("backlog.agent_descriptor", { executor: agent.executorKind })
            : t("backlog.team_descriptor", {
                count: team?.members.length ?? 0,
                lead: leadName ?? t("backlog.team_no_lead"),
              })}
        </span>
        {team && team.members.length > 0 ? (
          <span className="task-assignment-roster" aria-label={t("backlog.team_roster")}>
            {team.members.slice(0, 5).map((member) => (
              <span key={member.id} className="task-assignment-member" title={member.displayName}>
                <AgentMark agent={member.executorKind} size={11} />
              </span>
            ))}
            {team.members.length > 5 ? <span className="task-assignment-member-more">+{team.members.length - 5}</span> : null}
          </span>
        ) : null}
        {availability && !ready ? (
          <span className="task-assignment-summary-hint">{t("backlog.assignment_waiting_hint")}</span>
        ) : null}
      </span>
    </span>
  );
}

type TaskDrawerProps = {
  form: TaskBoardFormState;
  logicalAgents: EmployeeAgent[];
  teams?: AgentTeam[];
  saving: boolean;
  title: string;
  subtitle: string;
  deleting?: boolean;
  onClose: () => void;
  onChange: (next: TaskBoardFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  /** Read-only context (status, linked thread, recent activity) shown above the form in edit mode. */
  meta?: ReactNode;
};

function BacklogFields({ form, onChange }: { form: BacklogTaskFormState; onChange: (next: TaskBoardFormState) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("backlog.status")}>
        <Select
          value={form.status}
          onValueChange={(value) => {
            if (value == null) return
            onChange({ ...form, status: value as TaskStatus })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(value: TaskStatus) => t(`backlog.statuses.${value}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status} value={status} label={t(`backlog.statuses.${status}`)}>{t(`backlog.statuses.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("backlog.due")}>
        <Input
          name="backlog-due-date"
          type="date"
          value={form.dueDate}
          onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
        />
      </Field>
    </>
  );
}

function RoutineFields({ form, onChange }: { form: RoutineTaskFormState; onChange: (next: TaskBoardFormState) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("routine.type")}>
        <Select
          value={form.routineType}
          onValueChange={(value) => {
            if (value == null) return
            onChange({ ...form, routineType: value as TaskRoutineType })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(value: TaskRoutineType) => t(`routine.types.${value}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_ROUTINE_TYPES.map((type) => (
              <SelectItem key={type} value={type} label={t(`routine.types.${type}`)}>{t(`routine.types.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("routine.cadence")}>
        <Select
          value={form.routineCadence}
          onValueChange={(value) => {
            if (value == null) return
            const routineCadence = value as TaskRoutineCadence;
            onChange({
              ...form,
              routineCadence,
              routineNextRunDate: routineCadence === "custom"
                ? form.routineNextRunDate
                : nextRoutineRunDate(routineCadence),
            })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(value: TaskRoutineCadence) => t(`routine.cadences.${value}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_ROUTINE_CADENCES.map((cadence) => (
              <SelectItem key={cadence} value={cadence} label={t(`routine.cadences.${cadence}`)}>{t(`routine.cadences.${cadence}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={t("routine.next_run")}
        hint={t("routine.next_run_hint")}
        className="task-drawer-next-run"
      >
        <Input
          name={`${form.variant}-next-run-date`}
          type="date"
          min={isoToday()}
          value={form.routineNextRunDate}
          readOnly={form.routineCadence !== "custom"}
          onChange={(event) => onChange({ ...form, routineNextRunDate: event.target.value })}
        />
      </Field>
    </>
  );
}

export function TaskDrawer({
  form,
  logicalAgents,
  teams = [],
  saving,
  title,
  subtitle,
  deleting = false,
  onClose,
  onChange,
  onSubmit,
  onDelete,
  meta,
}: TaskDrawerProps) {
  const { t } = useTranslation();
  const fieldPrefix = form.variant;
  const assignmentFieldId = `${fieldPrefix}-assignment`;
  const assignmentSummaryId = `${fieldPrefix}-assignment-summary`;
  const busy = saving || deleting;

  function updateBase(patch: Partial<TaskBoardFormState>): void {
    onChange({ ...form, ...patch } as TaskBoardFormState);
  }

  // Ownerless agents/teams (no employeeId/ownerEmployeeId) are globally
  // assignable — mirrors the backend's "ownerless legacy work is allowed"
  // invariant. Without this, an employee-scoped `assigneeEmployeeId` hides
  // every unowned agent and team, leaving the picker empty.
  const agentOptions = logicalAgents.filter((agent) =>
    !form.assigneeEmployeeId
    || !agent.employeeId
    || agent.employeeId === form.assigneeEmployeeId
    || agent.id === form.assignedAgentId
  );
  const teamOptions = teams.filter((team) =>
    !form.assigneeEmployeeId
    || !team.ownerEmployeeId
    || team.ownerEmployeeId === form.assigneeEmployeeId
    || team.id === form.assignedTeamId
  );
  const selectedAgent = agentOptions.find((agent) => agent.id === form.assignedAgentId);
  const selectedTeam = teamOptions.find((team) => team.id === form.assignedTeamId);

  // A saved task can reference an agent/team that has since been deleted or is
  // no longer in the fetched roster. Fall back to the executor kind the task
  // still carries so the trigger and summary render a named placeholder with
  // the right glyph, instead of leaking the raw `agent:<id>` value.
  const assignedTeamView: TeamView | undefined = form.assignedTeamId
    ? selectedTeam ?? { name: t("backlog.assignment_unavailable_team"), members: [], lead: null, enabled: false }
    : undefined;
  const assignedAgentView: AgentView | undefined = !assignedTeamView && form.assignedAgentId
    ? selectedAgent
      ?? (form.assignedAgent
        ? {
            displayName: t("backlog.assignment_unavailable_agent"),
            executorKind: form.assignedAgent,
            enabled: false,
            availability: "offline",
          }
        : undefined)
    : undefined;

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      subtitle={subtitle}
      subtitleMono={form.variant === "backlog" && Boolean(form.id)}
      width={form.variant === "routine" ? 600 : 560}
      closeLabel={t("dialog.cancel")}
      ariaLabel={title}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form task-board-drawer-form" onSubmit={onSubmit}>
        {meta}
        <Field label={t("backlog.title_field")}>
          <Input
            data-modal-initial-focus
            name={`${fieldPrefix}-title`}
            required
            value={form.title}
            onChange={(event) => updateBase({ title: event.target.value })}
          />
        </Field>
        <Field label={t("backlog.description")}>
          <Textarea
            name={`${fieldPrefix}-description`}
            value={form.description}
            rows={5}
            onChange={(event) => updateBase({ description: event.target.value })}
          />
        </Field>
        <div className="task-drawer-form-grid">
          {form.variant === "routine" ? <RoutineFields form={form} onChange={onChange} /> : null}
          <Field label={t("backlog.priority")} wrapper="div" className="task-drawer-form-grid-full">
            <Select
              value={form.priority}
              onValueChange={(value) => {
                if (value == null) return
                updateBase({ priority: value as TaskPriority })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(value: TaskPriority) => t(`backlog.priorities.${value}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority} label={t(`backlog.priorities.${priority}`)}>{t(`backlog.priorities.${priority}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.variant === "backlog" ? <BacklogFields form={form} onChange={onChange} /> : null}
          <Field
            label={t("backlog.assignment_label")}
            wrapper="div"
            htmlFor={assignmentFieldId}
            className="task-assignment-field"
          >
            <Select
              value={taskAssignmentValue(form)}
              onValueChange={(value) => {
                if (value == null) return
                const selection = parseTaskAssignmentValue(value);
                if (selection.kind === "none") {
                  onChange(
                    form.variant === "routine"
                      ? {
                          ...form,
                          assignedAgent: "",
                          assignedAgentId: "",
                          assignedTeamId: "",
                          routineEnabled: false,
                        }
                      : { ...form, assignedAgent: "", assignedAgentId: "", assignedTeamId: "" },
                  );
                  return;
                }
                if (selection.kind === "agent") {
                  const logicalAgent = logicalAgents.find((agent) => agent.id === selection.id);
                  if (!logicalAgent) return;
                  updateBase({
                    assignedAgent: logicalAgent.executorKind,
                    assignedAgentId: logicalAgent.id,
                    assignedTeamId: "",
                    assigneeEmployeeId: logicalAgent.employeeId,
                    ...(form.variant === "routine" ? { routineEnabled: true as const } : {}),
                  });
                  return;
                }
                const team = teams.find((candidate) => candidate.id === selection.id);
                if (team) {
                  updateBase({
                    ...teamAssignmentPatch(team.id),
                    ...(form.variant === "routine" ? { routineEnabled: true as const } : {}),
                  });
                }
              }}
            >
              <SelectTrigger id={assignmentFieldId} aria-describedby={assignmentSummaryId} className="w-full">
                <SelectValue>
                  {(value: string) => {
                    if (value === NO_AGENT) {
                      return t("backlog.assign_later");
                    }
                    if (assignedTeamView) return <AssignmentOption team={assignedTeamView} />;
                    if (assignedAgentView) return <AssignmentOption agent={assignedAgentView} />;
                    return t("backlog.assign_later");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT} label={t("backlog.assign_later")}>
                  <span className="task-assignment-option is-empty">
                    <span className="task-assignment-option-mark" aria-hidden="true"><NavAgents size={14} /></span>
                    <span className="task-assignment-option-copy">
                      <span>{t("backlog.assign_later")}</span>
                      <span>{t("backlog.no_executor")}</span>
                    </span>
                  </span>
                </SelectItem>
                <SelectGroup>
                  <SelectLabel>{t("backlog.agents_section")}</SelectLabel>
                  {agentOptions.map((agent) => (
                    <SelectItem key={agent.id} value={`agent:${agent.id}`} label={`${agent.displayName} · ${agent.executorKind}`}>
                      <AssignmentOption agent={agent} />
                    </SelectItem>
                  ))}
                </SelectGroup>
                {teamOptions.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>{t("backlog.teams_section")}</SelectLabel>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={`team:${team.id}`} label={team.name}>
                        <AssignmentOption team={team} />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
            <AssignmentSummary
              id={assignmentSummaryId}
              agent={assignedAgentView}
              team={assignedTeamView}
              variant={form.variant}
            />
          </Field>
        </div>
        {form.variant === "routine" ? (
          <>
            <div className="routine-toggle">
              <span className="routine-toggle-text">
                <Label render={<span />}>{t("routine.enabled")}</Label>
                <span className="adm-form-hint">{t("routine.enabled_hint")}</span>
              </span>
              <Switch
                name={`${fieldPrefix}-enabled`}
                checked={form.routineEnabled}
                disabled={!form.assignedAgentId && !form.assignedTeamId && !form.routineEnabled}
                onCheckedChange={(checked) => onChange({ ...form, routineEnabled: checked })}
                aria-label={t("routine.enabled")}
              />
            </div>
          </>
        ) : null}
        {form.variant === "backlog" && form.id ? <TaskDrawerArtifacts taskId={form.id} /> : null}
        <div className="adm-form-actions">
          {form.id && onDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="cta"
              className="adm-form-actions-leading"
              onClick={onDelete}
              disabled={busy}
              loading={deleting}
            >
              {deleting ? t("backlog.deleting") : t("backlog.delete_task")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="cta" onClick={onClose} disabled={busy}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" variant="default" size="cta" loading={saving} disabled={deleting}>
            {saving ? t("admin.saving") : t("dialog.confirm")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
