import type { AgentState } from "./state.js";

export function prependPriorAgentBridge(prompt: string, state: AgentState): string {
  return state.prior_agent_bridge ? `${state.prior_agent_bridge}\n\n[User]\n${prompt}` : prompt;
}

export function reviewPrompt(state: AgentState): string {
  const preludes = promptPreludes(state);
  return [
    "Review the current workspace changes for the user's task.",
    "",
    "Focus on blocking bugs, regressions, unsafe behavior, and missing tests.",
    "If changes are acceptable, say so briefly.",
    "If changes are not acceptable, list the blocking issues clearly.",
    ...(preludes.length > 0 ? ["", preludes.join("\n\n")] : []),
    "",
    "User task:",
    state.task_goal,
  ].join("\n");
}

export function actionPrompt(state: AgentState): string {
  const task = state.task_goal;
  // Order: earlier conversation history first, then any within-run bridge from
  // sibling agents, then handoff notes, then the current user turn. All
  // preludes are optional.
  const preludes = promptPreludes(state);
  if (preludes.length === 0) return task;
  return `${preludes.join("\n\n")}\n\n[User]\n${task}`;
}

function promptPreludes(state: AgentState): string[] {
  const preludes: string[] = [];
  if (state.agent_instructions) preludes.push(`[Agent instructions]\n${state.agent_instructions}`);
  if (state.agent_home_subdir) {
    preludes.push(
      [
        "[Workspace]",
        "The current directory is a workspace shared with the other agents on this computer; files here are visible to all of them.",
        `Your private directory is \`${state.agent_home_subdir}/\`; keep personal state there and collaborate through the shared workspace.`,
      ].join("\n"),
    );
  }
  if (state.prior_conversation) preludes.push(state.prior_conversation);
  if (state.prior_agent_bridge) preludes.push(state.prior_agent_bridge);
  if (state.prior_handoff_note) preludes.push(state.prior_handoff_note);
  return preludes;
}

// Read-only Q&A prompt. CLI read-only flags are the hard guarantee; this
// instruction reinforces the intent and covers agents lacking a native flag.
export function askPrompt(state: AgentState): string {
  const guard = [
    "Participate in a read-only planning discussion about the user's goal or question.",
    "Do NOT modify, create, or delete any files, and do NOT run commands that change state.",
    "If the request would require making changes, explain what you would do instead of doing it.",
    "When prior agent messages are present, respond to them directly: agree, disagree, identify risks, refine the plan, and call out open questions.",
    "Prefer a concrete plan or recommendation over independent brainstorming.",
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
