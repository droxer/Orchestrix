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
