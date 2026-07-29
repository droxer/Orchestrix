# Backend restart agent-readiness TDD evidence

## User journey

As an employee with local and managed Computers, I want their Logical Agents to
remain available across a Relay backend restart so that a live daemon does not
appear online while every agent is temporarily offline.

## Evidence

| Guarantee | Test or command | Type | Result | Evidence |
|---|---|---|---|---|
| An authenticated daemon poll after registry restart restores computer liveness without losing the last registered executor readiness | `backend/tests/unit/test_daemon_registry.py::test_registry_restart_keeps_agents_ready_when_live_daemon_resumes_polling` | Unit/contract | PASS | RED: `2 failed`, with Codex `unknown`; GREEN: `2 passed` after persisted capability hydration was fixed |
| Existing backend behavior remains compatible | `backend/.venv/bin/pytest backend/tests -q` | Regression | PASS | `539 passed, 1 warning in 59.25s` |
| Both real runtimes remain online with all executor capabilities ready immediately after backend restart | `curl -s http://127.0.0.1:8790/api/v1/daemon-nodes` projected through `jq` | Operational | PASS | Local and managed nodes both reported `online: true`, `stale: false`, and Claude/Pi/Codex/Kimi `ready` |

## TDD checkpoints

- RED: `73946f4 test: reproduce agent readiness loss after backend restart`
- GREEN: `42e44c5 fix: preserve agent readiness across backend restarts`

## Coverage and known gaps

No separate coverage command was run; the focused test covers both
`LocalDaemonStore` and `DatabaseDaemonStore`, and the complete backend suite
passed. Frontend card-view polling is a separate concern and is not part of
this backend restart regression.
