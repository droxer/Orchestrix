# Duplicate cloud computers TDD evidence

## Source and user journey

No source plan was provided. The journey was derived from the reported fleet
screenshot: as an administrator, I want legacy duplicate cloud-computer records
to converge to one canonical computer so the fleet does not display or
provision the same employee/policy slot repeatedly.

## Task report

### RED: reproduce persisted legacy duplicates

- Added a legacy-state fixture with two running managed-node records for the
  same employee and normalized policy slot.
- Command:
  `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_managed_nodes.py::test_store_startup_reconciles_legacy_duplicate_active_policy_slots -q`
- Result before the fix: `1 failed in 0.24s`; both UUIDs remained active after
  reopening the store.
- Checkpoint: `24183056 test: reproduce legacy duplicate cloud computers`.

### GREEN: reconcile and prevent duplicate slots

- Reopening the store now retains an enrolled/ready record when available,
  otherwise the oldest record, and moves extra records into the existing
  managed-node deletion lifecycle.
- Employee IDs are stripped before policy-slot comparison so whitespace
  variants cannot bypass uniqueness.
- Command:
  `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_managed_nodes.py -q`
- Result: `24 passed in 0.41s`.
- Checkpoint: `74fab5d5 fix: reconcile duplicate cloud computers on startup`.

### Regression and repository verification

- `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py -k 'managed_node' -q`
  — `10 passed, 67 deselected`.
- `npm run test:py` — `996 passed`.
- `npm run test:ts` — production TypeScript/Next.js build completed and
  `1250 passed` on the final run. One daemon timing test failed on the first
  full run, then passed both alone and in the complete rerun.
- `git diff --check` — passed.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Legacy active duplicates in one employee/policy slot converge to one visible running record on restart | `test_store_startup_reconciles_legacy_duplicate_active_policy_slots` | Unit | PASS |
| 2 | A runtime-backed ready record wins over an older unprovisioned duplicate | `test_store_startup_preserves_runtime_backed_duplicate_as_canonical` | Unit | PASS |
| 3 | Whitespace variants of an employee ID cannot create a second active slot | `test_managed_node_employee_ids_are_normalized_before_slot_comparison` | Unit | PASS |
| 4 | Current same-slot and cross-store concurrent creation remains unique | Existing policy-slot concurrency tests in `test_managed_nodes.py` | Unit | PASS |
| 5 | Managed-node provisioning, recovery, deletion, and runtime retirement remain valid | Managed-node subset of `test_daemon_api.py` | API integration | PASS |

## Coverage and known gaps

The backend dev environment does not install `coverage`/`pytest-cov`, so no
numeric coverage report was available without changing project dependencies.
The new selection, reconciliation, and employee-ID normalization branches are
exercised directly by the focused tests above.

`npm audit --audit-level=high --registry=https://registry.npmjs.org` reports
seven pre-existing transitive dependency advisories (five high, two moderate).
No dependency versions changed in this Python persistence fix.

## Merge evidence

The branch preserves separate RED (`24183056`) and GREEN (`74fab5d5`)
checkpoints. If they are squash-merged, retain the RED/GREEN commands and
results above in the squash commit or PR description.
