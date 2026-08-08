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

export function actionPrompt(state: AgentState, options: PreludeOptions = {}): string {
  const task = state.task_goal;
  // Order: earlier conversation history first, then any within-run bridge from
  // sibling agents, then handoff notes, then the current user turn. All
  // preludes are optional.
  const preludes = promptPreludes(state, options);
  if (preludes.length === 0) return task;
  return `${preludes.join("\n\n")}\n\n[User]\n${task}`;
}

interface PreludeOptions {
  /** Read-only passes must not be told to write the progress log. */
  readOnly?: boolean;
}

function promptPreludes(state: AgentState, options: PreludeOptions = {}): string[] {
  const preludes: string[] = [];
  if (state.agent_display_name) {
    preludes.push(
      ["[Agent identity]", `Your name is ${state.agent_display_name}.`].join("\n"),
    );
  }
  if (state.agent_role) {
    preludes.push(
      [
        "[Role]",
        `You are the ${state.agent_role} on this task.`,
        "Other agents on the thread hold the other roles; do your own and rely on theirs.",
      ].join("\n"),
    );
  }
  if (state.assignment_brief) {
    preludes.push(
      [
        "[Your assignment]",
        state.assignment_brief,
        "Treat the user task below as the shared team goal; own this assignment boundary and preserve completed teammate work.",
      ].join("\n"),
    );
  }
  if (state.team_phase) {
    preludes.push(["[Team phase]", `This assignment is in the ${state.team_phase} phase.`].join("\n"));
  }
  if (state.agent_instructions) {
    preludes.push(
      [
        "[Agent personality]",
        "Apply this personality consistently throughout the task.",
        state.agent_instructions,
      ].join("\n"),
    );
  }
  if (state.agent_home_subdir) {
    preludes.push(
      [
        "[Workspace]",
        "The current directory is the workspace for this thread; files here are shared with the other agents participating in this thread.",
        `Your private directory is \`${state.agent_home_subdir}/\`; keep personal state there and collaborate through the shared workspace.`,
      ].join("\n"),
    );
  }
  if (state.round_result_file && !options.readOnly) {
    preludes.push(
      [
        "[Finishing]",
        `When you stop, write \`${state.round_result_file}\` as JSON: {"status": "done" | "continue" | "blocked", "note": "<one line>"}.`,
        '"done" means the task is complete, "continue" means real work remains, "blocked" means you cannot proceed without a human.',
        "This file is how the task is closed out; without it the task waits for a person.",
      ].join("\n"),
    );
  }
  if (state.repair_note) {
    preludes.push(["[Repair]", state.repair_note].join("\n"));
  }
  if (state.progress_file) {
    preludes.push(
      [
        "[Progress log]",
        `\`${state.progress_file}\` in the workspace is this task's durable record across turns and agents.`,
        "Read it before you start; the conversation below may be truncated, but this file is not.",
        ...(options.readOnly
          ? []
          : [
              "Before you finish, update it: what you decided, what is done, what is left, and anything the next agent would otherwise have to rediscover.",
            ]),
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
  return `${guard}\n\n${actionPrompt(state, { readOnly: true })}`;
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
