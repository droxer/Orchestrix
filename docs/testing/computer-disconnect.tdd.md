# Managed computer disconnect guard: TDD evidence

## Source and user journey

No implementation plan was supplied. The journey was derived from the reported
failure: as an employee viewing My Computers, I should only be offered a
Disconnect action when the owner-scoped disconnect API permits that computer to
be removed, and a legitimate active-work refusal should explain what to do
instead of ending in a generic connection error.

## Task report

The My Computers card rendered Disconnect for every assigned computer, including
admin-managed computers. The backend intentionally rejects owner-scoped deletion
of an admin-managed computer with HTTP 403 because its lifecycle belongs to the
managed-node control plane. The card now omits Disconnect when `managedNodeId` is
present while retaining it for self-enrolled personal computers. A personal
computer with active agent work receives HTTP 409; that case now tells the user
to wait for or cancel the work instead of blaming the network.

- Managed-computer RED: `node --test web/tests/computerSurface.test.ts`
  - Result: 20 passed, 1 failed.
  - Failure: `does not offer self-service disconnect for an admin-managed computer`.
- Managed-computer GREEN: `node --test web/tests/computerSurface.test.ts`
  - Result: 21 passed, 0 failed.
- Active-work RED: `node --test web/tests/computerSurface.test.ts`
  - Result: 21 passed, 1 failed.
  - Failure: `explains active work instead of blaming the connection`.
- Final GREEN: `node --test web/tests/computerSurface.test.ts`
  - Result: 22 passed, 0 failed.
- Backend contract: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py -q -k 'employee_can_disconnect_own_computer or employee_cannot_disconnect_an_admin_managed_computer'`
  - Result: 2 passed, 75 deselected.
- Full TypeScript/web verification: `npm run test:ts`
  - Result: production build succeeded; 1,297 passed, 0 failed.
- Full Python verification: `npm run test:py`
  - Result: 1,044 passed, 0 failed, 4 existing warnings.

## Test specification

| # | What is guaranteed | Test target | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | My Computers does not offer the forbidden Disconnect action for an admin-managed computer. | `web/tests/computerSurface.test.ts: does not offer self-service disconnect for an admin-managed computer` | UI source contract | PASS | Focused GREEN run |
| 2 | An active-work refusal gives an actionable localized message rather than a connection warning. | `web/tests/computerSurface.test.ts: explains active work instead of blaming the connection` | UI source contract | PASS | Focused GREEN run |
| 3 | An employee can disconnect a self-enrolled personal computer. | `backend/tests/api/test_daemon_api.py: test_employee_can_disconnect_own_computer` | API integration | PASS | Focused backend run |
| 4 | An employee cannot delete an admin-managed computer through the owner-scoped endpoint. | `backend/tests/api/test_daemon_api.py: test_employee_cannot_disconnect_an_admin_managed_computer` | API integration | PASS | Focused backend run |

## Coverage and known gaps

The repository does not define a TypeScript coverage script, and this UI suite
uses source-contract tests rather than an instrumented React renderer, so no
meaningful line-coverage percentage is available for this change. The exact UI
guards, the localized error contract, and both sides of the backend authorization
contract are covered, and the complete TypeScript/web and Python suites pass.

## Merge evidence

- RED checkpoint: `9a48637f` (`test: reproduce managed computer disconnect failure`)
- GREEN checkpoint: `4eebfb89` (`fix: hide forbidden disconnect action for managed computers`)
- RED checkpoint: `cb90541e` (`test: reproduce active-work disconnect message`)
- GREEN checkpoint: `b2c4ac1a` (`fix: explain active work blocking computer disconnect`)

If these commits are squashed, preserve the RED/GREEN summary above in the PR or
squash commit body.
