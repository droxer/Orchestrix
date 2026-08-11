# Composer `@` agent mentions

Address one or several agents from the chat input by typing `@Name`, with an
autocomplete popup, a live recipients row, and permanent room growth.

Status: approved design, not yet implemented.

## Problem

The composer can address exactly one target, chosen from the footer
`AgentSelect`: one logical agent, or one team. Multi-agent work therefore
requires staging a team up front, and a running thread can never involve anyone
it did not start with.

A partial mention feature already exists for team threads only:
`resolveLeadingMention` in `web/src/lib/messageRouting.ts` resolves a leading
`@Name` against the team roster into a single `addressAgentId`. There is no
autocomplete, no visual feedback, and no way to name more than one agent.

## Decisions

| Question | Decision |
|---|---|
| Where does `@` work | Any thread, solo or team |
| Who is mentionable | Any agent the acting employee owns **that lives on this thread's computer** |
| Mentioning a non-member | They join the thread permanently |
| Two mentions in one message | Parallel fan-out, one round, N assignments |
| Message with no `@` | Goes to the whole room |
| Input surface | Plain textarea + autocomplete popup + resolved-recipients row |
| Which `@`s address | Only the leading run of consecutive mentions |
| Ineligible mention | Blocks the send |

## Architecture

### The room becomes a roster

Today a solo thread's room *is* `session.ownerAgentId`, and
`backend/relay/collaboration/service.py` rejects any message addressing anyone
else ("A normal message may only address the solo room's agent"). Permanent
joins therefore require real membership state, not a flag.

`RelaySession` gains `participantAgentIds: string[]`, derived by replay like
every other snapshot field — never mutated directly. A new event
`thread.participants_joined` (`agentIds`, `actorEmployeeId`, `at`) is appended
by the conductor in the round that first addresses a non-member.

Seeding at creation: a solo thread starts as `[ownerAgentId]`; a team thread as
the team's `memberAgentIds`. `ownerAgentId` keeps its existing meaning — who the
thread started with — but stops being the definition of the room.

The roster only grows. No leave or remove in v1: nobody asked for it, and
removal raises in-flight-run questions that buy nothing today.

### Room fan-out

`address.kind === "room"` resolves to assignments for every roster member,
replacing both the `ownerAgentId` branch and the team-members branch. Team
threads keep their team snapshot for display and lead-agent semantics, but the
roster is what dispatches — so a team thread and a grown solo thread stop being
two dispatch paths.

### Eligibility, enforced server-side

An agent may be addressed only if all hold:

1. owned by the acting employee,
2. routable — `enabled`, not deleted, availability not `offline`
   (`isEmployeeAgentRoutable`'s existing definition, which permits `busy`),
3. has an **active placement on this thread's pinned daemon node**.

Rule 3 is the same-computer constraint. It lives in the conductor beside the
existing `resolve_agent_assignments` node resolution; the composer's filtered
popup is a convenience, never the authority. Violations return a typed
`agent_not_on_thread_node` error rather than the blanket `agent_forbidden`.

### Wire contract

`MessageIntent.address_agent_id: str | None` becomes
`address_agent_ids: list[str]`, where empty means "room".
`POST /threads/{id}/messages` accepts `addressAgentIds: string[]`; the singular
`addressAgentId` stays accepted and normalizes to a one-element list, so
`relay-chat`'s gateway keeps working without a coordinated deploy. The web
client sends the plural form.

### Dispatch

The conductor already builds `raw_assignments` as a list and `address` as
`{"kind": "members", "agentIds": [...]}`; the mention set feeds both directly.
Parallel fan-out needs no scheduler work: one round, N assignments, N concurrent
`agent.started` events, N answer streams, each carrying its own
`logicalAgentId` so transcript labels stay correct.

Ordering within a round is unspecified and stays so. Mention order is not
execution order; to let one agent see another's output, send a second message.

`_request_fingerprint` must include the **sorted** address list, so the same
text sent to a different mention set is a distinct request rather than a
replayed one — sorted because `@alice @bob` and `@bob @alice` are one dispatch.

Joins happen inside the round: the conductor computes
`newcomers = addressed − roster`, validates them, and appends
`thread.participants_joined` before the round's authoritative event. There is no
separate add-participant endpoint — the only way into a room is being addressed,
which keeps membership traceable to a message.

## Frontend

### `web/src/lib/mentions.ts` (new, pure)

Generalizes `resolveLeadingMention` rather than sitting beside it. Scans a run
of consecutive `@Name` tokens from the start of the trimmed text, matching
longest-name-first so "Support Bot" beats "Support", stopping at the first token
that is not a known name. Returns resolved agent ids plus each mention's
character span; the recipients row needs spans to delete a chip.

- Only the leading run addresses the turn. `tell @alice I said hi` is a message
  to the room that names her.
- Mentions are never stripped from the text — being addressed by name is context
  the agent should see.
- Ambiguity (two eligible agents sharing a display name) resolves to nothing and
  surfaces as an unresolved chip, matching today's single-mention behavior.

`resolveLeadingMention` and `teamMembersForMention` collapse into this module;
`teamMessageInput` and `threadMessageInput` become one `threadMessageInput`
taking the candidate set. Existing tests move rather than being rewritten.

Candidates are the employee's routable agents with an active placement on the
thread's node. Agents failing only the node test still appear, disabled, labeled
"not on this computer" — an empty list with no explanation is worse.

### Components

`MentionPopup` opens on a lone `@` at a word boundary, filters as you type, and
commits on Enter/Tab/click by splicing plain text into the existing value.
`↑`/`↓` navigate, Esc closes. Enter is captured only while the popup is open, so
the send shortcut is unaffected.

`MentionRecipients` renders above the input from the parse result: avatar chips
for resolved agents, a rejected chip with its reason for ineligible ones, and
nothing at all when the message is going to the room. Removing a chip splices
its span out of the text.

The textarea is untouched — autosize, paste, IME composition, and i18n keep
working. `useComposer` keeps owning the text; the parse is derived per render,
not stored, so there is no second source of truth to drift.

### Existing surfaces

The footer `AgentSelect` keeps its current job: choosing the target while
*staging* a new thread. Once started it is the read-only readout it already is
for teams. Because un-mentioned messages go to the whole room, it has no
per-message role, and giving it one would contradict that.

Send is disabled whenever any chip is unresolved or ineligible, with the reason
in the button's title. Busy agents pass: `isEmployeeAgentRoutable` treats busy
as routable and the footer picker already allows addressing a busy agent, so a
stricter mention rule would be an inconsistency rather than a safeguard.

`ThreadHeader` grows a compact participant strip, so a room that gained members
looks different from one that did not.

New i18n keys go in all three locales (`en`, `zh-CN`, `zh-TW`).

## Testing

**`web/tests/mentions.test.ts`** (new) — leading single and multi mention;
mid-text mention treated as prose; names containing spaces; longest-name-first
precedence; ambiguous name resolving to unresolved; span correctness for chip
deletion; candidate filtering by node placement.

**`web/tests/composer.test.ts`** (new) — popup opens on `@` and filters; commit
splices text; Enter routes to the popup while open and to send while closed;
send blocked on an ineligible chip.

**`backend/tests/`** — multi-address dispatch produces N assignments in one
round; addressing a non-member appends `thread.participants_joined` and grows
the roster; room fan-out covers roster members added mid-thread; addressing an
agent on another node returns `agent_not_on_thread_node`; singular
`addressAgentId` still accepted; fingerprint distinguishes address sets and is
order-insensitive.

**`packages/relay-chat/tests/chat.test.ts`** — the gateway's singular path is
unchanged.

## Out of scope

- Mentioning a **team** by name. Deliberate: team fan-out already has a
  dedicated staging path, and a team mention would need its own membership
  semantics on join.
- Removing a participant.
- Sequential or role-ordered execution within a round.
- Queueing a turn behind a busy agent's current run.
