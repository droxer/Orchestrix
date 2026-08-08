# Agent Team as a Room

Status: proposed
Date: 2026-08-08

## Why

A team is defined as a structure and executed as a schedule, and the two halves
disagree about what a team is.

The data model gives a team a lead, members, and per-agent roles — an org chart.
Execution flattens all of that into `assignments[i]` and walks the list in order
(`TaskDispatcher._resolve_team_assignments` →
`ServerDaemonNodeBackend.run` → `DaemonNodeRegistry._enqueue_current_assignment`).
Nothing in the run loop knows the lead is a lead; "lead" means index 0, the
thread's `ownerAgentId`, and the target of the repair turn. Nothing else.

Every complaint about teams is a symptom of that one disagreement, not a
separate missing feature:

- A message typed into a team thread runs one agent, because the composer sends
  one assignment and nothing reads `session.teamId` back.
- `continue` re-runs the entire team rather than whoever still has work.
- There is no way to ask a single member a question without leaving the team
  behind.

## Decision

A team is a **room**: a set of participants in one thread. Members share the
thread, the workspace, and the prompt; each takes a real action turn in order.
The team is not a manager with staff, not a capability pool, and not a router.

Two consequences fix the model:

1. **The thread decides who runs; the client may only narrow.**
   `session.teamId` becomes load-bearing rather than ornamental.
2. **Round execution is reused, not rewritten.** A room turn *is* a pipeline. We
   build the pipeline from the thread instead of only from a task. Advancement,
   admission, and finalization are untouched; the single registry change is
   scoping the repair turn to task pipelines (see Failure).

### The wire rule

Stated once, applied everywhere:

> `assignments` means "exactly these agents". Its absence means "this thread's
> participants."

For a solo thread, participants are the agent already running it. For a team
thread, participants are the team's members, lead first.

Fan-out lives in the backend, not the web app, so the chat gateway (Discord,
Telegram, Lark) inherits room behavior instead of re-implementing it.

## Design

### Backend

`_task_team_agents(task, …)` in `backend/relay/services/team_dispatch.py` is
welded to tasks: it reads `task["assignedTeamId"]` and
`task_execution_employee_id(task)`. Split the seam.

- New `team_agents(team_id, employee_id, *, team_store, agent_store)` holds the
  validation and ordering: team missing or deleted → `team_not_found`; disabled
  → `team_disabled`; owned by another employee → `team_forbidden`; lead absent
  from members or a member deleted → `team_invalid`; order is lead first, then
  the remaining members in stored order.
- `_task_team_agents` becomes a thin wrapper over it. Task behavior is
  unchanged, including `_member_mode` (a `reviewer` asked to act runs `review`).
- A new thread-side caller uses the same helper, so ordering and validation have
  exactly one implementation.

`POST /agent-runs` (`backend/relay/api/agent_routes.py`) stops requiring
`assignments`:

- With a `sessionId` whose session carries a `teamId` and no `assignments`,
  expand to the member list and continue through the existing
  `resolve_agent_assignments` → single-node → sequential-pipeline path.
- With `assignments` present, run exactly those — the narrowing case.
- `TeamDispatchError` maps to HTTP 409 carrying its code, matching how
  `create_session` already handles it.

**Membership check on narrowing:** a narrowed assignment must name an agent that
is a member of the thread's team. Without it a client can inject a non-member
into a team room and the thread's participant set stops meaning anything.

**Live membership:** the roster is read at dispatch, not snapshotted at thread
creation. Someone added to the team joins the next round; someone removed stops
answering. The roster belongs to the team, not to the thread.

Retry, rerun, and handoff name their target by nature. They keep sending
explicit `assignments` and are already covered by the rule.

`DaemonNodeRegistry`'s advancement and admission logic is untouched. Its one
change is in Failure, below.

### Web

`routeComposerMessage` (`web/src/lib/messageRouting.ts`) currently passes
through whichever agent the footer selects. It gains mention parsing, and the
composer gains a participant selector.

Mention parsing is a presentation-layer concern: each front end expresses
addressing in its own idiom (the web parses `@Name`; the Discord adapter maps
Discord's native mention objects). A backend parser would have to learn three
syntaxes and rewrite the user's prompt.

Rules, deliberately boring:

- A mention narrows only when it **leads** the message. `@Alice check the
  migration` addresses Alice. `tell @Alice I said hi` goes to the room.
- Matched case-insensitively against member display names, longest match first,
  because names contain spaces.
- Unknown or ambiguous name → no narrowing, whole room, message unchanged. A
  stray `@` must never block sending.
- **The mention is not stripped.** Being addressed by name is context the agent
  should see, not syntax to consume.

The composer footer for a team thread lists `Team` (the default) plus each
member. Picking a member produces the same wire shape as mentioning them:
mention is the keyboard path, the footer is the discoverable one.

### Failure

**The repair turn does not follow us into chat.** `_send_back_for_repair`
injects "You are the lead on this task: fix the cause so X can run again". In a
task-less room that sentence is false, and repairing a failed discussion turn is
not a coherent instruction. Gate the repair path on `run_request["taskId"]`
being present. Task pipelines keep it; rooms do not.

**Fail-fast stays.** A member exiting non-zero ends the round — later members
never speak, because `has_next` requires `exitCode == 0`. This is arguably wrong
for a room, but changing advancement would change it for the task path too. It
is honest and visible today. See Follow-ups.

## Cost

Every room turn is N agent runs, "looks good, ship it" included. The only cheap
escape in this design is addressing one member.

Letting a member *pass* without a run would require something to decide in
advance that it has nothing to add — a router — and a router is the coordinator
the room model rejects. The tension is real and accepted, not solved.

## Not building

Deliberately excluded, each a live option before the room model was chosen:

- Delegation: no channel for the lead to assign scoped subtasks to members.
- Dynamic routing: advancement stays `index + 1`; no agent picks the next agent.
- Parallel turns: one command in flight, all members on one node.
- Per-member scoping by role or path.
- Plan artifacts or task decomposition.

## Testing

Backend:

- A follow-up into a team thread with no `assignments` expands to every member,
  lead first.
- A narrowed follow-up runs only the named member.
- Narrowing to a non-member is rejected.
- A deleted or disabled team returns 409 with its code.
- A solo thread's follow-up behavior is unchanged.
- The repair turn fires for a task pipeline and not for a task-less room.

Web:

- `messageRouting` mention table: leading mention, mid-string mention, unknown
  name, ambiguous name, no mention.

The registry pipeline tests already cover advancement and need no change.

## Follow-ups

1. A failed member should not silence the rest of the room. Requires advancement
   to distinguish "this member failed" from "the round failed".
2. `continue` re-runs the whole room. Once a round can report which participants
   still have work, continuation could narrow.
