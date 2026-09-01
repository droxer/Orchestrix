import type { TaskRun } from "../types.js";

/**
 * What a run's row says at a glance.
 *
 * The task status vocabulary is about where work sits on the board; a ledger
 * asks a narrower question — did this run land, is it going, or did it never
 * get going. Collapsing statuses here keeps that judgement in one place
 * instead of in every badge that renders a row.
 */
export type RunOutcome = "done" | "failed" | "running" | "pending";

export function runOutcome(run: TaskRun): RunOutcome {
  if (run.status === "done") return "done";
  if (run.status === "blocked") return "failed";
  if (run.status === "running") return "running";
  // `review` and `waiting_for_human` are a finished agent turn waiting on a
  // person — the run itself is still open, so it reads as running.
  if (run.status === "review" || run.status === "waiting_for_human") return "running";
  return "pending";
}

/**
 * How long the run took, in milliseconds — null when it has not started, has
 * not finished, or carries timestamps that cannot be ordered.
 */
export function runDurationMs(run: TaskRun): number | null {
  if (!run.startedAt || !run.endedAt) return null;
  const started = Date.parse(run.startedAt);
  const ended = Date.parse(run.endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return null;
  return ended - started;
}

/**
 * A duration a person reads at a glance: `4s`, `12m`, `1h 3m`.
 *
 * Deliberately unlocalized digits with unit suffixes — the ledger's rows are
 * scanned vertically, and a spelled-out duration breaks the column.
 */
export function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
