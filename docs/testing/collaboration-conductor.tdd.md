# Collaboration Conductor — TDD Evidence

Date: 2026-08-11
Branch: `codex/agent-collaboration-conductor`
Base: `3749ce8`

## Scope

Intent-first thread messages and recovery, versioned immutable round manifests,
task parity, authoritative round projections, extracted advancement policy,
lead-last discussion synthesis, and single-assignment daemon attempt delivery.

## RED / GREEN checkpoints

| Behavior | RED commit | GREEN commit |
| :- | :- | :- |
| Semantic thread messages | `4a0ee1d`, `bc4295c` | `42527c7`, `f0938a6` |
| Task round manifests | `e116bf5` | `8f8ba45` |
| Pure advancement policy | `fe5c5f5` | `f8a30b9` |
| Round projections | `a0a0b97` | `5a06cd2` |
| Semantic recovery | `4f4d6b1` | `adb9dbd` |
| Versioned discussion protocol | `e0238d8` | `99768b1` |
| Revision and attempt delivery | `3d23724` | `3e3826b` |

Each RED checkpoint was observed failing for the missing endpoint, event type,
projection field, policy behavior, protocol metadata, or delivery envelope
before its corresponding implementation.

## Verification

```text
uv run --project backend pytest backend/tests -q
769 passed

npm test
866 TypeScript/package/web tests passed
769 backend tests passed

uv run --with pytest-cov --project backend --extra dev pytest \
  backend/tests/unit/test_collaboration_policy.py \
  backend/tests/unit/test_collaboration_service.py \
  backend/tests/unit/test_team_dispatch.py \
  backend/tests/unit/test_controller.py \
  backend/tests/api/test_team_routes.py \
  --cov=backend/relay/collaboration --cov-report=term-missing -q
53 passed; collaboration package coverage: 91%
```

The first sandboxed `npm test` attempt was blocked when Turbopack tried to bind
its local worker port. The same command passed outside that sandbox boundary.
