import { useTranslation } from "react-i18next";
import type { TaskStatus } from "../types";

/**
 * Lifecycle-status indicator — a status-coloured dot + label. The board
 * conveys status through lanes and the list through its own dot + column, so
 * this is mainly for surfaces (routine cards) that would otherwise bury the
 * status in a plain meta line. The accent map mirrors the lane/row rails in
 * backlog.css; `running` adds a pulse.
 */
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return (
    <span className="task-status" data-status={status}>
      {t(`backlog.statuses.${status}`)}
    </span>
  );
}
