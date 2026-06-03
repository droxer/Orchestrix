import type { AgentState } from "./state.js";

export function appendCodexFeedback(prompt: string, state: AgentState): string {
  return state.codex_feedback ? `${prompt}\n\nCodex review feedback to fix:\n${state.codex_feedback}` : prompt;
}

export function codexReviewPrompt(state: AgentState): string {
  return (
    "You are reviewing code in /workspace. " +
    `User task: ${state.task_goal}. ` +
    "Read relevant files, check for blocking bugs or regressions, and report only blocking issues. " +
    "If there are no blocking issues, reply with a brief approval. " +
    "End your response with exactly one verdict line: " +
    "ORCHESTRIX_REVIEW_VERDICT: APPROVED when there are no blocking issues, " +
    "or ORCHESTRIX_REVIEW_VERDICT: REJECTED when blocking issues remain."
  );
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
