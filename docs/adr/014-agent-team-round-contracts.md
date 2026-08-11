# ADR-014: Make Agent-Team Rounds Explicit and Auditable

## Status

Accepted for durable round metadata. Its execution-mode semantics are
superseded and removed by
[ADR-015](015-adaptive-agent-execution.md). This decision does not adopt the
proposed discussion-plan-approval workflow in
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
assignment. Earlier participants contribute through the shared thread and
workspace. A task round that omits or malforms its required verdict parks at
`waiting_for_human`; Relay does not infer completion from exit code zero.

Repair is permitted only when all of the following are true:

- the run belongs to a task;
- the failed member is not the first assignment;
- assignment zero is explicitly marked `coordinator`;
- the bounded repair budget remains.

Relay records a failed assignment and applies the same bounded coordinator
repair or terminal-failure behavior to every run. Roles and phases shape the
agent's contribution but do not switch execution policy.

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
- Discussion, implementation, and review are choices inside one adaptive
  execution path.
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
- only-final-assignment verdict publication and missing/malformed verdicts;
- bounded repair and no inferred lead in non-team pipelines;
- disabled-team normal messages versus explicit recovery decisions;
- prompt and browser materialization of assignment metadata;
- assignment-scoped provider-native collaboration events.
