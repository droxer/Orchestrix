"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listTaskEvents } from "../../api";
import { hrefForRoute } from "../../lib/appRoute";
import { taskHistoryEntries, type TaskHistoryEntry } from "../../lib/taskHistory";
import type { RelayTaskEvent } from "../../types";

function historyTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Run history for one task or routine.
 *
 * The task event log is the authoritative record of what a dispatch actually
 * did; without this the drawer showed a single "last activity" line and the
 * rest was reachable only through the API.
 */
export function TaskDrawerHistory({
  taskId,
  isRoutine,
  onOpenThread,
}: {
  taskId: string;
  isRoutine: boolean;
  onOpenThread?: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<RelayTaskEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setEvents(null);
    setFailed(false);
    // A routine never runs itself — ask for its occurrences' events too.
    listTaskEvents(taskId, { includeOccurrences: isRoutine }, controller.signal)
      .then((response) => setEvents(response.events))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [taskId, isRoutine]);

  const entries = events ? taskHistoryEntries(events, taskId) : [];

  function entryLabel(entry: TaskHistoryEntry): string {
    if (entry.kind === "activity") return entry.message ?? t("backlog.history.activity");
    if (entry.kind === "status") {
      return t("backlog.history.status", {
        status: entry.status ? t(`backlog.statuses.${entry.status}`) : "",
      });
    }
    const label = t(`backlog.history.${entry.kind}`);
    return entry.message ? `${label} — ${entry.message}` : label;
  }

  return (
    <section className="task-drawer-history" aria-label={t("backlog.history_title")}>
      <h3 className="task-drawer-artifacts-title">
        {t("backlog.history_title")}
        {entries.length > 0 ? (
          <span className="task-drawer-artifacts-count tnum">{entries.length}</span>
        ) : null}
      </h3>
      {failed ? (
        <p className="task-drawer-artifacts-empty" role="alert">{t("backlog.history_error")}</p>
      ) : events === null ? (
        <p className="task-drawer-artifacts-empty" role="status" aria-live="polite">{t("backlog.history_loading")}</p>
      ) : entries.length === 0 ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.history_empty")}</p>
      ) : (
        <ol className="task-drawer-history-list">
          {entries.map((entry) => {
            const sessionId = entry.sessionId;
            return (
            <li key={entry.id} className="task-drawer-history-entry">
              <span className="task-drawer-history-time tnum">{historyTime(entry.timestamp, i18n.language)}</span>
              <span className="task-drawer-history-label">
                {entryLabel(entry)}
                {entry.fromOccurrence ? (
                  <span className="task-drawer-history-origin">{t("backlog.history_occurrence_origin")}</span>
                ) : null}
              </span>
              {sessionId ? (
                <a
                  className="task-drawer-artifact-download"
                  href={hrefForRoute("main", sessionId)}
                  onClick={(event) => {
                    if (!onOpenThread) return;
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
                    event.preventDefault();
                    onOpenThread(sessionId);
                  }}
                >
                  {t("backlog.open_thread")}
                </a>
              ) : null}
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
