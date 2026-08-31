# Deleted managed computer visibility

## Source and user journey

This bug fix was derived from the reported behavior: as an employee, I want a
cloud computer deleted by an administrator to disappear from My Computers,
while a computer that is only stopped remains visible for later restart.

## RED / GREEN evidence

- RED: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py::test_managed_node_provisioning_replays_the_same_runtime_after_lost_response -q`
  failed because the employee's `GET /api/v1/daemon-nodes` response still
  contained the managed runtime after its managed record entered the deleted
  desired state.
- GREEN: the same command passed after the employee endpoint began excluding
  runtimes whose managed record has `desiredState: deleted`.
- Boundary check: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py::test_managed_node_provisioning_replays_the_same_runtime_after_lost_response backend/tests/api/test_daemon_api.py::test_stopped_managed_runtime_preserves_agent_for_restart -q`
  passed (`2 passed`), proving stopped managed computers remain visible.

## Test specification

| Guarantee | Test type | Result |
| --- | --- | --- |
| An employee sees an assigned cloud computer before deletion and no longer sees it after admin deletion. | API integration | PASS |
| A stopped managed computer remains in the daemon-node listing. | API integration | PASS |
| Managed-node lifecycle, daemon APIs, and authenticated node listing remain compatible. | API regression | PASS (`78 passed`) |
| Full Python backend suite remains green. | Repository regression | PASS (`1001 passed, 1 skipped`) |

## Coverage and known gaps

The focused tests exercise the real authenticated API path used by My
Computers. The repository-wide `npm test` completed the production build, then
reported one unrelated existing TypeScript daemon failure in `capability
refresh never probes agents while a run is active` (expected 5 probes, observed
9); the isolated rerun reproduced that same failure. No coverage percentage was
collected for this narrow backend route change.
