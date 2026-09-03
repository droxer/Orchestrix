/** Which of the section's five renderings a query pair calls for.
 *
 *  Extracted from the component so the decision is testable without mounting
 *  React: "the computer is offline" and "the task produced nothing" look the
 *  same to a careless reader and must not be conflated in the UI. */
export type TaskWorkspaceState = "loading" | "unavailable" | "empty" | "ready" | "failed";

export function taskWorkspaceState(query: {
  isLoading: boolean;
  error: unknown;
  data: { exists: boolean; entries: unknown[] } | undefined;
}): TaskWorkspaceState {
  if (query.isLoading) return "loading";
  if (query.error) {
    const status = (query.error as { status?: number }).status;
    return status === 503 ? "unavailable" : "failed";
  }
  if (!query.data || !query.data.exists || query.data.entries.length === 0) return "empty";
  return "ready";
}
