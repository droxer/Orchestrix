# Backend collaboration and task dispatch TDD evidence

## Source and journeys

The journeys were derived from the backend review completed before this change:

- A discussion or review continues collecting useful results after one participant fails.
- Scheduled backlog and routine runs carry the same durable collaboration manifest as manual runs.
- Retrying a committed collaboration request repairs any missing room admission event.
- A promoted routine occurrence executes the assignment captured by that occurrence.
- A user cannot mutate a task while the scheduler owns an active dispatch claim.

## RED and GREEN evidence

| Guarantee | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Non-action participant failures do not abort later assignments | `test_discussion_round_keeps_collecting_after_a_participant_failure` | No second command was queued | Passed |
| Scheduled agent and team tasks persist manifests and delivery envelopes | Two scheduler dispatch tests | Commands had no `delivery` field | Passed |
| Idempotent retry repairs participant admission | `test_message_retry_reconciles_participants_after_post_dispatch_failure` | Joiner remained absent | Passed |
| Routine occurrence assignment is stable after definition reassignment | `test_routine_start_reuses_the_occurrence_assignment_snapshot` | Replacement agent received the command | Passed |
| Claimed task rejects status and assignment changes | `test_claimed_task_rejects_status_and_assignment_updates` | PATCH returned HTTP 200 | Passed |

The six-target RED run reported `6 failed`. The identical GREEN run reported
`6 passed`.

## Regression and coverage evidence

- Focused backend regression command: `pytest` over collaboration policy/service,
  scheduler/store/registry, task, agent, and team test modules — `378 passed`.
- Repository command: `npm test` — build succeeded, `1236` TypeScript/web tests
  passed, and `970` Python tests passed.
- Coverage command: `pytest --cov=relay --cov-report=term --cov-fail-under=80 -q`
  — `970 passed`; total backend coverage `86.37%`.

Known warnings are existing Starlette/httpx deprecation, pytest marker, and
SQLite resource warnings; no test failed or was skipped because of this change.

## Merge evidence

- RED checkpoint: `5a01b7e5 test: reproduce backend collaboration and task dispatch races`
- GREEN checkpoint: `ee5af7d3 fix: preserve collaboration and task dispatch contracts`

## Dispatch claim fencing round

A follow-up review found four more races in the dispatch path:

- The scheduler claimed a task against the assignment it resolved even when the
  task was reassigned between routing and claim.
- The task PATCH route rejected metadata-only edits while a dispatch claim was
  active, and the pickup route could still reassign a claimed task.
- A `run.failed` event for a non-action participant aborted the round instead
  of letting later assignments continue collecting results.

| Guarantee | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Scheduler claim fences the resolved assignment | `test_scheduler_claim_fences_the_resolved_logical_assignment` | Task dispatched despite reassignment (`dispatched == 1`) | Passed |
| Claimed task rejects pickup reassignment | `test_claimed_task_rejects_pickup_assignment_update` | Pickup returned HTTP 202 | Passed |
| Claimed task still allows metadata edits | `test_claimed_task_allows_metadata_update` | Metadata PATCH returned HTTP 409 | Passed |
| Both task stores guard updates during dispatch | `test_local_task_store_guards_updates_during_dispatch`, `test_database_task_store_guards_updates_during_dispatch` | `update_task_if_not_dispatching` did not exist | Passed |
| A non-action `run.failed` keeps the round collecting | `test_discussion_round_keeps_collecting_after_a_run_failed_event` | No continuation run request was recorded | Passed |

Exact RED command (run from `backend/` at the RED checkpoint):

```sh
pytest tests/api/test_tasks.py::test_claimed_task_rejects_pickup_assignment_update \
  tests/api/test_tasks.py::test_claimed_task_allows_metadata_update \
  tests/unit/test_daemon_registry.py::test_discussion_round_keeps_collecting_after_a_run_failed_event \
  tests/unit/test_task_scheduler.py::test_scheduler_claim_fences_the_resolved_logical_assignment \
  tests/unit/test_task_store.py::test_local_task_store_guards_updates_during_dispatch \
  tests/unit/test_task_store.py::test_database_task_store_guards_updates_during_dispatch -q
```

The RED run reported `6 failed`. The identical GREEN run reported `6 passed`.

### Regression evidence (fencing round)

- Focused backend regression command: `pytest tests/unit/test_collaboration_policy.py
  tests/unit/test_collaboration_service.py tests/unit/test_task_scheduler.py
  tests/unit/test_task_store.py tests/unit/test_daemon_registry.py
  tests/api/test_tasks.py tests/api/test_task_artifacts.py
  tests/api/test_task_history.py tests/api/test_agent_api.py
  tests/api/test_team_routes.py -q` — `394 passed`.
- Repository command: `npm test` — build succeeded, `1236` TypeScript/web tests
  passed, and `976` Python tests passed.

### Merge evidence (fencing round)

- RED checkpoint: `116fd83f test: reproduce team collaboration dispatch races`
- GREEN checkpoint: `2cfb6bc2 fix: fence team collaboration dispatch assignments`
