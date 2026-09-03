# Dangling legacy session ID TDD evidence

## Source and user journey

No source plan was provided. The journey was derived from the reported task
assignment failure:

- As a task owner, I can change an assignment when the task contains a dangling
  pre-UUID session link, without the backend returning a database error.

## RED evidence

- `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_schema_drift.py::test_dangling_legacy_session_id_is_treated_as_missing -q`
  failed against a freshly migrated PostgreSQL schema. `get_session("ses_legacy")`
  raised `sqlalchemy.exc.DataError` caused by PostgreSQL
  `InvalidTextRepresentation`, matching the reported failure.

RED checkpoint: `04a47f6e test: reproduce dangling legacy session lookup`.

## GREEN evidence

- The RED command passed 1/1 after the fix.
- The focused PostgreSQL schema test and assignment/deletion API regression set
  passed 5/5 tests.
- A read-only replay against affected task
  `d7614b20-d9af-436c-b8cd-d4968348c872`, whose only linked session remains
  `ses_mrxdemjt_5ty3a4`, returned `hasActiveLinkedSession: False`.
- `npm test` completed the production builds and passed 1,318/1,318 TypeScript
  tests and 1,091/1,091 Python tests.
- Ruff and `git diff --check` passed.

GREEN checkpoint: `052d8ff0 fix: treat legacy session ids as missing`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A malformed legacy ID is reported by the database session store as missing instead of reaching a PostgreSQL UUID predicate | `backend/tests/unit/test_schema_drift.py::test_dangling_legacy_session_id_is_treated_as_missing` | PostgreSQL integration | PASS |
| 2 | A task containing only that dangling link is not classified as actively executing | `backend/tests/unit/test_schema_drift.py::test_dangling_legacy_session_id_is_treated_as_missing` | Service integration | PASS |
| 3 | A real active linked session still prevents assignment changes | `backend/tests/api/test_tasks.py::test_active_task_assignment_cannot_change` | API integration | PASS |
| 4 | Active dispatch and linked-thread protections still prevent task deletion | `backend/tests/api/test_tasks.py::test_task_delete_rejects_active_dispatch_and_linked_thread` | API integration | PASS |

## Coverage and known gaps

- The repository has no configured Python coverage command in its development
  dependencies. The changed branch and both observable outcomes are exercised
  by the PostgreSQL regression test, focused API tests, and complete suite.
- The fix prevents the runtime failure but deliberately does not rewrite
  historical task events or task snapshots. Event-log data repair requires a
  separate compensating-event migration.
- `npm audit --audit-level=high --registry=https://registry.npmjs.org` reported
  nine existing dependency advisories: six high and three moderate. This
  Python-only fix adds or updates no dependencies.

## Merge evidence

Keep the RED and GREEN checkpoint messages above in the PR or squash-commit
body if the checkpoints are squashed.
