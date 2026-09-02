# Duplicate cloud computers: TDD evidence

## Source and user journeys

No implementation plan was supplied. The journeys were derived from the reported
My Computers failure:

- As an employee, I want one card per physical or managed computer so daemon
  restarts and cloud reprovisioning do not create duplicate computers.
- As an employee, I want managed cloud capacity excluded from my personal-device
  limit so cloud history cannot prevent me from connecting a local computer.
- As an employee, I want the roster scoped to my account so another employee's
  pending managed computer is never exposed.

## Task report

Daemon registry rows are runtime incarnations, while the UI displays logical
computers. The employee API now omits retired runtime rows and substitutes one
stable managed-node placeholder when a managed runtime is offline. The web
projection also groups rows by the shared stable computer identity, selecting the
healthiest/current incarnation as a defense against stale snapshots. The connect
limit counts only `employee-device` computers.

- Runtime-deduplication RED: an isolated temporary TypeScript compile followed by
  `node --test .../web/tests/computerNodes.test.js` executed the new tests.
  - Result: two failures; both managed replacement and local restart cases
    returned `runtime_old` and `runtime_current` instead of only the current row.
- Limit-count RED: `npx tsc -p packages/tsconfig.json`.
  - Result: compile-time failure because `countEmployeeDeviceComputers` did not
    exist.
- UI-wiring RED: the source-contract test in
  `web/tests/computerSurface.test.ts` failed because the page used
  `myNodes.length`.
- Managed-runtime RED: the focused test in
  `backend/tests/api/test_daemon_api.py` failed because the employee endpoint
  returned the retired runtime id rather than the stable managed-node id.
- Focused GREEN: `node --test dist/web/tests/computerNodes.test.js dist/web/tests/computerSurface.test.js dist/web/tests/status.test.js`.
  - Result: 61 passed, 0 failed.
- Backend boundary GREEN: `PYTHONPATH="$PWD/backend" /Users/feihe/Workspace/Relay/backend/.venv/bin/pytest backend/tests/api/test_daemon_api.py -q`.
  - Result: 79 passed, 0 failed, 1 environment deprecation warning.
- Full TypeScript/web GREEN: `npm run test:ts`.
  - Result: production build succeeded; 1,302 passed, 0 failed.
- Full Python GREEN: `npm run test:py`.
  - Result: 1,046 passed, 0 failed, 4 existing environment/deprecation warnings.
- Pre-commit verification ran during the GREEN checkpoint.
  - Result: file checks, Python AST checks, package typecheck, and web typecheck
    all passed.

## Test specification

| # | What is guaranteed | Test target | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Reprovisioned runtimes for one managed node render as one current cloud computer. | `web/tests/computerNodes.test.ts: shows one cloud computer across managed runtime replacements` | Unit | PASS | Focused GREEN run |
| 2 | Daemon restarts on one employee device render as one current local computer. | `web/tests/computerNodes.test.ts: shows one local computer across daemon restarts` | Unit | PASS | Focused GREEN run |
| 3 | Separate local and managed computers remain separate. | `web/tests/computerNodes.test.ts: preserves genuinely distinct computers owned by one employee` | Unit | PASS | Focused GREEN run |
| 4 | A retired managed runtime becomes one stable offline placeholder, not a historical card. | `backend/tests/api/test_daemon_api.py: test_employee_daemon_list_replaces_retired_managed_runtime_with_one_placeholder` | API integration | PASS | Backend boundary run |
| 5 | A superseded local runtime is omitted from the employee API. | `backend/tests/api/test_daemon_api.py: test_employee_daemon_list_hides_superseded_local_runtime` | API integration | PASS | Backend boundary run |
| 6 | A user receives only managed placeholders assigned to their employee identity. | `backend/tests/api/test_daemon_api.py: test_employee_daemon_list_replaces_retired_managed_runtime_with_one_placeholder` | Authorization integration | PASS | Alice received one Alice node while a Bob node existed |
| 7 | Managed computers do not consume the self-service local-computer limit. | `web/tests/computerNodes.test.ts: counts local computers without charging managed capacity against the limit` | Unit | PASS | Focused GREEN and 100% scoped coverage |
| 8 | My Computers uses the local-only count helper instead of total card count. | `web/tests/computerSurface.test.ts: counts only employee-device computers, not managed cloud capacity` | UI source contract | PASS | Focused GREEN run |

## Coverage and known gaps

`node --test --experimental-test-coverage --test-coverage-include='dist/web/src/lib/computerNodes.js' dist/web/tests/computerNodes.test.js`
reported 100% line, branch, and function coverage for the changed computer-node
projection module. The affected API is covered through the real application,
authentication store, managed-node store, daemon registry, and HTTP route.

The repository has no browser E2E fixture for authenticated My Computers data,
so the final card count is guarded by the pure projection tests, UI source
contract, successful Next production build, and API integration tests rather
than a Playwright browser test. No data migration is required: historical rows
remain available internally but retired rows are excluded from user-facing
projections immediately.

## Merge evidence

- RED checkpoint: `d077f2e6` (`test: reproduce duplicate computer runtime cards`)
- GREEN checkpoint: `b6359018` (`fix: collapse duplicate computer runtime cards`)

If these commits are squashed, preserve the RED/GREEN summary above in the PR or
squash commit body.
