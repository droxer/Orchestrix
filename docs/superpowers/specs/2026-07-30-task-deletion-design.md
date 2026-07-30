# Backlog and Routine Task Deletion — Design

**Date:** 2026-07-30
**Status:** Implemented
**Scope:** Backlog tasks, assigned/routed tasks, and routine definitions in the
web client and Python control plane

## Problem

Relay needs one predictable way to remove work from Backlog and Routines
without losing execution history or allowing active work to become detached
from its task.

The repository already has the basic path:

- both edit drawers expose a destructive Delete action;
- `DELETE /api/v1/tasks/{task_id}` appends `task.deleted`;
- live task lists omit tombstoned records;
- linked threads and routine occurrences are preserved.

The remaining product decision is lifecycle safety. The current endpoint uses
the general task-access check and can tombstone a task while a dispatch claim
or linked thread is active. That leaves running work without a visible task.
The feature should make deletion a deliberate domain operation rather than a
thin store call.

## Goals

- Delete a Backlog task, an assigned/routed task, or a routine definition from
  its edit drawer.
- Keep the event log authoritative and make repeated delete requests safe.
- Stop a deleted routine from creating future occurrences.
- Preserve linked threads, artifacts, prior occurrences, and run history.
- Prevent deletion while execution of that task is being claimed or is
  actively running.
- Restrict deletion to the task owner or an administrator.
- Give localized, accessible confirmation, progress, success, and failure
  feedback.

## Non-goals

- Hard-deleting event history or database rows.
- Cascading deletion to threads, artifacts, occurrences, or daemon runs.
- Cancelling active execution as a side effect of deletion.
- Bulk deletion.
- User-facing restore or trash management. The tombstone format should leave
  room for a later `task.restored` event, but restore is not part of this
  feature.

## Decision

### 1. One deletion module at the task lifecycle seam

Introduce a deep task-deletion module in the control plane. Its external
interface is one operation:

```python
delete_task(task_id: str, actor: Actor) -> TaskDeletionResult
```

The caller should not need to reproduce ownership rules, execution-state
checks, routine behavior, or idempotency. The module owns those invariants and
uses the task and session stores as internal dependencies.

`TaskDeletionResult` contains the tombstoned task plus a stable outcome:

```python
class TaskDeletionResult(TypedDict):
    task: dict[str, Any]
    outcome: Literal["deleted", "already_deleted"]
```

The HTTP route remains a small adapter at this seam. It maps domain failures to
HTTP responses and does not implement deletion policy itself.

### 2. Eligibility rules

| Task state | Delete result |
|---|---|
| Unassigned Backlog task | Allowed |
| Assigned task not yet claimed | Allowed; it will no longer be dispatchable |
| Blocked or done task | Allowed |
| Disabled routine | Allowed |
| Enabled routine | Allowed; no future occurrences, while already-created occurrences continue independently |
| Active dispatch claim, dispatch in progress, or active linked thread | Rejected with `task_execution_active` |
| Actor is assignee but not owner | Rejected with `task_delete_forbidden` |
| Already deleted | Idempotent success with the original `deletedAt` |
| Unknown task | `task_not_found` |

“Active linked thread” means a linked session whose status is not one of
`completed`, `failed`, or `cancelled`.

Deleting an assigned task does not mutate its assignment first. The terminal
`task.deleted` event is sufficient: dispatch queries already exclude deleted
records, and the assignment remains available in audit history.

### 3. Concurrency and scheduling

The deletion decision and tombstone append must be serialized with task claim
and routine-promotion writes. A route-level “check, then delete” is not enough:
a scheduler can claim the task between those operations.

- Local storage uses the task store lock for the eligibility recheck and
  `task.deleted` append.
- Database storage locks the task row in the same transaction used to append
  the event and update the snapshot.
- Claim and routine-occurrence creation recheck `deletedAt` while holding the
  corresponding lock/transaction.
- A held dispatch claim is treated as active even if a session has not been
  linked yet. This closes the dispatch-claim-to-session-link race.
- If deletion wins first, later claim or occurrence creation returns no work.
- If a task claim wins first, deletion returns `409 task_execution_active`.
- Routine promotion is serialized with definition deletion. If promotion wins
  first, that occurrence remains valid and deletion stops all later
  occurrences; if deletion wins first, no occurrence is created.

The module reads linked session states to classify active execution. No linked
session is completed, cancelled, archived, or unlinked by deletion.

### 4. Persistence semantics

Deletion remains an event-sourced soft delete:

```json
{
  "type": "task.deleted",
  "taskId": "...",
  "timestamp": "...",
  "actorEmployeeId": "..."
}
```

Add the actor identifier to new deletion events for auditability. The
materialized snapshot sets `deletedAt` and may expose `deletedByEmployeeId`.
Readers must continue to materialize older deletion events that lack the actor
field.

External read behavior:

- `GET /tasks` excludes deleted tasks.
- `GET /tasks/{id}` returns `404` for a deleted task.
- a repeated authorized `DELETE` remains successful and returns the original
  tombstone, so network retries are safe;
- internal stores retain `get_task()` access to tombstoned snapshots for audit
  and idempotency.

Deleting a routine tombstones only the routine definition. Existing occurrence
tasks keep their `sourceRoutineId`, linked threads, artifacts, and history.

### 5. HTTP interface

Keep the existing route:

```http
DELETE /api/v1/tasks/{task_id}
```

Successful response:

```json
{
  "task": { "id": "...", "deletedAt": "..." },
  "outcome": "deleted"
}
```

The response envelope makes the operation extensible and distinguishes an
idempotent retry (`already_deleted`) without changing status codes.

| Condition | Status | Detail code |
|---|---:|---|
| Deleted or already deleted | 200 | response outcome |
| Missing task | 404 | `task_not_found` |
| Actor can view but cannot delete | 403 | `task_delete_forbidden` |
| Dispatch/run active | 409 | `task_execution_active` |

The client should key localized feedback from stable codes, not English server
messages.

### 6. Web interaction

Keep Delete inside the edit drawer rather than adding a high-risk card action.
It remains the leftmost destructive action in the drawer footer, separated
from Cancel and Save.

#### Backlog task

- Button: **Delete task**
- Dialog title: **Delete task?**
- Body: **“{title}” will be removed from Backlog. Linked threads, artifacts,
  and run history will stay available.**

#### Routine definition

- Button: **Delete routine**
- Dialog title: **Delete routine?**
- Body: **“{title}” and its schedule will be deleted. It will not run again.
  Existing occurrences and threads will stay available.**

Confirmation behavior:

1. Focus moves into the danger confirmation dialog.
2. The dialog names the task/routine and explains what is preserved.
3. While pending, Delete shows a loading state and drawer actions are disabled.
4. On success, close the drawer, refresh task queries, and announce a localized
   success toast through the existing live region.
5. On `task_execution_active`, keep the drawer open and announce: **This task
   has active work. Cancel or finish its thread before deleting it.**
6. On any other error, keep the drawer open and return focus to Delete so the
   user can retry.

Routine copy must come from the `routine.*` namespace, including the destructive
button label and pending label. Shared dialog actions remain under `dialog.*`.

## Code ownership

- `backend/relay/services/task_deletion.py` — new deletion module and domain
  outcomes/errors.
- `backend/relay/api/task_routes.py` — HTTP adapter only.
- `backend/relay/persistence/task_store.py` and persistence protocols — atomic
  tombstone/claim coordination and actor metadata.
- `backend/relay/persistence/store_common.py` — backward-compatible event
  materialization.
- `web/src/components/task-board/TaskDrawer.tsx` — destructive action state and
  routine-specific labels.
- `web/src/components/BacklogPage.tsx` and `RoutinesPage.tsx` — confirmation,
  mutation outcome, close, and announcement.
- `web/src/hooks/useRelayMutations.ts` and `web/src/api.ts` — typed response and
  stable error-code handling.
- all three locale files — task/routine confirmation, active-work error,
  pending, and success copy.

Do not add a second client-side deletion abstraction until another surface
needs the same interaction. The backend lifecycle seam is real because both
the HTTP route and scheduler/dispatch coordination depend on it; the two page
handlers can remain small presentation adapters.

## Testing

### Control plane

- owner and admin can delete; assignee-only access cannot;
- Backlog, assigned, blocked, done, and inactive routine deletion succeeds;
- active dispatch claim and active linked session return 409;
- terminal linked sessions do not block deletion;
- deleting an enabled routine prevents later promotion;
- existing occurrences and linked sessions remain readable;
- repeated delete is idempotent and does not append a second event;
- list and item HTTP reads hide tombstoned tasks;
- local and database adapters pass the same contract tests;
- claim-versus-delete concurrency tests prove that exactly one operation wins;
- routine-promotion-versus-delete concurrency tests prove there are no
  occurrences after the deletion event (an occurrence committed immediately
  before deletion remains valid).

### Web

- both edit drawers expose deletion only for persisted records;
- Backlog and Routine use distinct localized confirmation copy;
- cancel leaves the record and drawer unchanged;
- pending state prevents duplicate mutation and save;
- success closes the drawer, refreshes queries, and announces success;
- 409 keeps the drawer open and shows the active-work message;
- every locale contains the required copy;
- keyboard focus enters and exits the confirmation dialog correctly.

## Rollout

1. Add the backend deletion module, authorization rule, active-work guard, and
   adapter contract tests.
2. Make claim/promotion and deletion atomic in both persistence adapters.
3. Update the web response type, routine-specific labels, and 409 feedback.
4. Run focused backend and web tests, then the repository verification loop.

No data migration is required. Existing `task.deleted` events continue to
materialize; only new events include actor metadata.

## Risks

- Cross-store task/session reads can create a check/write race if the final
  eligibility check is left in the route. Keep the decisive check in the
  lifecycle module and serialize it with task writes.
- Returning 404 for deleted item reads while keeping DELETE idempotent requires
  separate external-read and internal-store behavior; do not teach the general
  store getter to hide tombstones.
- Restoring an enabled routine could immediately make it due. A future restore
  design should restore routines disabled by default unless the user explicitly
  re-enables them.
