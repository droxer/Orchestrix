# Duplicate local computers TDD evidence

## Source and user journey

The local-computer review found a cross-replica enrollment race. Two backend
instances could both observe no pending computer for the same employee and
workspace, mint different node IDs and credentials, and persist both. Starting
only one returned daemon left the other pending row visible indefinitely.

The required journey is: retrying the same local enrollment through any backend
replica returns one node ID and one usable node credential, while different
employees or normalized workspace paths remain distinct.

## Task report

### RED: reproduce the replica race

- Added a deterministic barrier after both registries read the durable store
  and before either persisted its pending node.
- Command:
  `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py -q -k concurrent_local_enrollment_is_idempotent_across_registries`
- Result before the fix: `2 failed, 194 deselected`; both `LocalDaemonStore`
  and `DatabaseDaemonStore` returned two UUIDs.
- Checkpoint: `6926fec0 test: reproduce concurrent local enrollment duplicates`.

### GREEN: atomically claim provisional local identity

- Local enrollment now derives a fixed-length provisional key from employee ID
  and normalized workspace path until the daemon supplies its stable machine ID.
- The file store serializes that claim with an OS file lock. The database store
  uses a partial unique index and returns the winning row and persisted token
  after a uniqueness conflict.
- The key survives daemon registration but is excluded from public API records.
- Migration `20260831_0064` backfills the key, retires unlaunched duplicate
  pending rows, and preserves already-registered physical machines.
- Checkpoint: `384c4a48 fix: make local computer enrollment idempotent`.

## Verification

- Focused local-computer, registry, migration, and API suites: `312 passed`.
- Deterministic replica race after the fix: `2 passed` across file and database
  stores; both callers received the same node ID and same non-empty node token.
- Alembic heads: one head, `20260831_0064`.
- Schema drift test: `1 passed`.
- Full Python suite: `1001 passed`.
- Full TypeScript build: passed, including the production Next.js build.
- TypeScript tests: `1249 passed, 1 failed`. The unchanged daemon timing test
  `capability refresh never probes agents while a run is active` expected five
  readiness probes and observed nine; it also failed alone. No TypeScript file
  changed in either duplicate-computer fix.
- `git diff --check`: passed.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Concurrent same-workspace enrollment through two registries persists one node and returns one credential | `test_concurrent_local_enrollment_is_idempotent_across_registries` | Concurrency integration | PASS |
| 2 | Equivalent workspace paths produce the same provisional claim, scoped by employee | `test_local_enrollment_key_*` | Unit | PASS |
| 3 | Migration retires an unlaunched orphan but preserves registered machines sharing the path | `test_migration_retires_only_unlaunched_duplicate_enrollments` | Migration | PASS |
| 4 | The internal enrollment key is not exposed in the local-enrollment API response | `test_employee_can_create_own_device_enrollment` | API integration | PASS |
| 5 | Existing reconnect, token persistence, local limits, and machine-ID superseding behavior remains valid | Relevant daemon registry/API suites | Regression | PASS |

## Security notes

The authenticated enrollment boundary and absolute-path validation are
unchanged. The claim key is a SHA-256 digest used only for indexing; plaintext
node tokens remain in the existing protected secret field, are never logged in
daemon events, and concurrent losers receive the already-persisted winning
token. The migration and runtime queries use SQLAlchemy parameters rather than
string-built SQL.
