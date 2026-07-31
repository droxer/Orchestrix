import { useTranslation } from "react-i18next";
import type { RoutineState } from "../lib/routine";
import { StateMark, type StateShape } from "./StateMark";

/**
 * Schedule health for a routine, in the same pill grammar as `.task-status`
 * so "where does this stand?" reads identically on both boards.
 *
 * Shape does the separating work (see StateMark): a paused routine is muted,
 * a missing next-run date is dashed, an overdue one is a hollow ring, and a
 * live occurrence is the one place a routine surface earns `--live`.
 */
export const ROUTINE_STATE_SHAPE: Record<RoutineState, StateShape> = {
  running: "live",
  overdue: "ring",
  due: "solid",
  scheduled: "solid",
  unscheduled: "dashed",
  paused: "muted",
};

export function RoutineStateBadge({ state }: { state: RoutineState }) {
  const { t } = useTranslation();
  return (
    <span className="routine-state" data-state={state}>
      <StateMark shape={ROUTINE_STATE_SHAPE[state]} />
      {t(`routine.states.${state}`)}
    </span>
  );
}
