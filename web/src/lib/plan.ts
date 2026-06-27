import type { AgentName, AgentTaskMode } from "../types.js";

export type PlanStep = { agent: AgentName; mode: AgentTaskMode };

/**
 * Parse the JSON body of a "plan" artifact (`{ assignments: WorkflowStep[] }`)
 * into a list of human-readable steps. `agentNames` is the set of recognized
 * agents used to drop unknown entries (passed in so this module stays free of
 * runtime imports). Returns null when the body is not a recognizable assignment
 * plan so callers can fall back to the raw preview.
 */
export function parsePlanSteps(text: string, agentNames: readonly string[]): PlanStep[] | null {
  try {
    const data = JSON.parse(text) as { assignments?: unknown };
    if (!Array.isArray(data.assignments)) return null;
    const steps = data.assignments.flatMap((entry): PlanStep[] => {
      if (!entry || typeof entry !== "object") return [];
      const { agent, mode } = entry as { agent?: unknown; mode?: unknown };
      if (typeof agent !== "string" || !agentNames.includes(agent)) return [];
      const taskMode: AgentTaskMode =
        mode === "review" ? "review" : mode === "ask" ? "ask" : "action";
      return [{ agent: agent as AgentName, mode: taskMode }];
    });
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}

export function agentLabel(agent: AgentName): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}
