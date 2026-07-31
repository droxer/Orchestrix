import { cn } from "@/lib/utils";

/**
 * The shape half of Relay's state vocabulary.
 *
 * The palette is a grey brightness ramp with one hue, so five or six states
 * cannot be separated by colour alone — `--err` is byte-identical to `--ink-1`
 * and `--action`. Brightness therefore carries the *step* (loud → calm) and
 * shape carries the *class*:
 *
 * - `solid`  — on track, nothing to say
 * - `live`   — an agent is working right now (the only `--live` surface here)
 * - `ring`   — a problem: blocked, overdue, failed
 * - `dashed` — nothing set: unscheduled, unassigned
 * - `muted`  — out of play: paused, done
 *
 * The accent comes from `--mark-accent`, which the host rule sets — the mark
 * never picks its own colour, so a row rail and its label always agree.
 */
export type StateShape = "solid" | "live" | "ring" | "dashed" | "muted";

export function StateMark({ shape = "solid", className }: { shape?: StateShape; className?: string }) {
  return <span aria-hidden="true" className={cn("state-mark", className)} data-shape={shape} />;
}
