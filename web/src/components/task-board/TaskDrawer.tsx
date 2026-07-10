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
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeAgent, TaskPriority, TaskRoutineCadence, TaskRoutineType, TaskStatus } from "../../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../lib/backlog";
import { TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES } from "../../lib/routine";
import type { TaskBoardFormState } from "../../lib/taskBoardForm";
import { Drawer } from "../admin/Drawer";
import { ActionAddPerson } from "../icons";
import { TaskDrawerArtifacts } from "./TaskDrawerArtifacts";

const NO_AGENT = "__none__";

type TaskDrawerProps = {
  form: TaskBoardFormState;
  employees: string[];
  logicalAgents: EmployeeAgent[];
  saving: boolean;
  title: string;
  subtitle: string;
  employeeDatalistId: string;
  onClose: () => void;
  onChange: (next: TaskBoardFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskDrawer({
  form,
  employees,
  logicalAgents,
  saving,
  title,
  subtitle,
  employeeDatalistId,
  onClose,
  onChange,
  onSubmit,
}: TaskDrawerProps) {
  const { t } = useTranslation();
  const fieldPrefix = form.variant;

  function updateBase(patch: Partial<TaskBoardFormState>): void {
    onChange({ ...form, ...patch } as TaskBoardFormState);
  }

  let variantFields: ReactNode = null;
  if (form.variant === "backlog") {
    variantFields = (
      <>
        <label className="adm-field">
          <span>{t("backlog.status")}</span>
          <Select
            value={form.status}
            onValueChange={(value) => onChange({ ...form, status: value as TaskStatus })}
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
            name={`${fieldPrefix}-due-date`}
            type="date"
            value={form.dueDate}
            onChange={(event) => onChange({ ...form, dueDate: event.target.value })}
          />
        </label>
      </>
    );
  } else {
    variantFields = (
      <>
        <label className="adm-field">
          <span>{t("routine.type")}</span>
          <Select
            value={form.routineType}
            onValueChange={(value) => onChange({ ...form, routineType: value as TaskRoutineType })}
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
            onValueChange={(value) => onChange({ ...form, routineCadence: value as TaskRoutineCadence })}
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
        <label className="adm-field">
          <span>{t("routine.next_run")}</span>
          <Input
            name={`${fieldPrefix}-next-run-date`}
            type="date"
            value={form.routineNextRunDate}
            onChange={(event) => onChange({ ...form, routineNextRunDate: event.target.value })}
          />
        </label>
        <label className="adm-field routine-toggle">
          <span>{t("routine.enabled")}</span>
          <input
            name={`${fieldPrefix}-enabled`}
            type="checkbox"
            checked={form.routineEnabled}
            onChange={(event) => onChange({ ...form, routineEnabled: event.target.checked })}
          />
        </label>
      </>
    );
  }

  return (
    <Drawer
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={title}
      subtitle={subtitle}
      variant="light"
      width={420}
      closeLabel={t("dialog.cancel")}
      ariaLabel={title}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form task-board-drawer-form" onSubmit={onSubmit}>
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
          {form.variant === "routine" ? variantFields : null}
          <label className="adm-field">
            <span>{t("backlog.priority")}</span>
            <Select
              value={form.priority}
              onValueChange={(value) => updateBase({ priority: value as TaskPriority })}
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
          {form.variant === "backlog" ? variantFields : null}
          <label className="adm-field">
            <span>{t("backlog.agent")}</span>
            <Select
              value={form.assignedAgentId || form.assignedAgent || NO_AGENT}
              onValueChange={(value) => {
                if (value === NO_AGENT) {
                  updateBase({ assignedAgent: "", assignedAgentId: "" });
                  return;
                }
                const logicalAgent = logicalAgents.find((agent) => agent.id === value);
                if (logicalAgent) {
                  updateBase({ assignedAgent: logicalAgent.executorKind, assignedAgentId: logicalAgent.id });
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT}>
                  {form.variant === "backlog" ? t("backlog.agent_team") : t("backlog.no_agent")}
                </SelectItem>
                {logicalAgents
                  .filter((agent) => !form.assigneeEmployeeId || agent.employeeId === form.assigneeEmployeeId)
                  .map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.displayName} · {agent.executorKind}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="adm-field">
          <span>{t("backlog.assignee")}</span>
          <div className="task-drawer-assignee">
            <ActionAddPerson size={15} aria-hidden="true" />
            <Input
              name={`${fieldPrefix}-assignee`}
              list={employeeDatalistId}
              value={form.assigneeEmployeeId}
              onChange={(event) => updateBase({ assigneeEmployeeId: event.target.value })}
              className="h-auto min-h-0 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:shadow-none"
            />
            <datalist id={employeeDatalistId}>
              {employees.map((employee) => <option key={employee} value={employee} />)}
            </datalist>
          </div>
        </label>
        <div className="adm-form-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" disabled={saving || !form.title.trim()}>
            {saving ? t("admin.saving") : t("dialog.confirm")}
          </Button>
        </div>
      </form>
      {form.variant === "backlog" && form.id ? <TaskDrawerArtifacts taskId={form.id} /> : null}
    </Drawer>
  );
}
