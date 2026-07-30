# Task Deletion TDD Evidence

## Source design

[Backlog and Routine Task Deletion — Design](../superpowers/specs/2026-07-30-task-deletion-design.md)

## User journeys

- As a task owner or administrator, I can delete inactive Backlog, assigned,
  and routine work without losing execution history.
- As an assignee who does not own the task, I cannot irreversibly remove the
  owner's work.
- As an operator, I cannot delete a task while its dispatch claim or linked
  thread is active.
- As a web user, I receive task/routine-specific confirmation and a useful
  localized error when active work blocks deletion.

## RED evidence

Backend command:

```text
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_tasks.py -k task_delete -q
```

Result before implementation: `3 failed`. The old route returned the bare task
shape, allowed an assignee-only actor to delete, and allowed deletion with an
active dispatch claim.

TypeScript command:

```text
./node_modules/.bin/tsc -p packages/tsconfig.json --pretty false
```

Result before implementation: `4 errors`. `RelayApiError` lacked `code`, and
`deleteTask` returned `RelayTask` rather than a typed deletion outcome.

RED checkpoint: `db8f354 test: define task deletion lifecycle behavior`.

## GREEN evidence

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Delete returns `deleted`/`already_deleted`, records the actor, hides list/item reads, and remains idempotent | `backend/tests/api/test_tasks.py -k task_delete` | Integration | PASS, 3 tests |
| 2 | Assignee-only deletion is forbidden while owners and admins can delete | `backend/tests/api/test_tasks.py::test_task_delete_requires_owner_or_admin` | Integration | PASS |
| 3 | Active dispatch claims and linked threads reject deletion with `task_execution_active` | `backend/tests/api/test_tasks.py::test_task_delete_rejects_active_dispatch_and_linked_thread` | Integration | PASS |
| 4 | Local and database task stores preserve actor metadata and atomically reject active claims | `backend/tests/unit/test_task_store.py -k delete` | Unit/contract | PASS, 2 tests |
| 5 | The TypeScript client exposes the deletion outcome and stable error code | `dist/web/tests/api.test.js` | Unit | PASS |
| 6 | Every locale has complete Backlog/Routine deletion copy and drawers retain destructive confirmation | `dist/web/tests/taskDeletion.test.js` | Contract | PASS |

Focused validation commands:

```text
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_tasks.py -k task_delete -q
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_task_store.py -k delete -q
./node_modules/.bin/tsc -p packages/tsconfig.json --pretty false && node --test dist/web/tests/api.test.js dist/web/tests/taskDeletion.test.js
```

Focused result: backend `3 passed` and `2 passed`; web `21 passed`.

## Coverage and known gaps

The focused tests cover the new lifecycle module through the HTTP adapter and
exercise both persistence adapters through their shared contract. The full
repository suite and build are run after this report is created; their final
results are recorded in the delivery summary. The repository does not expose a
single configured coverage command with a committed 80% threshold, so coverage
is represented by unit, persistence-contract, HTTP-integration, and web-contract
tests rather than a percentage claim.

The design's explicit high-contention database race is guarded by the same
row-locked, optimistic event append used for task claims. Tests verify the
serialized precondition in both adapters; they do not attempt a probabilistic
thread race against SQLite.
