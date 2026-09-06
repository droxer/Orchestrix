# Thread recovery and addressed team roles

Source: user-requested fixes from the single-thread collaboration review.

## Guarantees

- Handoff and rerun dispatch the latest user message, falling back to the original
  task goal when no follow-up exists. The original thread goal remains unchanged.
- Continuity retains earlier user turns without duplicating the current prompt.
- Addressed team reviewers retain their role, phase, and brief in accomplish,
  discuss, and review rounds. Only the addressed agent runs.
- Disabled-team recovery still works, and repeating an admission key does not
  create another run or user message. Both semantic and legacy APIs are covered.

## Evidence

Tests: `backend/tests/api/test_team_routes.py`,
`test_recovery_dispatches_current_user_turn` and
`test_addressed_team_reviewer_keeps_specialization`.

- RED (`99e0d366`): focused API tests produced 5 failures and 2 passes. Recovery
  used the original goal; direct reviewer mentions lost phase or role metadata.
- GREEN (`a40e5121`): 78 focused tests passed. The expanded regression command
  below passed all 11 cases, including legacy recovery admission.

```sh
uv run --project backend --extra dev pytest backend/tests/api/test_team_routes.py -q -k 'recovery_dispatches_current or addressed_team_reviewer'
```

Full verification:

- `npm run test:ts`: production build and 1,327 tests passed.
- `npm run test:py`: 1,099 tests passed, with four warnings. This run collected
  tests before the four additional legacy regression cases were added; those
  passed in the focused run above.
- `git diff HEAD~2 --check`: passed.
- `npm test` initially stopped because TypeScript was not installed. After
  `npm ci`, both constituent suites passed separately.

Coverage command:

```sh
uv run --project backend --extra dev --with pytest-cov pytest backend/tests/api/test_team_routes.py backend/tests/api/test_agent_api.py backend/tests/unit/test_collaboration_service.py backend/tests/unit/test_bridge.py backend/tests/unit/test_conversation.py backend/tests/unit/test_handoff.py --cov=relay.collaboration.service --cov=relay.sessions.bridge --cov=relay.daemon_registry.node_backend --cov-report=term-missing -q
```

127 tests passed; aggregate coverage was 82% across the three changed runtime
modules (conductor 88%, node backend 77%, continuity bridge 79%). Tests inspect
persisted events and daemon commands; they do not launch real agent CLIs.

The configured npm mirror did not support audit. An audit against npmjs.org
reported 9 existing dependency advisories (3 moderate, 6 high). This fix does not
change dependency manifests or lockfiles.
