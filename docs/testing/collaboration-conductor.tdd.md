# Collaboration Conductor — TDD Evidence

Date: 2026-08-11
Branch: `codex/agent-collaboration-conductor`
Base: `3749ce8`

## Scope

Intent-first thread messages and recovery, versioned immutable round manifests,
task parity, authoritative round projections, extracted advancement policy,
lead-last discussion/review synthesis, single-assignment daemon attempt delivery,
crash-safe durable admission with terminal-state fencing, and versioned
delegated-subtask work graphs with role-topological execution.

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
| Delegated work graph and projection parity | observed locally before implementation | this change |

The delegated-work RED pass proved four missing seams independently: manifests
had no work graph, accomplish rounds followed roster order instead of role
dependencies, daemon prompts had no durable work-item context, and the browser
SSE reducer discarded work-item fields from `agent.started`. Each failed before
its implementation and passed afterward.

The two-axis review then exposed three RED follow-ups: false lead attribution,
loss of an authoritative empty dependency list, and reviewer-role precedence
over a lead's coordinator phase on continuation. The final model records the
conductor as delegation authority, gives each role item a distinct ordinal
scope, preserves `[]` dependencies through Python and browser projections, and
keeps coordinator action/execution precedence through the public message route.

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

## Final delegated-work graph gate

After the version 2 work graph and both review passes were complete:

```text
npm run build
passed (all packages, TypeScript, and production web build)

node --test <all built package/web tests except relay-daemon daemon.test.js>
801 passed

uv run --project backend --extra dev pytest backend/tests -q
803 passed, 1 skipped

focused pytest-cov gate
62 passed; collaboration package coverage: 91%
```

The daemon shard was attempted again and reached the same environment boundary:
Docker denied access to the OrbStack socket while preparing the BoxLite devbox.
Its shared protocol compiled, its delivery fixture includes `workItemId`, and
all daemon-independent TypeScript tests passed.
