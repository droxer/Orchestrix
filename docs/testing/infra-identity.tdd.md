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

## Provisional identity follow-up

Review found a second startup-order failure: a persisted daemon can be loaded
before it has reported its host machine id. In that window, `computer_id()`
returns the routing-only `node:<daemon-id>` fallback. The first migration could
persist that fallback onto the agent and placement, after which registration
treated it as immutable and never converged on the later
`device:<employee>:<machine>` identity.

### Follow-up RED evidence

- The migration and node-sync suite ran 44 tests: 36 passed and the eight new
  local/database and registration cases failed as intended.
- The failures proved all three affected states: migration persisted a
  routing-only identity, startup skipped already-persisted provisional
  identities, and daemon registration did not promote either compatibility or
  plain agents when the durable machine identity arrived.

RED checkpoint: `b75112b9 test: reproduce provisional computer identity lock-in`.

### Follow-up GREEN evidence

- The same focused migration and node-sync suite passed 44/44 tests.
- The broader identity, placement, agent API, and daemon API suite passed
  212/212 tests.
- `npm test` completed the production build and passed 1,308/1,308 TypeScript
  tests plus 1,061/1,061 Python tests.
- `make pre-commit-run` passed all repository hooks, including both TypeScript
  typechecks and the web design-token style check.
- Diff coverage from the follow-up RED checkpoint is 95% (23 executable lines,
  one uncovered defensive warning line).

GREEN checkpoint: `56dc41dc fix: promote provisional computer identities`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Legacy and stable placements for one Computer render in one workforce band | `web/tests/agentGroups.test.ts` | Unit | PASS |
| 2 | Local and database placement stores can retain a stable employee-device identity while rebinding runtime ids | `backend/tests/unit/test_agent_placements.py` | Unit | PASS |
| 3 | Startup migration persistently backfills active legacy placement identities and is idempotent | `backend/tests/unit/test_agent_computer_id_migration.py` | Unit | PASS |
| 4 | Daemon registration repairs a legacy placement onto the current runtime without recreating the agent or placement | `backend/tests/unit/test_node_agents.py` | Integration | PASS |
| 5 | Agent-list responses normalize a legacy placement to the agent's stable Computer identity | `backend/tests/api/test_agent_api.py` | API integration | PASS |
| 6 | Startup defers migration until a durable managed or employee-device identity exists | `backend/tests/unit/test_agent_computer_id_migration.py` | Unit | PASS |
| 7 | Startup promotes previously persisted `node:` agent and placement identities | `backend/tests/unit/test_agent_computer_id_migration.py` | Unit | PASS |
| 8 | Daemon registration promotes compatibility and plain agents when the machine identity arrives | `backend/tests/unit/test_node_agents.py` | Integration | PASS |

## Coverage and known gaps

- Node test coverage for the roster target: 87.33% lines overall; the changed
  `agentGroups` module is 100% lines/functions and 80% branches.
- Python diff coverage across the two task commits: 91% (46 changed executable
  lines, 4 uncovered defensive/error lines).
- Python diff coverage for the provisional-identity follow-up is 95% (23
  changed executable lines, 1 uncovered defensive warning line).
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
