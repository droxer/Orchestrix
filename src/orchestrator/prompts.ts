import type { AgentState } from "./state.js";

export function appendCodexFeedback(prompt: string, state: AgentState): string {
  return state.codex_feedback ? `${prompt}\n\nCodex review feedback to fix:\n${state.codex_feedback}` : prompt;
}

export function codexReviewPrompt(state: AgentState): string {
  return state.task_goal;
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
