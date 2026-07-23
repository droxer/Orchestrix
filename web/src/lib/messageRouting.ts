import type { AgentName } from "../types.js";
import type { MentionableAgent } from "./agentDisplayNames.js";

export type RoutedComposerMessage = {
  agentId: string;
  agent: AgentName;
  goal: string;
};

type MentionMatch = {
  start: number;
  end: number;
  labelLength: number;
  priority: number;
  agent: MentionableAgent;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMention(text: string, label: string): Omit<MentionMatch, "agent" | "priority"> | null {
  const match = new RegExp(`(^|\\s)@${escapeRegExp(label)}(?=\\s|$)`, "i").exec(text);
  if (!match) return null;
  const start = match.index + match[1].length;
  return { start, end: start + label.length + 1, labelLength: label.length };
}

function removeMention(text: string, match: Pick<MentionMatch, "start" | "end">): string {
  const before = text.slice(0, match.start).trimEnd();
  const after = text.slice(match.end).trimStart();
  return [before, after].filter(Boolean).join(" ");
}

function chooseAgent(
  agents: MentionableAgent[],
  activeAgentId: string,
  preferredMentionAgentId?: string | null,
): MentionableAgent {
  return agents.find((agent) => agent.id === preferredMentionAgentId)
    ?? agents.find((agent) => agent.id === activeAgentId)
    ?? agents[0];
}

/**
 * Resolve the first @mention as a one-send logical-agent override.
 *
 * Display names are the primary syntax because that is what the picker inserts.
 * Executor names remain compatibility aliases for manually typed mentions.
 */
export function routeComposerMessage(
  raw: string,
  activeAgent: MentionableAgent,
  mentionAgents: readonly MentionableAgent[],
  preferredMentionAgentId?: string | null,
): RoutedComposerMessage {
  const text = raw.trim();
  // Keep the explicitly picked option parseable if readiness changes between
  // insertion and send. The caller can then report it as unavailable without
  // accidentally submitting the mention as user-authored task text.
  const readyAgents = mentionAgents.filter(
    (agent) => agent.ready || agent.id === preferredMentionAgentId,
  );
  const matches: MentionMatch[] = [];

  const displayNameGroups = new Map<string, MentionableAgent[]>();
  for (const agent of readyAgents) {
    const key = agent.displayName.toLowerCase();
    displayNameGroups.set(key, [...(displayNameGroups.get(key) ?? []), agent]);
  }
  for (const agents of displayNameGroups.values()) {
    const mention = findMention(text, agents[0].displayName);
    if (mention) {
      matches.push({
        ...mention,
        priority: 0,
        agent: chooseAgent(agents, activeAgent.id, preferredMentionAgentId),
      });
    }
  }

  const executorGroups = new Map<AgentName, MentionableAgent[]>();
  for (const agent of readyAgents) {
    executorGroups.set(agent.executorKind, [...(executorGroups.get(agent.executorKind) ?? []), agent]);
  }
  for (const [executorKind, agents] of executorGroups) {
    const mention = findMention(text, executorKind);
    if (mention) {
      matches.push({
        ...mention,
        priority: 1,
        agent: chooseAgent(agents, activeAgent.id, preferredMentionAgentId),
      });
    }
  }

  const match = matches.sort((left, right) =>
    left.start - right.start
    || right.labelLength - left.labelLength
    || left.priority - right.priority
  )[0];

  if (!match) {
    return { agentId: activeAgent.id, agent: activeAgent.executorKind, goal: text };
  }

  return {
    agentId: match.agent.id,
    agent: match.agent.executorKind,
    goal: removeMention(text, match),
  };
}
