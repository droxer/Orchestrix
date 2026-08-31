# Supervisor node reconnection TDD evidence

## Scope

This change hardens managed-node connection and reconnection across supervisor
restarts, provider failures, backend stalls, lost enrollment responses, and
runtime retirement.

## RED checkpoint

Commit: `301228a3 test: reproduce supervisor connection recovery failures`

The new regressions failed before implementation:

- A generation change left the prior provider process running.
- A provider inspection exception stopped reconciliation before later nodes.
- A stale `allocating` marker permanently blocked local-process allocation.
- A backend request with a non-responsive fetch never completed.
- A transient enrollment `503` terminated daemon startup.
- Replaying a completed enrollment returned `401` instead of the original
  daemon identity and credential.
- Runtime retirement deleted the registry row, allowing a late daemon
  registration to lose its managed-node identity.

## GREEN checkpoint

Commit: `7dc851fd fix: harden managed node reconnection`

Focused verification:

- Supervisor and daemon suites: 102 passed.
- Daemon API and managed-node store suites: 98 passed.
- TypeScript package typecheck: passed.
- Project pre-commit hooks: passed.

Additional coverage verifies that a restarted supervisor adopts a current
`registering` runtime and replaces a `registering` runtime from an older
generation.

## Full verification

Command: `npm test`

- Production build, package tests, supervisor tests, daemon tests, and web
  tests: 1,250 passed.
- Python backend tests: 993 passed.
- Total: 2,243 passed, 0 failed.

The repository does not configure a coverage command or threshold, so no
coverage percentage is reported. `npm audit --audit-level=high` could not run
because the configured npm mirror returned `404 NOT_IMPLEMENTED` for the audit
API; this was an infrastructure limitation rather than a reported advisory.
