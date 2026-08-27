import { cn } from "@/lib/utils";

/**
 * The shape half of Relay's state vocabulary.
 *
 * Five or six states cannot be separated by colour alone even now that the
 * status tones carry hue: at a 10px mark, a green and an amber dot are two
 * dots. Colour therefore carries the *tone* (good → bad) and shape carries
 * the *class*:
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
