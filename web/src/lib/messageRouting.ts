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

export type ThreadMessageAddress = {
  blocked: boolean;
  reason?: "mention" | "selected-agent";
  addressAgentIds: string[];
};

/**
 * Resolve exactly who a composer message addresses.
 *
 * A leading mention wins over the footer selection. Omitting
 * `defaultAgentId` intentionally addresses the room (for example, a team
 * thread). Supplying a null, unknown, or unavailable selection blocks rather
 * than silently widening the message to the room.
 */
export function resolveThreadMessageAddress({ text, candidates, defaultAgentId }: {
  text: string;
  candidates: readonly MentionCandidate[];
  defaultAgentId?: string | null;
}): ThreadMessageAddress {
  const parsed = parseMentions(text, candidates);
  if (parsed.blocked) {
    return { blocked: true, reason: "mention", addressAgentIds: [] };
  }
  if (parsed.addressAgentIds.length) {
    return { blocked: false, addressAgentIds: parsed.addressAgentIds };
  }
  if (defaultAgentId === undefined) {
    return { blocked: false, addressAgentIds: [] };
  }
  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === defaultAgentId && candidate.eligible,
  );
  if (!selectedCandidate) {
    return { blocked: true, reason: "selected-agent", addressAgentIds: [] };
  }
  return { blocked: false, addressAgentIds: [selectedCandidate.id] };
}

/** Stable retry identity for one semantic continued-thread request. */
export function threadMessageOperationKey({ sessionId, text, intent, addressAgentIds }: {
  sessionId: string;
  text: string;
  intent: ThreadMessageInput["intent"];
  addressAgentIds: readonly string[];
}): string {
  return JSON.stringify([
    sessionId,
    text,
    intent,
    [...new Set(addressAgentIds)].sort(),
  ]);
}

/**
 * Build semantic intent for a message typed into a thread.
 *
 * Addressing is resolved and validated before this serialization boundary.
 */
export function threadMessageInput({ text, addressAgentIds, userMessageId }: {
  text: string;
  /** Empty intentionally addresses the whole room. */
  addressAgentIds: readonly string[];
  userMessageId: string;
}): ThreadMessageInput {
  return {
    text,
    intent: "accomplish",
    userMessageId,
    idempotencyKey: userMessageId,
    ...(addressAgentIds.length
      ? { addressAgentIds: [...addressAgentIds] }
      : {}),
  };
}
