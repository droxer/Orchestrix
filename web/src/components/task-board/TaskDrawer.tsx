"use client";

import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeAgent, TaskPriority, TaskRoutineCadence, TaskRoutineType, TaskStatus } from "../../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../lib/backlog";
import { TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES, isoToday } from "../../lib/routine";
import { nextRoutineRunDate, type BacklogTaskFormState, type RoutineTaskFormState, type TaskBoardFormState } from "../../lib/taskBoardForm";
import { Drawer } from "../admin/Drawer";
import { TaskDrawerArtifacts } from "./TaskDrawerArtifacts";

const NO_AGENT = "__none__";

type TaskDrawerProps = {
  form: TaskBoardFormState;
  logicalAgents: EmployeeAgent[];
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
      <label className="adm-field">
        <span>{t("backlog.status")}</span>
        <Select
          value={form.status}
          onValueChange={(value) => {
            if (value == null) return
            onChange({ ...form, status: value as TaskStatus })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{t(`backlog.statuses.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="adm-field">
        <span>{t("backlog.due")}</span>
        <Input
          name="backlog-due-date"
          type="date"
          value={form.dueDate}
          onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
        />
      </label>
    </>
  );
}

function RoutineFields({ form, onChange }: { form: RoutineTaskFormState; onChange: (next: TaskBoardFormState) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <label className="adm-field">
        <span>{t("routine.type")}</span>
        <Select
          value={form.routineType}
          onValueChange={(value) => {
            if (value == null) return
            onChange({ ...form, routineType: value as TaskRoutineType })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_ROUTINE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{t(`routine.types.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="adm-field">
        <span>{t("routine.cadence")}</span>
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_ROUTINE_CADENCES.map((cadence) => (
              <SelectItem key={cadence} value={cadence}>{t(`routine.cadences.${cadence}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </>
  );
}

export function TaskDrawer({
  form,
  logicalAgents,
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
  const busy = saving || deleting;

  function updateBase(patch: Partial<TaskBoardFormState>): void {
    onChange({ ...form, ...patch } as TaskBoardFormState);
  }

  const agentOptions = logicalAgents.filter((agent) =>
    !form.assigneeEmployeeId
    || agent.employeeId === form.assigneeEmployeeId
    || agent.id === form.assignedAgentId
  );

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      subtitle={subtitle}
      width={form.variant === "routine" ? 520 : 420}
      closeLabel={t("dialog.cancel")}
      ariaLabel={title}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form task-board-drawer-form" onSubmit={onSubmit}>
        {meta}
        <label className="adm-field">
          <span>{t("backlog.title_field")}</span>
          <Input
            name={`${fieldPrefix}-title`}
            required
            value={form.title}
            onChange={(event) => updateBase({ title: event.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("backlog.description")}</span>
          <Textarea
            name={`${fieldPrefix}-description`}
            value={form.description}
            rows={5}
            onChange={(event) => updateBase({ description: event.target.value })}
          />
        </label>
        <div className="task-drawer-form-grid">
          {form.variant === "routine" ? <RoutineFields form={form} onChange={onChange} /> : null}
          <label className="adm-field">
            <span>{t("backlog.priority")}</span>
            <Select
              value={form.priority}
              onValueChange={(value) => {
                if (value == null) return
                updateBase({ priority: value as TaskPriority })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {form.variant === "backlog" ? <BacklogFields form={form} onChange={onChange} /> : null}
          <label className="adm-field">
            <span>{t("backlog.agent")}</span>
            <Select
              value={form.assignedAgentId || NO_AGENT}
              onValueChange={(value) => {
                if (value == null) return
                if (value === NO_AGENT) {
                  onChange(
                    form.variant === "routine"
                      ? {
                          ...form,
                          assignedAgent: "",
                          assignedAgentId: "",
                          routineEnabled: false,
                        }
                      : { ...form, assignedAgent: "", assignedAgentId: "" },
                  );
                  return;
                }
                const logicalAgent = logicalAgents.find((agent) => agent.id === value);
                if (logicalAgent) {
                  updateBase({
                    assignedAgent: logicalAgent.executorKind,
                    assignedAgentId: logicalAgent.id,
                    assigneeEmployeeId: logicalAgent.employeeId,
                  });
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => {
                    if (value === NO_AGENT) {
                      return form.variant === "backlog" ? t("backlog.agent_team") : t("backlog.no_agent");
                    }
                    const agent = agentOptions.find((candidate) => candidate.id === value);
                    return agent ? `${agent.displayName} · ${agent.executorKind}` : value;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT}>
                  {form.variant === "backlog" ? t("backlog.agent_team") : t("backlog.no_agent")}
                </SelectItem>
                {agentOptions.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>{agent.displayName} · {agent.executorKind}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {form.variant === "routine" ? (
          <>
            <label className="adm-field">
              <span>{t("routine.next_run")}</span>
              <Input
                name={`${fieldPrefix}-next-run-date`}
                type="date"
                min={isoToday()}
                value={form.routineNextRunDate}
                readOnly={form.routineCadence !== "custom"}
                onChange={(event) => onChange({ ...form, routineNextRunDate: event.target.value })}
              />
              <span className="adm-form-hint">{t("routine.next_run_hint")}</span>
            </label>
            <div className="adm-field routine-toggle">
              <span className="routine-toggle-text">
                <span>{t("routine.enabled")}</span>
                <span className="adm-form-hint">{t("routine.enabled_hint")}</span>
              </span>
              <Switch
                name={`${fieldPrefix}-enabled`}
            checked={form.routineEnabled}
            disabled={!form.assignedAgentId && !form.routineEnabled}
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
              size="default"
              className="adm-form-actions-leading"
              onClick={onDelete}
              disabled={busy}
            >
              {deleting ? t("backlog.deleting") : t("backlog.delete_task")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="default" onClick={onClose} disabled={busy}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" variant="default" size="default" disabled={busy || !form.title.trim()}>
            {saving ? t("admin.saving") : t("dialog.confirm")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
