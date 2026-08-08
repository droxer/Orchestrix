# Agent Team: a Room That Deliberates, Divides, and Implements

Status: proposed
Date: 2026-08-08

## Why

A team is defined as a structure and executed as a schedule, and the two halves
disagree about what a team is.

The data model gives a team a lead, members, and per-agent roles — an org chart.
Execution flattens all of that into `assignments[i]` and walks the list in order
(`TaskDispatcher._resolve_team_assignments` → `ServerDaemonNodeBackend.run` →
`DaemonNodeRegistry._enqueue_current_assignment`). Nothing in the run loop knows
the lead is a lead; "lead" means index 0, the thread's `ownerAgentId`, and the
target of the repair turn. Nothing else.

Every complaint about teams is a symptom of that one disagreement, not a set of
separate missing features:

- A message typed into a team thread runs one agent, because the composer sends
  one assignment and nothing reads `session.teamId` back.
- Members deliberate or members implement, but the two never connect: an
  all-`ask` round parks at `waiting_for_human` and the discussion ends as prose.
- Every member receives the same `taskGoal`, so a division of labor cannot be
  expressed even when the team has agreed on one.
- `continue` re-runs the entire team rather than whoever still has work.

## Decision

A team is a **room**: a set of participants in one thread, sharing the thread,
the workspace, and the prompt. It is not a manager with staff, not a capability
pool, and not a router.

Work in that room proceeds in two phases: **the room deliberates until it has a
plan, then the plan divides the work and each member implements its part.** The
plan is the group's output, written down by the lead as scribe — not a lead
issuing orders.

Two structural consequences:

1. **The thread decides who runs; the client may only narrow.**
   `session.teamId` becomes load-bearing rather than ornamental.
2. **A round's output can shape the next round's assignments.** This is the one
   thing the previous draft of this design excluded, and the model does not work
   without it.

## Part 1 — The room

### The wire rule

Stated once, applied everywhere:

> `assignments` means "exactly these agents". Its absence means "this thread's
> participants."

For a solo thread, participants are the agent already running it. For a team
thread, participants are the team's members.

Fan-out lives in the backend, not the web app, so the chat gateway (Discord,
Telegram, Lark) inherits room behavior instead of re-implementing it.

### Backend

`_task_team_agents(task, …)` in `backend/relay/services/team_dispatch.py` is
welded to tasks: it reads `task["assignedTeamId"]` and
`task_execution_employee_id(task)`. Split the seam.

- New `team_agents(team_id, employee_id, *, team_store, agent_store)` holds the
  validation and ordering: team missing or deleted → `team_not_found`; disabled
  → `team_disabled`; owned by another employee → `team_forbidden`; lead absent
  from members or a member deleted → `team_invalid`.
- `_task_team_agents` becomes a thin wrapper over it, so validation has exactly
  one implementation.
- A new thread-side caller uses the same helper.

`POST /agent-runs` (`backend/relay/api/agent_routes.py`) stops requiring
`assignments`:

- With a `sessionId` whose session carries a `teamId` and no `assignments`,
  expand to the member list and continue through the existing
  `resolve_agent_assignments` → single-node → sequential-pipeline path.
- With `assignments` present, run exactly those — the narrowing case.
- `TeamDispatchError` maps to HTTP 409 carrying its code, matching how
  `create_session` already handles it.

**Membership check on narrowing:** a narrowed assignment must name an agent that
belongs to the thread's team. Without it a client can inject a non-member into a
team room and the participant set stops meaning anything.

**Live membership:** the roster is read at dispatch, not snapshotted at thread
creation. Someone added to the team joins the next round; someone removed stops
answering. The roster belongs to the team, not to the thread.

Retry, rerun, and handoff name their target by nature. They keep sending
explicit `assignments` and are already covered by the rule.

### Addressing

Mention parsing is a presentation-layer concern: each front end expresses
addressing in its own idiom (the web parses `@Name`; the Discord adapter maps
Discord's native mention objects). A backend parser would have to learn three
syntaxes and rewrite the user's prompt.

`routeComposerMessage` (`web/src/lib/messageRouting.ts`) currently passes
through whichever agent the footer selects. It gains mention parsing:

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

## Part 2 — Task work: deliberate, divide, implement

### Mode mapping

A team task's requested mode selects the shape of the work. This preserves every
existing mode behavior and adds the two-phase flow under `action`:

| Mode | Behavior |
|---|---|
| `action` | Two-phase: discussion round → plan → human approval → execution round |
| `ask` | Discussion only, parks at `waiting_for_human` (unchanged) |
| `review` | One review round, every member reviews (unchanged) |

**Assumption:** every team task dispatched as `action` deliberates first, even a
trivial one. There is no "just do it, skip the discussion" mode in v1. See
Follow-ups.

Single-agent tasks are unaffected throughout.

### Phase A — discussion, lead last

The discussion round runs every member in `ask` mode. `askPrompt`
(`packages/relay-core/src/prompts.ts`) already does exactly the right thing: it
is read-only by CLI flag, and it instructs members to respond to each other,
agree, disagree, identify risks, and refine the plan.

**Ordering inverts for this phase: members first, lead last.** The lead must
hear the room before it can write the split. Ordering therefore becomes
phase-dependent rather than universal — deliberation ends with the lead,
execution follows the plan.

Rejected alternative: the lead bookending the discussion (framing turn first,
synthesis last). It costs an extra run per task, and members read the same task
goal anyway, so the framing turn buys little.

### Phase B — the plan file

The lead writes `.relay/plan.json`, riding the rails `.relay/round-result.json`
already uses: the agent writes a file, the daemon relays it, the backend
validates it. The relay path is a daemon capability, so nodes that lack it never
receive the instruction to write the file.

```json
{
  "summary": "one line the operator reads first",
  "assignments": [
    { "agentId": "…", "instruction": "what this member does, concretely" }
  ],
  "openQuestions": ["…"]
}
```

Validation mirrors `_round_result`: nothing the daemon relays is trusted. An
unknown or non-member `agentId` is dropped, instructions are length-capped, and
an empty assignment list means no plan was produced (the task parks with the
discussion intact and no plan to approve).

A member the plan does not name **does not run** in the execution round. This is
also the answer to the cost problem: "everyone acts in turn" means everyone with
a part, not everyone on the roster.

### Phase C — approval

The task parks at `waiting_for_human` carrying the plan. The operator approves,
edits, or rejects it. Approval dispatches the execution round.

A wrong split costs nothing to fix at this gate, which is why the gate exists:
the alternative — auto-executing the plan — burns a full execution round before
anyone can see that the division of labor was wrong.

### Phase D — execution

Assignments are built from the approved plan, in plan order, each carrying its
own instruction. This needs the one genuinely new wire field: a **per-assignment
brief**.

Today `taskGoal` lives on the run request and every command copies it verbatim,
so a division of labor is unrepresentable. The brief flows assignment → run
command → `AgentState` → a `[Your part]` prompt prelude. It is kept distinct
from the existing `agent_instructions`, which is the agent's durable character
rather than this round's job.

### Round budget

A two-phase task burns two rounds minimum against `maxTaskRounds`
(`backend/relay/services/task_rounds.py`). **The discussion round is exempt from
the budget**, so the budget keeps meaning "attempts at the work" rather than
silently halving for every team.

## Failure

**The repair turn is scoped to task pipelines.** `_send_back_for_repair` injects
"You are the lead on this task: fix the cause so X can run again". In a task-less
chat room that sentence is false and the instruction is incoherent, so gate the
repair path on `run_request["taskId"]`. For task work the repair turn becomes
*more* justified than before: the lead authored the plan the failing member was
executing.

**Fail-fast stays.** A member exiting non-zero ends the round, because
`has_next` requires `exitCode == 0`. This is arguably wrong for a room, but
changing advancement changes it for every path at once. It is honest and visible
today. See Follow-ups.

## Not building

- **Dynamic routing.** Advancement stays `index + 1` within a round. The plan
  decides the next round's assignments; no agent picks the next agent mid-round.
- **Parallel turns.** One command in flight, all members on one node.
- **Per-member workspace scoping** by role or path. The plan divides the work;
  the workspace stays shared.
- **Auto-execution** of a plan without human approval.
- **A lead that commands.** The lead is scribe and repair owner. The plan is the
  room's output.

## Testing

Backend:

- A follow-up into a team thread with no `assignments` expands to every member.
- A narrowed follow-up runs only the named member; a non-member is rejected.
- A deleted or disabled team returns 409 with its code.
- A solo thread's follow-up behavior is unchanged.
- A team task dispatched as `action` runs the discussion round with members
  first and the lead last.
- A relayed plan is validated: unknown agent dropped, non-member dropped,
  oversized instruction capped, empty assignments parks without a plan.
- Approval dispatches an execution round containing only the named members, each
  with its own brief; members absent from the plan do not run.
- The discussion round does not consume the round budget.
- The repair turn fires for a task pipeline and not for a task-less room.
- `ask` and `review` team dispatches behave exactly as they do today.

Web:

- `messageRouting` mention table: leading, mid-string, unknown, ambiguous, none.
- The plan approval surface renders the plan and its open questions, and
  approve / edit / reject reach the backend.

Registry pipeline tests already cover advancement and need no change.

## Follow-ups

1. A failed member should not silence the rest of the room. Requires advancement
   to distinguish "this member failed" from "the round failed".
2. A dispatch mode that skips deliberation for trivial team work.
3. `continue` re-runs the whole room. Once a round reports which participants
   still have work, continuation could narrow — the plan file is the natural
   place for that signal to live.
