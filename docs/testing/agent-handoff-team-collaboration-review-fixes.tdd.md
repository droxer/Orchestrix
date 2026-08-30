# Agent handoff and team-collaboration review fixes: TDD evidence

## Source and user journeys

The source was the handoff and agent-team collaboration code review. The
covered journeys are: addressing an agent with the same grammar in the browser
and backend, recovering a deleted-team thread without offering invalid targets,
and preserving a complete work graph when legacy data supplies partial fields.

## RED and GREEN evidence

- RED: `backend/tests/unit/test_mention_addressing.py` and
  `backend/tests/unit/test_collaboration_service.py` reported two failures:
  a non-breaking-space leading mention was ignored and a partial work graph
  raised `KeyError: 'workOwnerAgentId'`.
- RED: `npx tsc -p packages/tsconfig.json` failed because the missing-team
  roster helper was not implemented.
- GREEN: the focused backend command reported `39 passed`; the expanded
  affected backend suite reported `107 passed`; targeted web tests reported
  `17 passed`.
- Final gate: backend coverage reported `993 passed` with `86.42%` total
  coverage, exceeding the configured 80% minimum.

## Test specification

| Guarantee | Primary test | Type | Result |
| --- | --- | --- | --- |
| Leading Unicode whitespace addresses the same agent in browser and backend | `backend/tests/unit/test_mention_addressing.py` | unit | PASS |
| Partial legacy graph metadata is completed before manifest creation | `backend/tests/unit/test_collaboration_service.py` | unit | PASS |
| A missing/deleted team roster exposes no handoff or mention target | `web/tests/threadRoster.test.ts` | unit | PASS |
| Team recovery, routing, and collaboration contracts remain intact | affected backend suite | API/unit | PASS |

## Validation and merge evidence

- `ruff check` passed for changed backend files.
- `npx tsc -p packages/tsconfig.json` and `npx tsc -p web/tsconfig.json` passed.
- `git diff --check` passed.
- No intermediate checkpoint commits were created because the shared worktree
  already contained the broader uncommitted handoff feature; the RED/GREEN
  evidence is preserved here before the feature is committed as one change.
