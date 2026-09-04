"use client";

import { useTranslation } from "react-i18next";
import { taskRef } from "../../lib/taskRef";

/** A quiet, human-quotable task identity for card layouts. */
export function TaskReference({ taskId }: { taskId: string }) {
  const { t } = useTranslation();

  return (
    <span className="backlog-task-ref code" title={taskId}>
      <span className="backlog-task-ref-label">{t("backlog.col_ref")}</span>
      {taskRef(taskId)}
    </span>
  );
}
