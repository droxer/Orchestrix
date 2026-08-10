# ADR-015: Make Agent Execution Adaptive by Default

## Status

Accepted. This supersedes and removes the execution modes described by
[ADR-014](014-agent-team-round-contracts.md).

## Context

Relay currently asks the operator to choose `Ask` or `Action` before sending a
goal. That choice exposes an execution mechanism instead of expressing user
intent:

- users must predict whether the agent will need to inspect or modify files;
- a team can be sent into a read-only discussion that cannot continue into
  implementation without another user action;
- an action round does not explicitly require members to respond to prior
  teammates, so a team can look like several unrelated agent runs;
- the same mode choice leaks into composer state, handoff controls, retry
  controls, HTTP request shapes, and provider-specific execution code.

The user intent is already present in the goal. Agents are better placed to
decide whether the goal needs an answer, investigation, planning, workspace
changes, validation, review, or a clarifying question.

## Decision

The public execution interface is:

```text
run(goal, agent-or-team, optional thread/runtime/targeting context)
```

There is no public mode selector. New web requests omit `mode`, including
normal sends, team-room sends, retries, and handoffs.

Every run uses the same workspace-capable execution path. Write access means
the agent *may* change the workspace; it does not require a change. The prompt
tells the agent to choose the smallest appropriate response: answer directly,
inspect, deliberate, modify, validate, or ask for missing human input.

For a team round:

- the backend expands an unaddressed room message to the current team roster;
- every member receives the shared goal, its role/brief, and prior-agent bridge;
- members must respond to accumulated teammate work and avoid duplicating it;
- the coordinator establishes boundaries and keeps the round coherent;
- later members may refine, implement, validate, or challenge earlier work;
- role-derived team phases remain auditable but are not execution modes or
  operator controls.

The old mode type and fields are removed from HTTP payloads, daemon commands,
events, materialized state, capacity accounting, command builders, and the web
client. The database migration drops the remaining mode columns. Relay does
not keep an old-mode compatibility path.

Provider-native subagent collaboration remains assignment-scoped as defined by
ADR-014. Relay team collaboration continues through the shared thread,
prior-agent bridge, and workspace rather than being presented as provider
subagents.

## Consequences

- The composer has one send path and no Ask/Action toggle.
- Handoff and retry preserve the target but do not ask the user for a mode.
- Agents can answer without changing files even though the run is writable.
- Teams can deliberate and continue into useful work in one round.
- Backend, daemon, and web must be upgraded together across this protocol
  boundary.
- The prompt and continuity bridge become correctness-critical orchestration
  infrastructure and require direct regression coverage.

## Verification

- Composer and team-room routing omit mode from new requests.
- Handoff and retry do not expose mode controls.
- Commands, events, artifacts, and API responses contain no execution mode.
- A solo adaptive prompt permits direct answers, investigation, changes, and
  validation without forcing any one of them.
- A team adaptive prompt requires engagement with prior teammate work.
- Claude stream JSONL terminal results are extracted into the prior-agent
  bridge instead of becoming `<no output>`.
- Schema and regression searches prove the old execution-mode fields are gone.
