"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { agentLabel } from "../../lib/plan";
import { compactDate, compactDueDate } from "../../lib/workspaceFormat";
import type { WorkspaceBriefResponse, WorkspaceBriefSession, WorkspaceBriefTask } from "../../types";
import { Button } from "../ui/button";

/* Shared workspace inspection primitives — the empty/loading/metric/activity
   building blocks used by both AgentWorkspacePage and TeamWorkspacePage. Kept
   here so the two surfaces don't drift (they previously each declared their
   own). */

/** Centered empty state: an optional mark tile (any glyph the caller supplies,
 *  or a pulsing dot when `pulse`), a title, and an optional hint. */
export function WorkspaceEmpty({
  title,
  hint,
  mark,
  pulse = false,
  announce = false,
}: {
  title: string;
  hint?: string;
  mark?: ReactNode;
  pulse?: boolean;
  /** Announce async empty/error results that replace a loading status. */
  announce?: boolean;
}) {
  return (
    <div
      className="workspace-empty-state"
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-atomic={announce || undefined}
    >
      {mark || pulse ? (
        <span
          className={`workspace-empty-state-mark${pulse ? " is-pulse" : ""}`}
          aria-hidden="true"
        >
          {mark}
        </span>
      ) : null}
      <p className="workspace-empty-state-title">{title}</p>
      {hint ? <p className="workspace-empty-state-hint">{hint}</p> : null}
    </div>
  );
}

export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <div className="workspace-loading-bar" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** One cell of the metric strip. `emphasis`/`live`/`zero` toggle the accent,
 *  live pulse, and dimmed-zero treatments respectively. */
export function MetricItem({
  label,
  value,
  emphasis = false,
  live = false,
  zero = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  live?: boolean;
  zero?: boolean;
}) {
  const classes = [
    "workspace-metric-item",
    emphasis ? "is-emphasis" : "",
    live ? "is-live" : "",
    zero ? "is-zero" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <strong className="tnum">{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Tabpanel-aware skeleton for the activities tab while the brief loads. */
export function ActivitiesSkeleton({ panelId, labelledBy }: { panelId: string; labelledBy: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="workspace-inspect workspace-activities"
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
      aria-busy="true"
    >
      <span className="sr-only" role="status">{t("workspace.loading")}</span>
      <div className="workspace-metric-strip">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="workspace-skeleton workspace-skeleton-metric" />
        ))}
      </div>
      <div className="workspace-activity-sections">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="workspace-activity-section workspace-skeleton-pane">
            <div className="workspace-skeleton workspace-skeleton-line" />
            <div className="workspace-skeleton workspace-skeleton-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tabpanel-aware error state with retry. `eyebrow` is optional so callers
 *  whose message already names the failure don't render it twice. */
export function WorkspaceError({
  message,
  eyebrow,
  onRetry,
  panelId,
  labelledBy,
}: {
  message: string;
  eyebrow?: string;
  onRetry: () => void;
  panelId: string;
  labelledBy: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="workspace-inspect" role="tabpanel" id={panelId} aria-labelledby={labelledBy}>
      <div className="workspace-error" role="alert">
        {eyebrow ? <span className="workspace-eyebrow">{eyebrow}</span> : null}
        <p>{message}</p>
        <Button variant="ghost" type="button" className="workspace-error-action h-auto" onClick={onRetry}>
          {t("workspace.retry")}
        </Button>
      </div>
    </div>
  );
}

function ActivitySection({ title, count, index = 0, children }: { title: string; count: number; index?: number; children: ReactNode }) {
  return (
    <section
      className="workspace-activity-section"
      /* The delay itself belongs to the stylesheet (calc off --t-stagger);
         only the section's position in the ladder is data. */
      style={{ "--stagger-index": index } as CSSProperties}
    >
      <header className="workspace-activity-head">
        <h2>{title}</h2>
        <span className="tnum">{count}</span>
      </header>
      {children}
    </section>
  );
}

function ActivityRow({ title, meta, onClick }: { title: string; meta: string; onClick?: () => void }) {
  if (!onClick) {
    return (
      <div className="workspace-pick workspace-activity-pick is-static">
        <span className="workspace-pick-title">{title}</span>
        <span className="workspace-pick-meta tnum">{meta}</span>
      </div>
    );
  }
  return (
    <button type="button" className="workspace-pick workspace-activity-pick" onClick={onClick}>
      <span className="workspace-pick-title">{title}</span>
      <span className="workspace-pick-meta tnum">{meta}</span>
    </button>
  );
}

function sessionTitle(session: WorkspaceBriefSession): string {
  return session.title?.trim() || session.taskGoal?.trim() || session.id;
}

function taskTitle(task: WorkspaceBriefTask): string {
  return task.title?.trim() || task.id;
}

/** Sessions carry `SessionStatus`, not `TaskStatus` — `completed`, `failed`,
 *  and `cancelled` have no `backlog.statuses.*` key and used to fall through
 *  to the raw lowercase enum. Label them from the thread vocabulary. */
function sessionStatusLabel(
  status: WorkspaceBriefSession["status"] | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!status) return "";
  return t(`thread.statuses.${status}`, { defaultValue: status });
}

/** The activities tabpanel: metric strip (runs/tasks/threads + a caller-
 *  supplied status pill) followed by active-run, thread, and task sections.
 *  Shared verbatim by the agent and team workspace pages. */
export function WorkspaceActivities({
  brief,
  statusPill,
  onOpenThread,
  panelId,
  labelledBy,
  emptyMark,
  emptyPulse = false,
}: {
  brief?: WorkspaceBriefResponse;
  /** Status chip rendered as the last metric cell (agent availability or team readiness). */
  statusPill: ReactNode;
  onOpenThread: (sessionId: string) => void;
  panelId: string;
  labelledBy: string;
  emptyMark?: ReactNode;
  emptyPulse?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const metrics = brief?.metrics;
  const activeRuns = brief?.activeRuns ?? [];
  const sessions = brief?.sessions ?? [];
  const tasks = brief?.tasks ?? [];
  const hasActivity = activeRuns.length > 0 || sessions.length > 0 || tasks.length > 0;

  return (
    <div
      className="workspace-inspect workspace-activities"
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
    >
      <div className="workspace-metric-strip" role="group" aria-label={t("workspace.metrics")}>
        <MetricItem
          label={t("workspace.metric_runs")}
          value={metrics?.activeRunCount ?? 0}
          emphasis={(metrics?.activeRunCount ?? 0) > 0}
          live={(metrics?.activeRunCount ?? 0) > 0}
        />
        <MetricItem label={t("workspace.metric_tasks")} value={metrics?.activeTaskCount ?? 0} zero={(metrics?.activeTaskCount ?? 0) === 0} />
        <MetricItem label={t("workspace.metric_sessions")} value={metrics?.sessionCount ?? 0} zero={(metrics?.sessionCount ?? 0) === 0} />
        <div className="workspace-metric-item workspace-metric-item--status">{statusPill}</div>
      </div>

      <div className="workspace-activity-sections">
        {activeRuns.length ? (
          <ActivitySection title={t("workspace.activity_runs")} count={activeRuns.length} index={0}>
            <ul className="workspace-pick-list">
              {activeRuns.map((run) => (
                <li key={run.runId}>
                  <ActivityRow
                    title={run.taskGoal}
                    meta={[
                      agentLabel(run.agent),
                      t(`mode.${run.mode}`, { defaultValue: run.mode }),
                      compactDate(run.startedAt, i18n.language),
                    ].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(run.sessionId)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}

        {sessions.length ? (
          <ActivitySection title={t("workspace.activity_threads")} count={sessions.length} index={activeRuns.length ? 1 : 0}>
            <ul className="workspace-pick-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <ActivityRow
                    title={sessionTitle(session)}
                    meta={[
                      sessionStatusLabel(session.status, t),
                      session.runCount ? t("workspace.session_runs", { count: session.runCount }) : "",
                      compactDate(session.updatedAt, i18n.language),
                    ].filter(Boolean).join(" · ")}
                    onClick={() => onOpenThread(session.id)}
                  />
                </li>
              ))}
            </ul>
          </ActivitySection>
        ) : null}

        {tasks.length ? (
          <ActivitySection
            title={t("workspace.activity_tasks")}
            count={tasks.length}
            index={(activeRuns.length ? 1 : 0) + (sessions.length ? 1 : 0)}
          >
            <ul className="workspace-pick-list">
              {tasks.map((task) => {
                const linkedSessionId = task.linkedSessionIds[0];
                return (
                  <li key={task.id}>
                    <ActivityRow
                      title={taskTitle(task)}
                      meta={[
                        task.status ? t(`backlog.statuses.${task.status}`, { defaultValue: task.status }) : "",
                        task.dueDate ? t("workspace.task_due", { date: compactDueDate(task.dueDate, i18n.language) }) : "",
                        compactDate(task.updatedAt, i18n.language),
                      ].filter(Boolean).join(" · ")}
                      onClick={linkedSessionId ? () => onOpenThread(linkedSessionId) : undefined}
                    />
                  </li>
                );
              })}
            </ul>
          </ActivitySection>
        ) : null}

        {!hasActivity ? (
          <WorkspaceEmpty
            title={t("workspace.no_activity")}
            hint={t("workspace.empty_activity_hint")}
            mark={emptyMark}
            pulse={emptyPulse}
            announce
          />
        ) : null}
      </div>
    </div>
  );
}
