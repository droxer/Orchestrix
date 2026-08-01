# Backend Low-Latency Scalability Plan

## Objective

Scale Relay's control plane across multiple API replicas, daemon nodes, and
logical agents without sacrificing durable delivery or per-thread ordering.

## Service-level targets

- API admission: p95 below 30 ms in-region.
- Routing decision: p95 below 5 ms once placement state is warm.
- Queued command to daemon acknowledgement: p95 below 50 ms in-region.
- Committed agent output to connected browser: p95 below 100 ms.
- No duplicate active run for a thread under retries or replica failover.
- Idle SSE and daemon connections produce no periodic database traffic faster
  than the bounded recovery interval.

## Invariants

1. PostgreSQL remains the durable authority for sessions, tasks, commands,
   leases, and run state.
2. Notifications are hints. Losing one may increase latency but must not lose
   work; bounded database recovery reads remain in place.
3. Work is serialized by domain key (`session_id`, `task_id`, `node_id`, or
   `agent_id`), never by a process-wide lock.
4. Delivery is at least once. Idempotency keys, leases, sequence numbers, and
   fencing prevent duplicate effects.
5. Agents sharing a mutable workspace retain node affinity unless the
   workspace is backed by shared, versioned storage.

## Delivery stages

### Stage 1: notification-driven wakeups

- Add one process-local keyed notifier with a PostgreSQL `LISTEN/NOTIFY`
  bridge for cross-replica wakeups.
- Wake thread SSE readers after committed session events.
- Wake daemon long polls after commands become visible.
- Retain slow fallback reads for missed notifications and recovery.
- Bound event-page reads so reconnect bursts cannot load an unbounded history
  in one query.

### Stage 2: replica-safe coordination

- Hydrate nodes registered after a replica starts.
- Replace process-local workspace request futures with durable correlated
  responses plus notification fan-out.
- Move managed-node desired state and provisioning attempts into PostgreSQL.

### Stage 3: keyed dispatch concurrency

- Replace the registry-wide dispatch lock with node/session-scoped database
  claims.
- Reserve node capacity atomically before command creation.
- Run scheduler workers independently with bounded `SKIP LOCKED` claims.

### Stage 4: storage read/write amplification

- Remove full event history from mutable session/task snapshots.
- Incrementally update compact projections.
- Batch high-frequency agent output events.
- Add cursor-paginated summary queries and owner/status filters.

### Stage 5: production controls

- Make database pool limits explicit and budget them across replicas.
- Add request admission limits and bounded per-node queues.
- Export latency, event-loop lag, connection-pool, queue-depth, lease, and
  notification-recovery metrics.
- Add repeatable load scenarios for SSE fan-out, daemon fleets, dispatch bursts,
  reconnect storms, and output-heavy runs.

## Rollout

Each stage keeps the old durable read path as a fallback. Notification delivery
can therefore be enabled before polling intervals are relaxed, and each change
can be rolled back independently without changing the daemon command schema.
