# Agent-Team Collaboration TDD Evidence

Date: 2026-08-09

## Behavior under test

- A team member receives a bounded, role-aware assignment brief and phase.
- The coordinator and dispatch-time roster are explicit and auditable.
- Only the final assignment may publish the aggregate verdict.
- A missing, malformed, or failed-publisher verdict cannot close a task.
- Repair requires an explicit coordinator and remains bounded.
- Every participant uses the same adaptive execution path; role and phase
  guide its contribution.
- Normal team messages respect current team state; only explicit recovery may
  address a surviving member of a disabled team.
- Provider-native subagents remain scoped to their parent Relay assignment.
- Python, shared TypeScript, and browser event materializers preserve the same
  assignment metadata.

## RED checkpoint

Commit: `3dd7f16 test: add agent team collaboration regressions`

Command:

```bash
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest \
  backend/tests/unit/test_team_dispatch.py \
  backend/tests/unit/test_daemon_registry.py \
  backend/tests/api/test_team_routes.py -q \
  -k 'team_member_assignments_sends or lead_repairs or repair_budget or non_team_pipeline or read_only_team_discussion or final_writable_assignment or reports_no_verdict or malformed_round_result or disabled_team_requires'
```

Result: 7 failed and 2 passed. The failures demonstrated absent briefs and
roster metadata, inferred lead authority, unsafe verdict fallback, and the
disabled-team bypass. TypeScript compilation also rejected the missing
`assignment_brief` state field, so that unbuildable TS test was intentionally
left out of the RED commit rather than bypassing the repository hook.

## GREEN verification

Focused behavior:

```text
223 passed
```

Full repository suites:

```text
Python:     728 passed, 1 skipped
TypeScript: 832 passed, 0 failed
Web:        production Next.js build passed
```

The Web build and full TypeScript suite were run outside the filesystem
sandbox because Turbopack's CSS worker binds a local port; the same build
inside the sandbox failed with `Operation not permitted` before compilation
could complete.

Coverage command used `coverage` ephemerally against the five changed backend
runtime modules and the focused API/unit suites:

```text
agent_routes.py               79%
daemon_registry/registry.py   86%
persistence/store_common.py   89%
services/team_dispatch.py     88%
sessions/controller.py        72%
TOTAL                         84%
```

Repository-wide Ruff currently reports 76 pre-existing findings across
unrelated files. Focused Ruff checks for the independently clean changed
modules and new helper test passed, as did Python compileall and
`git diff --check`.

Security checks:

```text
npm audit --offline --audit-level=high: 0 vulnerabilities
changed-diff secret-pattern scan: no matches
```

An online `npm audit` was not run because approval policy rejected sending the
repository dependency manifest to the configured external registry. The
offline lockfile audit is the retained evidence.
