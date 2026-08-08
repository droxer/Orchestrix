import type { AgentName, AgentRunInput, AgentTaskMode } from "../types.js";

export type RoutedComposerMessage = {
  agentId: string;
  agent: AgentName;
  goal: string;
};

/** Build a message for the agent selected in the composer footer. */
export function routeComposerMessage(
  raw: string,
  activeAgent: { id: string; executorKind: AgentName },
): RoutedComposerMessage {
  return {
    agentId: activeAgent.id,
    agent: activeAgent.executorKind,
    goal: raw.trim(),
  };
}

/**
 * Resolve a leading `@Name` to one room member.
 *
 * Only a leading mention addresses the turn: "tell @Alice I said hi" is a
 * message to the room that happens to name her. The mention is never stripped
 * from the message — being addressed by name is context the agent should see.
 */
export function resolveLeadingMention(
  raw: string,
  members: Array<{ id: string; displayName: string }>,
): { agentId: string } | null {
  const text = raw.trimStart();
  if (!text.startsWith("@")) return null;
  const candidate = text.slice(1).toLowerCase();
  // Longest name first, so "Support Bot" wins over a hypothetical "Support".
  const byLength = [...members].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );
  const named = byLength.filter((member) => {
    const name = member.displayName.toLowerCase();
    return candidate === name || candidate.startsWith(`${name} `);
  });
  if (named.length === 0) return null;
  const best = named[0];
  const ambiguous = named.some(
    (member) =>
      member.id !== best.id
      && member.displayName.length === best.displayName.length,
  );
  return ambiguous ? null : { agentId: best.id };
}

/** Build the run for a message typed into a team thread: the room, or one member. */
export function teamRunInput({ taskGoal, sessionId, teamMembers, mode, userMessageId }: {
  taskGoal: string;
  sessionId: string;
  teamMembers: Array<{ id: string; displayName: string }>;
  mode: AgentTaskMode;
  userMessageId: string;
}): AgentRunInput {
  const mentioned = resolveLeadingMention(taskGoal, teamMembers);
  return {
    taskGoal,
    sessionId,
    userMessageId,
    ...(mentioned
      ? { assignments: [{ agentId: mentioned.agentId, mode }] }
      : { mode }),
  };
}
