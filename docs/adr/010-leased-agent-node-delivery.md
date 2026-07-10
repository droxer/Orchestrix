# ADR-010: Explicit Leases for Agent-Node Delivery

## Status

Accepted.

## Context

Relay's control plane and daemon nodes communicate over HTTP across process and
network failure boundaries. A poll response can be lost after the backend has
claimed a command, a daemon can restart without its in-memory run map, and a
cancel response can disappear before the daemon sees it. Treating either
backend memory or one response write as proof of delivery can strand work.

Exactly-once execution is not achievable across this boundary without moving
durable execution state and transactional side effects into the worker, which
would conflict with ADR-009. Relay instead needs explicit ownership and
idempotent, at-least-once messages.

## Decision

- The backend remains the durable owner of commands and run state.
- Command polls claim available work with a bounded lease and return a stable
  command id, a per-delivery lease id, an expiry, and an attempt number.
- Current daemons poll with `leaseMode=explicit` and report the command id and
  per-delivery lease id for work they are actually executing. The backend
  renews only matching deliveries directly against the durable store, so the
  heartbeat may land on any backend replica without allowing an expired
  delivery to renew its replacement.
- Missing heartbeats do not immediately fail a run; after lease expiry the
  same command id is eligible for redelivery with a new lease id and incremented
  attempt.
- Legacy pollers may omit `leaseMode`; during migration, the backend preserves
  their server-inferred renewal behavior.
- `run.cancel` is a leased command. It is not acknowledged by being returned in
  a poll response. It remains retryable until the target run becomes terminal,
  at which point all matching cancel commands are completed.
- Daemons deduplicate active `run.start` commands by command id. Output is
  deduplicated by run, stream, and sequence. Terminal events are idempotent at
  the backend boundary.

## Consequences

- Daemon crashes recover automatically after the lease window instead of
  waiting for backend memory to be cleared.
- Database timestamps are normalized as UTC at the persistence boundary so
  lease and run ages do not depend on the backend host timezone.
- Lost cancel responses are retried and cannot silently leave a run executing.
- Delivery is at least once, so agent actions and external writes must continue
  to use approval, idempotency keys, or domain-level deduplication where repeat
  execution would be unsafe.
- The 90-second default lease tolerates multiple missed 25-second long polls
  while bounding normal crash recovery time.
- A future protocol version can remove legacy inferred renewal after old
  daemons are no longer supported.
