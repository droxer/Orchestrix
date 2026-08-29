/**
 * Multi-select for the task boards. Backlog rows/cards and routine rows/cards
 * all share one selection vocabulary so a batch action means the same thing on
 * every surface: the checkbox picks records, the selection bar acts on them.
 *
 * Every helper returns a new Set — selection is state, never mutated in place.
 */

export type TaskSelection = ReadonlySet<string>;

export const EMPTY_TASK_SELECTION: TaskSelection = new Set<string>();

export type SelectionCheckState = "none" | "some" | "all";

export function isSelected(selection: TaskSelection, id: string): boolean {
  return selection.has(id);
}

export function toggleSelected(selection: TaskSelection, id: string): TaskSelection {
  const next = new Set(selection);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Filters a stored selection down to what is currently on screen. A task that
 * a filter hid — or that another client deleted — must not stay selected
 * behind the user's back, or a batch action would reach records they can no
 * longer see.
 */
export function pruneSelection(selection: TaskSelection, visibleIds: readonly string[]): TaskSelection {
  if (selection.size === 0) return EMPTY_TASK_SELECTION;
  const visible = new Set(visibleIds);
  const next = new Set<string>();
  for (const id of selection) if (visible.has(id)) next.add(id);
  return next.size === selection.size ? selection : next;
}

/** Header checkbox: all visible selected → clear, otherwise select them all. */
export function toggleAllSelected(selection: TaskSelection, visibleIds: readonly string[]): TaskSelection {
  if (selectionCheckState(selection, visibleIds) === "all") return EMPTY_TASK_SELECTION;
  return new Set(visibleIds);
}

export function selectionCheckState(selection: TaskSelection, visibleIds: readonly string[]): SelectionCheckState {
  if (visibleIds.length === 0 || selection.size === 0) return "none";
  const selectedVisible = visibleIds.filter((id) => selection.has(id)).length;
  if (selectedVisible === 0) return "none";
  return selectedVisible === visibleIds.length ? "all" : "some";
}

/** Selected records in the order they are rendered, not in insertion order. */
export function selectedTasks<T extends { id: string }>(tasks: readonly T[], selection: TaskSelection): T[] {
  return tasks.filter((task) => selection.has(task.id));
}

export interface BatchOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { id: string; error: unknown }[];
}

/**
 * Splits settled results back into the ids they came from. A batch is reported
 * per record: a partial failure must never read as a clean success.
 */
export function batchOutcome(ids: readonly string[], results: readonly PromiseSettledResult<unknown>[]): BatchOutcome {
  const succeeded: string[] = [];
  const failed: { id: string; error: unknown }[] = [];
  ids.forEach((id, index) => {
    const result = results[index];
    if (result && result.status === "fulfilled") succeeded.push(id);
    else failed.push({ id, error: result && result.status === "rejected" ? result.reason : undefined });
  });
  return { succeeded, failed };
}
