"use client";

import { useTranslation } from "react-i18next";
import { ActionCalendar, ICON } from "../icons";
import type { RelayTaskListItem } from "../../types";

/**
 * Names the routine a task was promoted from.
 *
 * A promoted occurrence lands in the backlog as an ordinary task, so a daily
 * routine fills the lanes with rows nobody wrote and nothing on the record
 * says where they came from. The board keeps showing them — an occurrence is
 * real work someone may have to act on — and this supplies the provenance
 * that made them confusing without it.
 *
 * Renders nothing for a task a person wrote, which is most of them.
 */
export function RoutineOriginBadge({
  task,
  routineTitle,
}: {
  task: RelayTaskListItem;
  /** The parent routine's title; falls back to a generic label when the
   *  routine is not in the caller's task list (deleted, or not visible). */
  routineTitle?: string;
}) {
  const { t } = useTranslation();
  if (!task.sourceRoutineId) return null;
  const label = routineTitle ?? t("backlog.routine_origin_unknown");

  return (
    <span
      className="backlog-routine-origin"
      title={t("backlog.routine_origin_of", { title: label })}
    >
      <ActionCalendar size={ICON.sm} />
      <span className="backlog-routine-origin-name">{label}</span>
    </span>
  );
}
