# Task workspace isolation TDD evidence

## Source and user journeys

No source plan was provided. The journeys were derived from the review findings
for backlog tasks, routine occurrences, project tasks, and task-drawer file
browsing:

- As a task owner or assignee, I can browse only the workspace layout that the
  task's newest surviving session actually used.
- As an operator, I can replace or downgrade a daemon without a queued task
  command silently running against the node root.
- As a task-drawer user, I can leave an empty nested directory without closing
  and reopening the drawer.

## RED evidence

- `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_task_workspace_routes.py backend/tests/unit/test_daemon_registry.py -q`
  ran 210 tests: 206 passed and four new regressions failed. The failures showed
  that project tasks returned 503, a daemon without `task-workspaces` received
  task browse and run commands, and an unavailable newest node fell back to an
  older workspace.
- `npx --no-install tsc -p packages/tsconfig.json && node --test dist/web/tests/taskWorkspace.test.js`
  compiled the web tests and ran six cases: five passed and the new nested-empty
  directory case failed because the state was `empty` instead of `ready`.

RED checkpoint: `e7f2f75a test: reproduce task workspace isolation regressions`.

## GREEN evidence

- The focused backend command above passed 210/210 tests.
- The focused compiled web target passed 6/6 tests.
- `npm run test:py` passed 1,090/1,090 tests.
- `npm run test:ts` completed all package builds, the production Next.js build,
  aggregate TypeScript compilation, and 1,318/1,318 tests.
- Repository commit hooks passed Python syntax and hygiene checks plus package
  and web TypeScript typechecks.
- `git diff 3a542ac4..HEAD --check` passed.

GREEN checkpoint: `491395bb fix: preserve task workspace isolation and navigation`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A project-backed task browses the project layout and recorded project subpath | `backend/tests/api/test_task_workspace_routes.py::test_project_task_browses_the_recorded_project_workspace` | API integration | PASS |
| 2 | A task workspace read is unavailable when the daemon no longer advertises `task-workspaces` | `backend/tests/api/test_task_workspace_routes.py::test_task_workspace_rejects_a_daemon_that_lost_task_workspace_support` | API/security integration | PASS |
| 3 | An unavailable newest workspace session does not expose an older, stale node copy | `backend/tests/api/test_task_workspace_routes.py::test_newest_workspace_session_does_not_fall_back_to_an_older_node` | API integration | PASS |
| 4 | A queued task-layout run is failed before delivery after daemon capability loss | `backend/tests/unit/test_daemon_registry.py::test_task_dispatch_fails_if_the_daemon_loses_task_workspace_support` | Unit/security integration | PASS |
| 5 | An empty nested directory keeps navigation controls available | `web/tests/taskWorkspace.test.ts` | Unit | PASS |

## Security review

- Task authorization still runs through `get_task_for_actor` before node or file
  resolution.
- User paths still run through `workspace_path`, and durable subpaths still run
  through the daemon's containment and symlink validation.
- The live node must advertise both `workspace-read-shared` and the capability
  matching the recorded durable layout before a browse command is enqueued.
- A queued `task` command is rejected at delivery time if the current daemon no
  longer advertises `task-workspaces`, preventing older daemons from treating
  the unknown layout as the node root.
- No credentials, tokens, or secret-bearing logging were added.

## Coverage and known gaps

- Node's focused coverage report for `taskWorkspaceState` is 100% lines and
  functions and 92.31% branches.
- The repository has no configured Python coverage command in its development
  dependencies. The new backend behavior is exercised through both API and
  registry tests, and the complete Python suite passed.
- `npm audit --audit-level=high` could not complete because the configured
  `registry.npmmirror.com` endpoint returned 404/`NOT_IMPLEMENTED` for npm's
  security advisories API. No dependency result is claimed.
- The Playwright MCP startup timeout did not affect these unit, integration,
  build, or typecheck results.

## Merge evidence

Keep the RED and GREEN checkpoint messages above in the PR or squash-commit
body if the checkpoints are squashed.
