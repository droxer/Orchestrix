import type { AgentState } from "./state.js";

export function prependPriorAgentBridge(prompt: string, state: AgentState): string {
  return state.prior_agent_bridge ? `${state.prior_agent_bridge}\n\n[User]\n${prompt}` : prompt;
}

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

export function actionPrompt(state: AgentState): string {
  const task = appendReviewFeedback(state.task_goal, state);
  // Order: earlier conversation history first, then any within-run bridge from
  // sibling agents, then the current user turn. Both preludes are optional.
  const preludes: string[] = [];
  if (state.prior_conversation) preludes.push(state.prior_conversation);
  if (state.prior_agent_bridge) preludes.push(state.prior_agent_bridge);
  if (preludes.length === 0) return task;
  return `${preludes.join("\n\n")}\n\n[User]\n${task}`;
}

export function claudeTaskPrompt(state: AgentState): string {
  return actionPrompt(state);
}

export function piTaskPrompt(state: AgentState): string {
  return actionPrompt(state);
}

export function codexActionPrompt(state: AgentState): string {
  return actionPrompt(state);
}

export function kimiTaskPrompt(state: AgentState): string {
  return actionPrompt(state);
}
