import type { AgentState } from "./state.js";

export function appendReviewFeedback(prompt: string, state: AgentState): string {
  return state.review_feedback ? `${prompt}\n\nReview feedback to fix:\n${state.review_feedback}` : prompt;
}

export function reviewPrompt(state: AgentState): string {
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
  return appendReviewFeedback(state.task_goal, state);
}

export function claudeTaskPrompt(state: AgentState): string {
  return appendReviewFeedback(state.task_goal, state);
}

export function piTaskPrompt(state: AgentState): string {
  return appendReviewFeedback(state.task_goal, state);
}

export function kimiTaskPrompt(state: AgentState): string {
  return appendReviewFeedback(state.task_goal, state);
}
