# ADR-015: Make the Collaboration Conductor the Workflow Authority

## Status

Accepted. This supersedes the client- and daemon-shaped workflow ownership
described as a limitation in [ADR-014](014-agent-team-round-contracts.md).
ADR-014's assignment identity, roster snapshot, and repair invariants remain in
force.

## Context

Relay previously exposed its execution mechanism as its collaboration model.
Clients submitted assignment arrays, the daemon run request stored a
`currentIndex`, and terminal daemon events advanced that cursor. The same data
therefore meant both "what the team agreed to do" and "what delivery happens
next."

That coupling made ordinary evolution expensive. Adding a discussion protocol,
live membership between rounds, dependency-aware parallel work, or a different
completion rule required coordinated changes in every client and the daemon
registry.

## Decision

Relay owns team collaboration in an event-sourced **Collaboration Conductor**.
Its public inputs describe intent, not transport:

- offer work with `accomplish`, `discuss`, or `review` intent;
- optionally address one current room member;
- request typed `rerun` or `handoff` recovery;
- retain legacy run input only as a compatibility adapter.

The conductor resolves current team membership, authorization, placements, and
runtime affinity. It then compiles the contribution into an immutable round
manifest using the versioned `relay.collaboration.round` contract. A manifest
contains stable collaboration, round, and assignment identities; addressing;
the roster revision used for the round; strategy; and completion policy.

`collaboration.round.started` is the authoritative event. Python, shared
TypeScript, and browser SSE projections expose the same ordered manifest list,
active IDs, and monotonic `collaborationRevision`. Membership is fixed inside a
manifest and re-read when the next round opens.

The advancement and failure rules are pure collaboration policy. The daemon
registry applies their decisions and owns only delivery concerns: capacity,
leases, command staging, output, and retries. Each `run.start` command carries a
single `assignment-attempt` delivery envelope referencing its immutable round
and assignment. The durable staged-command path is the outbox boundary: the
assignment is authorized and recorded before a daemon can claim it.

The compatibility run request may retain a private sequential cursor while the
execution plane migrates. That cursor is not workflow truth and is absent from
the client interface. Future dependency-graph scheduling or custom completion
policies can change the reconciler and manifests without changing message or
recovery callers.

Discussion rounds run non-facilitators first and the team lead last, allowing
the facilitator to synthesize the room. Accomplish rounds retain explicit
coordinator semantics, and review rounds use the manifest's synthesis policy.

## HTTP Interface

```text
POST /api/v1/threads/{threadId}/messages
POST /api/v1/threads/{threadId}/recoveries
```

Message requests contain `text`, semantic `intent`, and optional
`addressAgentId`. Recovery requests contain `kind`, `targetAgentId`, `mode`,
and an optional note. Neither interface accepts daemon IDs, executor kinds, or
assignment arrays.

## Consequences

- Web and future chat clients use one stable intent-first contract.
- Session events can reconstruct the exact team and policy used for every
  round.
- Disabled-team recovery remains possible without allowing normal work or
  outside agents into that room.
- Daemon delivery can be retried at least once without changing logical
  assignment identity.
- The legacy `/agent-runs` route remains a compatibility adapter for new-thread
  creation and older callers; continued-thread web traffic uses the conductor.

## Verification

Coverage must prove semantic room and narrowed messages, disabled-team recovery,
task manifests, stable assignment IDs, versioned contracts, lead-last
discussion, revision parity across projections, pure advancement policy, and
single-assignment daemon delivery envelopes.
