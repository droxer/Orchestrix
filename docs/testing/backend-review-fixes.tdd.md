# Backend review fixes: TDD evidence

## Source and user journeys

The source was the August 27, 2026 backend review and the user's request to fix
all eight findings. The covered journeys are: secure first-admin bootstrap,
trusted reverse-proxy identity, PostgreSQL-safe employee/department identities,
atomic employee deletion, timezone-consistent routines, safe initial-user setup,
and bounded JSON ingestion.

## RED and GREEN evidence

- Initial RED: the focused command covering deploy config, JSON helpers,
  initialization, auth stores, employee lifecycle, CLI, and task APIs reported
  `12 failed, 59 passed`. It reproduced unsafe proxy defaults, token logging,
  both bootstrap races, unbounded JSON, the default password/broken script,
  partial local deletion, and scheduler-calendar drift.
- Initial GREEN: the same focused target reported `71 passed`.
- Review RED: three added edge-case regressions reported `3 failed`: distinct
  handles with the same display name collapsed to one employee, an unrelated
  registry update was erased on rollback, and an oversized ASGI chunk was
  copied before rejection.
- Review GREEN: those regressions reported `3 passed`; the expanded focused
  target reported `49 passed`.
- Final gate: full backend coverage run reported `961 passed` and total coverage
  `86.32%` with the configured `80%` minimum satisfied.

## Test specification

| Guarantee | Primary test/evidence | Type | Result |
| --- | --- | --- | --- |
| Bootstrap credentials never appear in CLI logs | `backend/tests/unit/test_cli.py` | unit | PASS |
| Proxy headers are opt-in and require validated non-wildcard IP/CIDR peers | `backend/tests/unit/test_deploy_config.py` | unit | PASS |
| Concurrent local and database bootstrap creates exactly one admin | `backend/tests/unit/test_auth_store.py` | concurrency | PASS |
| Human handles map to stable, distinct UUID-backed records | `backend/tests/unit/test_auth_store.py` | database | PASS |
| Database and file-backed employee cascades roll back on mid-cascade failure | `backend/tests/unit/test_employee_lifecycle.py` | integration | PASS |
| Registry rollback restores touched nodes without erasing unrelated updates | `backend/tests/unit/test_employee_lifecycle.py` | concurrency/rollback | PASS |
| Routine defaults and manual starts share the scheduler calendar | `backend/tests/api/test_tasks.py` | API | PASS |
| Initial-user setup targets the backend module and requires a password | `backend/tests/unit/test_init_users.py` | unit/contract | PASS |
| JSON bodies return 413 at the limit and reject chunks before copying | `backend/tests/unit/test_api_helpers.py` | unit | PASS |

## Coverage, security, and merge evidence

Command:

```text
uv run --project backend --extra dev --with pytest-cov pytest backend/tests \
  --cov=relay --cov-report=term --cov-fail-under=80 -q
```

Result: `961 passed`; `86.32%` total coverage. The run emitted existing
Starlette deprecation and SQLite resource warnings; no test failed or was
disabled. `pip-audit` found no known backend dependency vulnerabilities (the
local `relay` package is not published and was skipped), and `npm audit
--omit=dev --registry=https://registry.npmjs.org` found zero vulnerabilities.

Checkpoint sequence:

- `737a3ab6` — RED regression tests.
- `5f0dcc26` — initial GREEN implementation.
- `f9d0bbf5` — review-driven edge-case fixes.
