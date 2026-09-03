# Stale Team Retry TDD Evidence

## Source and user journey

No plan file was supplied. The journey was derived from the reported task
history:

> As a task owner, I want a retry against a missing assigned team to fail
> immediately, so that the task remains blocked instead of entering another
> misleading assigned-to-blocked dispatch cycle.

## Task report

The task update route previously skipped team validation when the submitted
team ID matched the task's stored team ID. A blocked task could therefore be
set back to `assigned` even after that team had been deleted or become
unavailable. The route now revalidates existence, enabled state, and assignee
ownership for an explicitly submitted unchanged team.

The validation keeps the established delegated-task authorization contract:
the task owner may edit a task assigned to another employee's unchanged team,
but cannot select a new team they do not own.

## RED and GREEN evidence

| Stage | Command | Result |
| --- | --- | --- |
| RED | `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_tasks.py::test_retrying_blocked_task_revalidates_unchanged_team -q` | Failed deterministically twice: retry returned HTTP 200 instead of HTTP 404. |
| GREEN | Same focused command | `1 passed` and the stored task remained `blocked`. |
| Authorization regression | `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_tasks.py::test_retrying_blocked_task_revalidates_unchanged_team backend/tests/api/test_team_routes.py::test_task_owner_can_edit_delegated_team_task_without_reassigning_it -q` | `2 passed`. |
| Owning API surfaces | `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_tasks.py backend/tests/api/test_team_routes.py -q` | `68 passed`. |
| TypeScript, web, and production builds | `npm run test:ts` (as the first phase of `npm test`) | `1318 passed`; TypeScript and Next.js builds succeeded. |
| Full backend | `npm run test:py` | `1092 passed`. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | Retrying a blocked task with the same missing team returns HTTP 404. | `backend/tests/api/test_tasks.py::test_retrying_blocked_task_revalidates_unchanged_team` | API integration | PASS |
| 2 | A rejected retry does not change the task from `blocked` to `assigned`. | `backend/tests/api/test_tasks.py::test_retrying_blocked_task_revalidates_unchanged_team` | API integration | PASS |
| 3 | A task owner can still edit a delegated task without gaining access to or reassigning the assignee's team. | `backend/tests/api/test_team_routes.py::test_task_owner_can_edit_delegated_team_task_without_reassigning_it` | Authorization integration | PASS |

## Coverage and known gaps

`UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev --with pytest-cov pytest --cov=relay.api.task_routes --cov-report=term-missing -q`
completed with `1092 passed` and 87% statement coverage for
`backend/relay/api/task_routes.py`.

`npm audit --registry=https://registry.npmjs.org` reported nine existing
transitive dependency advisories (six high, three moderate). Dependency
upgrades were not included because they are unrelated to this Python route
fix. The default configured npm mirror does not implement the audit endpoint,
so the public npm registry was used for the read-only audit.

## Merge evidence

- `307fea80 test: add reproducer for stale team retry` — RED checkpoint.
- `a1624c72 fix: revalidate unchanged task team assignments` — minimal fix.
- `22887cad fix: preserve delegated team edit authorization` — authorization
  refinement after the full suite caught the delegated-owner edge case.
