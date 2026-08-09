# Agent Stream Smoothing TDD Evidence

Date: 2026-08-09

## Behavior under test

- Daemon output chunks are coalesced into bounded ordered batches while
  preserving stdout/stderr callback order, splitting oversized chunks, and
  keeping Unicode surrogate pairs intact at batch boundaries.
- A large run no longer fails merely because more than 256 output posts are
  waiting; one async drain delivers batches in order.
- The backend persists each batch atomically, retries safely after a failed
  append, and restores its deduplication watermark after restart.
- Protocol v2 advertises batch delivery while the backend continues accepting
  legacy v1 registrations and `run.output` events.
- Daemon JSONL logging does not block the agent output callback.
- Backend daemon-event persistence runs outside FastAPI's event-loop thread.
- SSE batches copy the session event list once and message projection consumes
  only the newly appended suffix.
- Live and settled prose use one canonical Markdown document, so structures
  such as loose lists are never split into multiple independent trees.
- Settled transcript blocks retain object identity and stable callback props.
- Poll/SSE deduplication indexes only an append-only cache suffix in the common
  path while still rebuilding safely after cache replacement.

## RED checkpoint

The initial focused runs failed on the deliberately missing behavior:

```text
npx tsc -p packages/tsconfig.json
  Missing OutputEventBuffer and DaemonLogger.flush.

npx tsc -p web/tsconfig.json --noEmit
  Missing ProjectMessagesAccumulator and applySessionEventsUnchecked.

pytest backend/tests/api/test_daemon_api.py
  Event-loop probe observed registry.handle_event on the async loop: [True].

Review follow-up RED:
  300 alternating stdout/stderr chunks (9.8 MiB) ended as run.failed because
  the old per-event delivery exceeded the 256-event backlog circuit.
  Per-stream coalescing changed stdout/stderr callback order.
  A single oversized renderer chunk escaped the configured batch budget.
  A retried batch was discarded after the first persistence attempt failed.
  Splitting live Markdown at blank lines rendered one loose list as two lists.
```

No RED commit was created because this working tree also contains unrelated
user changes and the user did not request a commit.

## GREEN verification

```text
Python backend:                    759 passed, 1 skipped
relay-core/chat/supervisor:        183 passed
Web:                               610 passed
Daemon without local BoxLite:       66 passed, 1 skipped
TypeScript core + daemon builds:    passed
Web TypeScript check:               passed
CSS lint:                           passed
git diff --check:                   passed
```

## Test specification

| Guarantee | Evidence | Type | Result |
| --- | --- | --- | --- |
| 9.8 MiB alternating output completes in fewer than 64 HTTP batches with exact byte order | `packages/relay-daemon/tests/daemon.test.ts` | integration | PASS |
| Adjacent chunks coalesce without changing cross-stream order | `packages/relay-daemon/tests/output-buffer.test.ts` | unit | PASS |
| Character budgets and single oversized chunks flush safely | `packages/relay-daemon/tests/output-buffer.test.ts` | unit | PASS |
| Unicode code points remain intact at batch boundaries | `packages/relay-daemon/tests/output-buffer.test.ts` | unit | PASS |
| Batch append failure can retry; restart dedupes the persisted batch | `backend/tests/unit/test_daemon_registry.py` | integration | PASS |
| One backend batch projects to the transcript in one update | `web/tests/messageBlock.test.ts` | unit | PASS |
| Poll-appended ids are synchronized without rebuilding via `events.map` | `web/tests/useSessionEvents.test.ts` | unit | PASS |
| Memoized messages receive a stable artifact callback | `web/tests/messageBlock.test.ts` | source invariant | PASS |
| Live and settled text share one Markdown tree; a loose list stays one list | `web/tests/streamingMarkdown.test.ts` | unit/source invariant | PASS |

The daemon run used `RELAY_SANDBOX_MODE=none`; two BoxLite/default-mode tests
were excluded because forcing the no-sandbox mode contradicts their assertions,
and the local backend-listen test was skipped in the filesystem sandbox. A
native BoxLite run remains blocked by local Docker socket access.
Browser automation also remains unavailable because the configured Playwright
Chrome extension is not installed. Repository coverage is not configured for
these mixed Python/Node/browser suites, so no coverage percentage is claimed.

Focused Ruff identified only two pre-existing broad exception catches in
`daemon_node_routes.py`. Ruff format also reports pre-existing formatting in
that file and a distant section of `test_daemon_api.py`; those unrelated lines
were intentionally left unchanged.
