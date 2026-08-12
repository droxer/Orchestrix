import type { AgentPlacement, EmployeeAgent } from "../types.js";
import { isEmployeeAgentRoutable } from "./agentDisplayNames.ts";

/** An agent that may be addressed from this thread's composer. */
export type MentionCandidate = {
  id: string;
  displayName: string;
  profileImageUrl?: string | null;
  /** False when the agent does not run on this thread's computer. It stays in
   *  the list so the popup can say why, rather than silently hiding it. */
  eligible: boolean;
  reason?: "off-node" | "unavailable";
};

/** One `@…` token found in the addressing run at the head of the message. */
export type ParsedMention = {
  /** The resolved agent, or null when the name matches nothing (or is
   *  ambiguous) — an unresolved mention blocks the send. */
  agentId: string | null;
  text: string;
  start: number;
  end: number;
  eligible: boolean;
  reason?: MentionCandidate["reason"];
};

export type ParsedMentions = {
  mentions: ParsedMention[];
  /** Agent ids this message addresses. Empty means the whole room. */
  addressAgentIds: string[];
  /** True when some mention cannot be dispatched, so the send must block. */
  blocked: boolean;
};

const MENTION_PREFIX = "@";

/**
 * The agents `@` can name in a thread pinned to `daemonNodeId`.
 *
 * An agent lives on the computers it has placements on, and a thread never
 * leaves its computer, so an agent placed elsewhere can never answer here.
 * Those agents are still returned, marked ineligible, because an empty list
 * with no explanation is worse than a disabled row.
 */
export function mentionCandidates(
  agents: readonly EmployeeAgent[],
  daemonNodeId: string | null,
): MentionCandidate[] {
  return agents
    .filter((agent) => !agent.deletedAt)
    .map((agent) => {
      const routable = isEmployeeAgentRoutable(agent);
      const onNode = !daemonNodeId || agentRunsOnNode(agent, daemonNodeId);
      return {
        id: agent.id,
        displayName: agent.displayName,
        profileImageUrl: agent.profileImageUrl,
        eligible: routable && onNode,
        ...(onNode ? {} : { reason: "off-node" as const }),
        ...(onNode && !routable ? { reason: "unavailable" as const } : {}),
      };
    });
}

function agentRunsOnNode(agent: EmployeeAgent, daemonNodeId: string): boolean {
  return (agent.placements ?? []).some(
    (placement: AgentPlacement) =>
      placement.daemonNodeId === daemonNodeId && placement.desiredState !== "removed",
  );
}

/**
 * Read the addressing run at the head of `text`.
 *
 * Only a leading run of consecutive mentions addresses the turn: "tell @Alice I
 * said hi" is a message to the room that happens to name her. The mentions are
 * never stripped from the message — being addressed by name is context the
 * agent should see.
 */
export function parseMentions(
  text: string,
  candidates: readonly MentionCandidate[],
): ParsedMentions {
  const mentions: ParsedMention[] = [];
  // With nobody to name — the roster has not loaded, or a new thread is still
  // being staged — every `@` is just text. Blocking the send here would punish
  // the author for the app's loading state.
  if (candidates.length === 0) {
    return { mentions, addressAgentIds: [], blocked: false };
  }
  // Longest name first, so "Support Bot" wins over a hypothetical "Support".
  const byLength = [...candidates].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );
  let cursor = leadingSpace(text);
  while (text.startsWith(MENTION_PREFIX, cursor)) {
    const rest = text.slice(cursor + MENTION_PREFIX.length);
    const matched = matchName(rest, byLength);
    if (!matched) {
      // An unknown name ends the run and blocks the send, so a typo never
      // silently becomes a message to the whole room.
      const end = cursor + MENTION_PREFIX.length + wordLength(rest);
      if (end === cursor + MENTION_PREFIX.length) break;
      mentions.push({
        agentId: null,
        text: text.slice(cursor, end),
        start: cursor,
        end,
        eligible: false,
      });
      cursor = end + leadingSpace(text.slice(end));
      continue;
    }
    const end = cursor + MENTION_PREFIX.length + matched.displayName.length;
    mentions.push({
      agentId: matched.eligible ? matched.id : null,
      text: text.slice(cursor, end),
      start: cursor,
      end,
      eligible: matched.eligible,
      ...(matched.reason ? { reason: matched.reason } : {}),
    });
    cursor = end + leadingSpace(text.slice(end));
  }
  const addressAgentIds = [
    ...new Set(
      mentions
        .filter((mention) => mention.eligible && mention.agentId)
        .map((mention) => mention.agentId as string),
    ),
  ];
  return {
    mentions,
    addressAgentIds,
    blocked: mentions.some((mention) => !mention.eligible),
  };
}

/** One run of the draft, either a mention or the plain text between two. */
export type MentionSegment = {
  text: string;
  mention: boolean;
  /** Present only on mention runs; false is what makes one read as blocking. */
  eligible?: boolean;
};

/**
 * Cut `text` into the runs a highlight layer paints: mentions become pills,
 * everything else stays plain. Empty runs are dropped so the layer never
 * renders a zero-width span between two adjacent mentions.
 */
export function mentionSegments(
  text: string,
  mentions: readonly ParsedMention[],
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) {
      segments.push({ text: text.slice(cursor, mention.start), mention: false });
    }
    segments.push({
      text: text.slice(mention.start, mention.end),
      mention: true,
      eligible: mention.eligible,
    });
    cursor = mention.end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), mention: false });
  }
  return segments;
}

/** The `@…` fragment being typed at `caret`, or null when none is open. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upTo = text.slice(0, caret);
  const start = upTo.lastIndexOf(MENTION_PREFIX);
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(upTo[start - 1])) return null;
  const query = upTo.slice(start + MENTION_PREFIX.length);
  // A name may contain spaces, but a paragraph is not a name being typed.
  if (query.includes("\n") || query.split(" ").length > 3) return null;
  return { query, start };
}

/** Splice an accepted name into the draft, leaving the caret after it. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  displayName: string,
): { text: string; caret: number } {
  const inserted = `${MENTION_PREFIX}${displayName} `;
  return {
    text: `${text.slice(0, start)}${inserted}${text.slice(caret)}`,
    caret: start + inserted.length,
  };
}

function matchName(
  rest: string,
  byLength: readonly MentionCandidate[],
): MentionCandidate | null {
  const lowered = rest.toLowerCase();
  const named = byLength.filter((candidate) => {
    const name = candidate.displayName.toLowerCase();
    return lowered === name || lowered.startsWith(`${name} `) || lowered.startsWith(`${name}\n`);
  });
  if (named.length === 0) return null;
  const best = named[0];
  // Two agents whose names are equally long both match: the mention is
  // ambiguous, so it resolves to nobody rather than guessing.
  const ambiguous = named.some(
    (candidate) =>
      candidate.id !== best.id
      && candidate.displayName.length === best.displayName.length,
  );
  return ambiguous ? null : best;
}

function wordLength(rest: string): number {
  const match = /^\S+/.exec(rest);
  return match ? match[0].length : 0;
}

function leadingSpace(text: string): number {
  const match = /^[^\S\n]*/.exec(text);
  return match ? match[0].length : 0;
}
