import type { AgentName } from "../types.js";

export type RoutedComposerMessage = {
  agent: AgentName;
  goal: string;
};

export function routeComposerMessage(
  raw: string,
  activeAgent: AgentName,
  agentNames: AgentName[],
): RoutedComposerMessage {
  const text = raw.trim();
  const mention = /^@([a-z0-9-]+)(?:\s+|$)/i.exec(text);
  const mentionedAgent = mention
    ? agentNames.find((agent) => agent === mention[1].toLowerCase())
    : undefined;

  if (!mentionedAgent || !mention) {
    return { agent: activeAgent, goal: text };
  }

  return {
    agent: mentionedAgent,
    goal: text.slice(mention[0].length).trim(),
  };
}
