import type { ConversationItem } from "./conversations.js";

export type ConversationGroups = {
  needsYou: ConversationItem[];
  running: ConversationItem[];
  idle: ConversationItem[];
};

// Partition owner-scoped conversations by the signal that matters for agent
// work: which threads await a human decision (needsYou), which have a live
// agent (running), and which are settled (idle). A live run overrides a
// non-running status. Input order (newest-first) is preserved within groups.
export function groupConversations(
  items: readonly ConversationItem[],
): ConversationGroups {
  const needsYou: ConversationItem[] = [];
  const running: ConversationItem[] = [];
  const idle: ConversationItem[] = [];
  for (const item of items) {
    if (item.session.status === "waiting_for_human") {
      needsYou.push(item);
    } else if (item.session.status === "running" || item.runningAgent) {
      running.push(item);
    } else {
      idle.push(item);
    }
  }
  return { needsYou, running, idle };
}
