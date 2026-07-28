# Cloud Computer Restart Lifecycle TDD Evidence

## Source plan

The journeys and implementation plan were derived during this TDD run from the reported failure: restarting the supervisor changed the cloud daemon node identity and left the computer's logical agents offline.

## User journeys

1. Restarting the supervisor must leave a running cloud computer and its daemon incarnation alive.
2. A short heartbeat interruption from a healthy provider instance must not trigger reprovisioning.
3. A genuine runtime replacement must preserve the managed computer's logical agent and placement identities.
4. An existing thread must follow that stable placement to the replacement runtime without becoming movable to another computer.

## Task report

### Disposable supervisor lifecycle

- RED: `node --test --test-name-pattern="supervisor shutdown|recent heartbeat" dist/packages/relay-supervisor/tests/managed-reconcile.test.js` failed 2 tests because shutdown called `provider.stop()` and recent heartbeat loss reprovisioned the instance.
- GREEN: `node --test dist/packages/relay-supervisor/tests/managed-reconcile.test.js` passed all 18 tests.
- Guarantee: supervisor process shutdown only detaches local bookkeeping; durable stopped/deleted intent and explicit replacement remain the provider-stop paths. A running instance receives a 60-second heartbeat recovery grace period.

### Stable computer-scoped agents and placements

- RED: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_agent_placements.py backend/tests/unit/test_node_agents.py -q` failed 4 tests because placements could not be rebound and a managed reprovision created a duplicate logical agent.
- GREEN: the same command passed 34 tests.
- Guarantee: compatibility identity uses `managedNodeId`, local and database stores preserve the placement ID when rebinding to a new daemon incarnation, and old daemon-scoped compatibility agents are migrated or retired.

### Existing-thread runtime affinity

- RED: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_agent_routing.py -q` failed `test_managed_runtime_replacement_keeps_existing_session_affinity` with `workspace_unavailable`.
- GREEN: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_agent_routing.py backend/tests/api/test_agent_api.py -q` passed 38 tests.
- Guarantee: a thread resolves its stable placement to the current managed runtime after replacement, while the recorded workspace identity still rejects cross-computer movement.

### Repository compatibility

- `npm test` passed after rerunning outside the filesystem sandbox because Turbopack needs to bind an internal build port: 700 TypeScript tests passed. After the final durable-history review fix, `npm run test:py` passed all 489 Python tests.
- `git diff --check` passed.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Supervisor shutdown does not terminate cloud computers | `packages/relay-supervisor/tests/managed-reconcile.test.ts` | unit | PASS | 18/18 supervisor tests |
| 2 | Recent heartbeat loss does not replace a healthy provider instance | `packages/relay-supervisor/tests/managed-reconcile.test.ts` | unit | PASS | 18/18 supervisor tests |
| 3 | Local and database placements retain their IDs across daemon replacement | `backend/tests/unit/test_agent_placements.py` | unit | PASS | focused Python suite |
| 4 | Managed computers retain one logical agent and one placement across reprovisioning | `backend/tests/unit/test_node_agents.py` | unit | PASS | focused Python suite |
| 5 | Existing sessions follow a managed computer's replacement daemon | `backend/tests/unit/test_agent_routing.py` | unit | PASS | 15/15 routing tests |
| 6 | Runtime drain conflicts never stop the provider first | `packages/relay-supervisor/tests/managed-reconcile.test.ts` | unit | PASS | 18/18 supervisor tests |
| 7 | Runtime retirement and backend restart preserve managed identities | `backend/tests/api/test_daemon_api.py` | integration | PASS | focused 59-test gate |
| 8 | The full repository remains compatible | `npm test`; `npm run test:py` | build + integration | PASS | 700 TS + 489 Python tests |

## Coverage and known gaps

- `node --experimental-test-coverage --test dist/packages/relay-supervisor/tests/managed-reconcile.test.js`: `managed-reconcile.js` line coverage 80.95%.
- `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev --with pytest-cov pytest backend/tests --cov=relay.services.node_agents --cov=relay.services.agent_routing --cov=relay.persistence.agent_placement_store --cov=relay.persistence.agent_store --cov-report=term -q`: combined coverage 85% with 485 passing tests.
- The existing suite reports SQLAlchemy resource warnings and one Starlette/httpx deprecation warning; none were introduced as failures by this change.

## Merge evidence

- RED checkpoint `e0fd76d`: supervisor shutdown/recovery and stable computer agent/placement failures captured.
- RED checkpoint `aef83ee`: managed-session runtime rebinding failure captured.
- GREEN checkpoint `6c068bb`: restart-safe lifecycle implementation and evidence report.
- Review-fix checkpoint: records drain-before-stop ordering, legacy identity migration, and the missing route/startup integration tests.
