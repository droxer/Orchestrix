import type { AgentState } from "./state.js";

export function appendCodexFeedback(prompt: string, state: AgentState): string {
  return state.codex_feedback ? `${prompt}\n\nCodex review feedback to fix:\n${state.codex_feedback}` : prompt;
}

export function codexReviewPrompt(state: AgentState): string {
  return [
    "Review the current workspace changes for the user's task.",
    "",
    "Focus on blocking bugs, regressions, unsafe behavior, and missing tests.",
    "If changes are acceptable, say so briefly.",
    "If changes are not acceptable, list the blocking issues clearly.",
    "",
    "End your response with exactly one of these lines:",
    "RELAY_REVIEW_VERDICT: APPROVED",
    "RELAY_REVIEW_VERDICT: REJECTED",
    "",
    "User task:",
    state.task_goal,
  ].join("\n");
}

export function codexImplementPrompt(state: AgentState): string {
  return appendCodexFeedback(state.task_goal, state);
}

export function claudeTaskPrompt(state: AgentState): string {
  return appendCodexFeedback(state.task_goal, state);
}

export function piTaskPrompt(state: AgentState): string {
  return appendCodexFeedback(state.task_goal, state);
}
