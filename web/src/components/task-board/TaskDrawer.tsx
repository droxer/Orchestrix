"use client";

import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_NAMES, type AgentName, type TaskPriority, type TaskRoutineCadence, type TaskRoutineType, type TaskStatus } from "../../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../lib/backlog";
import { TASK_ROUTINE_CADENCES, TASK_ROUTINE_TYPES } from "../../lib/routine";
import type { TaskBoardFormState } from "../../lib/taskBoardForm";
import { Drawer } from "../admin/Drawer";
import { ActionAddPerson } from "../icons";
import { TaskDrawerArtifacts } from "./TaskDrawerArtifacts";

type TaskDrawerProps = {
  form: TaskBoardFormState;
  employees: string[];
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
          <select
            name={`${fieldPrefix}-status`}
            value={form.status}
            onChange={(event) => onChange({ ...form, status: event.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{t(`backlog.statuses.${status}`)}</option>
            ))}
          </select>
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
          <select
            name={`${fieldPrefix}-type`}
            value={form.routineType}
            onChange={(event) => onChange({ ...form, routineType: event.target.value as TaskRoutineType })}
          >
            {TASK_ROUTINE_TYPES.map((type) => (
              <option key={type} value={type}>{t(`routine.types.${type}`)}</option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>{t("routine.cadence")}</span>
          <select
            name={`${fieldPrefix}-cadence`}
            value={form.routineCadence}
            onChange={(event) => onChange({ ...form, routineCadence: event.target.value as TaskRoutineCadence })}
          >
            {TASK_ROUTINE_CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>{t(`routine.cadences.${cadence}`)}</option>
            ))}
          </select>
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
            <select
              name={`${fieldPrefix}-priority`}
              value={form.priority}
              onChange={(event) => updateBase({ priority: event.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{t(`backlog.priorities.${priority}`)}</option>
              ))}
            </select>
          </label>
          {form.variant === "backlog" ? variantFields : null}
          <label className="adm-field">
            <span>{t("backlog.agent")}</span>
            <select
              name={`${fieldPrefix}-agent`}
              value={form.assignedAgent}
              onChange={(event) => updateBase({ assignedAgent: event.target.value as "" | AgentName })}
            >
              <option value="">{form.variant === "backlog" ? t("backlog.agent_team") : t("backlog.no_agent")}</option>
              {AGENT_NAMES.map((agent) => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
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
