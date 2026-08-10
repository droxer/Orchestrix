# Collaboration Conductor — TDD Evidence

Date: 2026-08-11
Branch: `codex/agent-collaboration-conductor`
Base: `3749ce8`

## Scope

Intent-first thread messages and recovery, versioned immutable round manifests,
task parity, authoritative round projections, extracted advancement policy,
lead-last discussion/review synthesis, single-assignment daemon attempt delivery,
and crash-safe durable admission with terminal-state fencing.

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
| Intent and synthesis boundary fixes | `a07756b` | `4324805` |
| Durable prepared admission | `3dbc6b1` | `dda2b91` |
| Interrupted-admission reconciliation | `7d6dc8b` | `7af0214` |
| Prepared cancellation and expiry | `4a38caa` | `ce31527` |
| Terminal activation fencing | `5c2e855` | `a2202e1` |
| Cross-crash delivery fencing | `074c89d` | `2b1d787` |
| Terminal command-claim fencing | `b267a2e` | `0238ebe` |

Each RED checkpoint was observed failing for the missing endpoint, event type,
projection field, policy behavior, protocol metadata, or delivery envelope
before its corresponding implementation.

## Verification

```text
npm run build
passed (packages and production web build)

node --test <all built package/web tests except relay-daemon daemon.test.js>
813 passed

uv run --project backend --extra dev pytest backend/tests -q
796 passed, 1 skipped

uv run --project backend --extra dev pytest \
  backend/tests/api/test_agent_api.py \
  backend/tests/api/test_session_stream.py \
  backend/tests/api/test_tasks.py \
  backend/tests/unit/test_collaboration_service.py \
  backend/tests/unit/test_daemon_registry.py -q
256 passed

uv run --with pytest-cov --project backend --extra dev pytest \
  backend/tests/unit/test_collaboration_policy.py \
  backend/tests/unit/test_collaboration_service.py \
  backend/tests/unit/test_team_dispatch.py \
  backend/tests/unit/test_controller.py \
  backend/tests/api/test_team_routes.py \
  --cov=backend/relay/collaboration --cov-report=term-missing -q
53 passed; collaboration package coverage: 91%
```

The 91% figure is the focused coverage checkpoint. The admission and race suites
were expanded afterward and pass in both focused and repository-wide backend
runs. The isolated `relay-daemon/tests/daemon.test.js` shard could not complete
in this environment because its BoxLite setup invokes Docker and access to the
OrbStack Docker socket is denied. All other built TypeScript/web tests passed.
