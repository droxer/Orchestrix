import type { AgentState } from "./state.js";

export function prependPriorAgentBridge(prompt: string, state: AgentState): string {
  return state.prior_agent_bridge ? `${state.prior_agent_bridge}\n\n[User]\n${prompt}` : prompt;
}

export function reviewPrompt(state: AgentState): string {
  return [
    "Review the current workspace changes for the user's task.",
    "",
    "Focus on blocking bugs, regressions, unsafe behavior, and missing tests.",
    "If changes are acceptable, say so briefly.",
    "If changes are not acceptable, list the blocking issues clearly.",
    "",
    "User task:",
    state.task_goal,
  ].join("\n");
}

export function actionPrompt(state: AgentState): string {
  const task = state.task_goal;
  // Order: earlier conversation history first, then any within-run bridge from
  // sibling agents, then the current user turn. Both preludes are optional.
  const preludes: string[] = [];
  if (state.prior_conversation) preludes.push(state.prior_conversation);
  if (state.prior_agent_bridge) preludes.push(state.prior_agent_bridge);
  if (preludes.length === 0) return task;
  return `${preludes.join("\n\n")}\n\n[User]\n${task}`;
}

// Read-only Q&A prompt. CLI read-only flags are the hard guarantee; this
// instruction reinforces the intent and covers agents lacking a native flag.
export function askPrompt(state: AgentState): string {
  const guard = [
    "Answer the user's question using only read-only inspection of the workspace.",
    "Do NOT modify, create, or delete any files, and do NOT run commands that change state.",
    "If the request would require making changes, explain what you would do instead of doing it.",
  ].join("\n");
  return `${guard}\n\n${actionPrompt(state)}`;
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
