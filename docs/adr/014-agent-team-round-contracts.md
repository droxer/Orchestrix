# ADR-014: Make Agent-Team Rounds Explicit and Auditable

## Status

Accepted. This decision hardens the current sequential, node-scoped team
runtime. It does not adopt the proposed discussion-plan-approval workflow in
[`agent-team-room-design.md`](../agent-team-room-design.md).

## Context

Relay stores a team as a lead and an ordered member roster, but the daemon
executes a run request as a sequence of assignments. Previously, important
team semantics were inferred from array position:

- assignment zero was treated as the lead during repair;
- every member received the same shared goal without a bounded assignment;
- any member could emit a round verdict and a missing verdict could close work;
- roster changes during a round were not visible in the audit trail;
- provider-native subagents were recorded without distinguishing them from
  Relay's logical team assignments.

These implicit rules made retries, partial failures, and post-incident review
ambiguous.

## Decision

Every team round carries explicit, persisted coordination metadata:

- `assignmentId` is generated once when the run request is created and remains
  stable across command redelivery;
- `brief` scopes each member's contribution while `taskGoal` remains the shared
  goal;
- `phase` is one of `discussion`, `execution`, or `review`;
- `coordinator` explicitly identifies the member eligible for a bounded repair
  turn; array position alone grants no authority;
- `teamSnapshot` records the team ID, revision, ordered members, and lead used
  when the round was dispatched.

The metadata flows through the durable run request, daemon command, agent
prompt state, `agent.started` event, Python and TypeScript materializers, and
the browser's incremental event materializer.

Exactly one assignment may publish the aggregate round verdict: the last
writable assignment. Read-only discussion members never receive a verdict-file
instruction. A capable task round that omits or malforms its required verdict
parks at `waiting_for_human`; Relay does not infer completion from exit code
zero.

Repair is permitted only when all of the following are true:

- the run belongs to a task;
- the failed member is not the first assignment;
- assignment zero is explicitly marked `coordinator` and is writable;
- the bounded repair budget remains.

An `ask` or `review` assignment failure does not silence later participants.
Relay records the failed assignment, continues the round, and includes the
incomplete-participation warning in the final outcome. Action failures keep the
bounded coordinator-repair or terminal-failure behavior.

Normal messages to a team thread must pass the team's current enabled,
ownership, membership, and agent-validity checks, including explicitly
narrowed messages. Only an explicit `rerun` or `handoff` recovery decision may
target a still-valid member of a disabled team; recovery never permits an
outside agent.

Provider-native subagents remain internal to one Relay assignment. Their
collaboration events are stamped with `collaborationScope: "assignment"`, the
parent `assignmentId`, and the logical Relay agent ID. They do not become team
members, acquire coordinator authority, or publish the Relay round verdict.

## Consequences

- A reviewer can reconstruct who was expected to participate and what each
  member was asked to do from the event log.
- At-least-once command delivery no longer creates a new logical assignment
  identity.
- A late or malformed member response cannot silently mark a task done.
- Discussion and review gather the remaining members' evidence after a partial
  participant failure, while the final outcome stays visibly incomplete.
- Team membership remains live between rounds but fixed and auditable within a
  dispatched round.
- Relay teams and provider-native subagents can coexist without conflating
  their authority boundaries.
- Execution remains sequential on one node and one thread workspace. Parallel
  turns, dynamic routing, and a human-approved plan-to-execution transition are
  separate decisions.

## Verification

Regression coverage must include:

- role-specific briefs, phases, coordinator marking, and roster snapshots;
- assignment identity and metadata across daemon commands and session events;
- only-final-writable verdict publication and missing/malformed verdicts;
- bounded action repair and no inferred lead in non-team pipelines;
- continued `ask`/`review` participation after one member fails;
- disabled-team normal messages versus explicit recovery decisions;
- prompt and browser materialization of assignment metadata;
- assignment-scoped provider-native collaboration events.
