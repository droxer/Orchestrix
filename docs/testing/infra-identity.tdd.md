# Infrastructure identity TDD evidence

## Source and user journey

No source plan was provided. The journey was derived from the reported
workforce roster and computer screenshots:

> As an employee with agents created across identity-schema generations, I see
> exactly one workforce band per logical Computer, and those agents remain
> attached when that Computer's daemon runtime is replaced.

## RED evidence

- `npx --no-install tsc -p packages/tsconfig.json && node --test dist/web/tests/agentGroups.test.js`
  executed the mixed legacy/stable roster case: 9 passed and 1 failed because
  `node_current` and `device:alice:machine-a` produced separate bands with the
  same label.
- Focused pytest execution produced four intended failures: both placement
  stores rejected `computer_id_value`, node sync retained `node-old`, and the
  agent API omitted the placement's `computerId`.
- Importing `migrate_agent_placement_computer_ids` failed before the startup
  repair was implemented.

RED checkpoint: `67177a1d test: reproduce split legacy computer identities`.

## GREEN evidence

- The same TypeScript target passed 10/10 tests.
- The four affected Python test files passed 114/114 tests.
- `npm run build` completed the package, web production, and aggregate
  TypeScript builds.
- The compiled full TypeScript suite passed 1,308/1,308 tests.
- `npm run test:py` passed 1,053/1,053 tests.
- `make pre-commit-run` passed every repository hook, including package and web
  typechecks plus the full stylelint token check.

GREEN checkpoint: `707672b7 fix: converge legacy placement computer identities`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Legacy and stable placements for one Computer render in one workforce band | `web/tests/agentGroups.test.ts` | Unit | PASS |
| 2 | Local and database placement stores can retain a stable employee-device identity while rebinding runtime ids | `backend/tests/unit/test_agent_placements.py` | Unit | PASS |
| 3 | Startup migration persistently backfills active legacy placement identities and is idempotent | `backend/tests/unit/test_agent_computer_id_migration.py` | Unit | PASS |
| 4 | Daemon registration repairs a legacy placement onto the current runtime without recreating the agent or placement | `backend/tests/unit/test_node_agents.py` | Integration | PASS |
| 5 | Agent-list responses normalize a legacy placement to the agent's stable Computer identity | `backend/tests/api/test_agent_api.py` | API integration | PASS |

## Coverage and known gaps

- Node test coverage for the roster target: 87.33% lines overall; the changed
  `agentGroups` module is 100% lines/functions and 80% branches.
- Python diff coverage across the two task commits: 91% (46 changed executable
  lines, 4 uncovered defensive/error lines).
- Whole-module coverage across the four broad Python modules is 77.32%. The
  repository has no configured global coverage gate; the result is dominated
  by pre-existing untested branches in `node_agents.py` (51%). All changed
  lines in that module are covered.
- `pip-audit` reported no known Python dependency vulnerabilities (the local
  `relay` package is not published and was skipped).
- `npm audit --audit-level=high` reported nine existing transitive dependency
  advisories (six high, three moderate). They are unrelated to this change and
  require a separately scoped dependency update.

## Merge evidence

Keep the RED and GREEN checkpoint messages above in the PR or squash-commit
body if the two commits are squashed.
