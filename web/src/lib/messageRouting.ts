import type { AgentName, ThreadMessageInput } from "../types.js";
import { parseMentions, type MentionCandidate } from "./mentions.ts";

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
 * Build semantic intent for a message typed into a thread.
 *
 * Mentions at the head of the message address specific agents; anything else
 * addresses the whole room. Mentions are left in the text — being addressed by
 * name is context the agent should see.
 */
export function threadMessageInput({ text, candidates, userMessageId }: {
  text: string;
  /** Agents `@` may name here; empty makes every message a room message. */
  candidates: readonly MentionCandidate[];
  userMessageId: string;
}): ThreadMessageInput {
  const { addressAgentIds } = parseMentions(text, candidates);
  return {
    text,
    intent: "accomplish",
    userMessageId,
    idempotencyKey: userMessageId,
    ...(addressAgentIds.length ? { addressAgentIds } : {}),
  };
}
