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
3. The target steady state serializes work by domain key (`session_id`,
   `task_id`, `node_id`, or `agent_id`). Terminal run finalization and bounded
   stale-run recovery still use a process-wide lock and remain follow-up work.
4. Delivery is at least once. Idempotency keys, leases, sequence numbers, and
   fencing prevent duplicate effects.
5. Agents sharing a mutable workspace retain node affinity unless the
   workspace is backed by shared, versioned storage.

## Delivery stages

### Stage 1: notification-driven wakeups

Status: implemented.

- Add one process-local keyed notifier with a PostgreSQL `LISTEN/NOTIFY`
  bridge for cross-replica wakeups.
- Wake thread SSE readers after committed session events.
- Wake daemon long polls after commands become visible.
- Retain slow fallback reads for missed notifications and recovery.
- Bound event-page reads so reconnect bursts cannot load an unbounded history
  in one query.

### Stage 2: replica-safe coordination

Status: partially implemented.

- [x] Hydrate nodes registered after a replica starts.
- [x] Replace process-local workspace request futures with durable correlated
  responses plus notification fan-out.
- [ ] Move managed-node desired state and provisioning attempts into
  PostgreSQL. Until then, run exactly one managed-node reconciler.

### Stage 3: keyed dispatch concurrency

Status: partially implemented. PostgreSQL node-row locks provide cross-replica
capacity fencing; per-node in-process locks keep unrelated nodes independent.

- [x] Replace the registry-wide hot-path lock with node-scoped locks and
  database claims.
- [x] Reserve node capacity atomically before command creation.
- [ ] Run scheduler workers independently with bounded `SKIP LOCKED` claims.
- [ ] Replace the process-wide terminal-finalization/recovery lock with
  bounded durable claims keyed by run request.

### Stage 4: storage read/write amplification

Status: partially implemented.

- [x] Remove full event history from mutable session snapshots.
- [x] Incrementally update compact session projections.
- [x] Bound event pages and thread summary result counts.
- [ ] Compact task snapshots.
- [ ] Batch high-frequency agent output events.
- [ ] Add cursor-paginated summary queries and status filters. Owner filtering
  is already enforced by the API.

### Stage 5: production controls

Status: partially implemented.

- [x] Make database pool limits explicit and budget them across replicas.
- [x] Add bounded per-node command queues.
- [x] Export notification waiter, wakeup, timeout, bridge, and reconnect
  metrics through the authenticated control-plane endpoint.
- [ ] Add distributed request admission limits.
- [ ] Export latency, event-loop lag, connection-pool, queue-depth, and lease
  metrics through OpenTelemetry.
- [ ] Add repeatable load scenarios for SSE fan-out, daemon fleets, dispatch
  bursts, reconnect storms, and output-heavy runs.

## Rollout

Each stage keeps the old durable read path as a fallback. Notification delivery
can therefore be enabled before polling intervals are relaxed, and each change
can be rolled back independently without changing the daemon command schema.

## Replica and connection budget

Set these variables per API replica:

- `RELAY_DB_POOL_SIZE` (default `10`)
- `RELAY_DB_MAX_OVERFLOW` (default `20`)
- `RELAY_DB_POOL_TIMEOUT_SECONDS` (default `5`)
- `RELAY_DB_POOL_RECYCLE_SECONDS` (default `300`)
- `RELAY_DB_POOL_PRE_PING` (default `true`)
- `RELAY_DAEMON_MAX_QUEUED_COMMANDS_PER_NODE` (default `1000`)

Budget worst-case application connections as:

`replicas × (pool size + max overflow) + migration/admin connections`

Keep that below the PostgreSQL or PgBouncer application budget with headroom
for migrations and incident access. Prefer PgBouncer transaction pooling for a
large replica count; the dedicated async `LISTEN` connection must bypass
transaction pooling or use a session-pooled endpoint.

The authenticated `GET /admin/control-plane/metrics` endpoint reports active
notification waiters and keys, publishes, wakeups, recovery timeouts, bridge
connection state, reconnects, and received cross-replica notifications.

## Current rollout boundary

Multiple API replicas are safe for session streaming, daemon command delivery,
workspace queries, node registration, and run admission when PostgreSQL is the
configured store. Run exactly one managed-node reconciler until managed-node
desired state, provisioning attempts, and enrollment grants move from the local
filesystem into PostgreSQL. This restriction is explicit: it avoids pretending
that filesystem state is a distributed control plane.
