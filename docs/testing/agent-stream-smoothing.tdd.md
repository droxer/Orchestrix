# Agent Stream Smoothing TDD Evidence

Date: 2026-08-09

## Behavior under test

- Daemon output chunks are coalesced into at most one event per stream and
  latency window, including when stdout and stderr alternate rapidly.
- Daemon JSONL logging does not block the agent output callback.
- Backend daemon-event persistence runs outside FastAPI's event-loop thread.
- SSE batches copy the session event list once and message projection consumes
  only the newly appended suffix.
- Settled streaming prose and completed code fences render as stable Markdown
  while only the incomplete tail remains plain text.
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
  300 alternating stdout/stderr chunks ended as run.failed because 300 HTTP
  output events exceeded the 256-event backlog circuit.
  OutputEventBuffer emitted 3 entries where the bounded contract expected 2.
  TypeScript rejected the missing SessionEventIdIndex and settled-render API.
```

No RED commit was created because this working tree also contains unrelated
user changes and the user did not request a commit.

## GREEN verification

```text
Python backend:                    739 passed, 1 skipped
relay-core/chat/supervisor:        183 passed
Web:                               608 passed
Daemon without local BoxLite:       57 passed, 1 skipped
TypeScript core + daemon builds:    passed
Web TypeScript check:               passed
git diff --check:                   passed
```

## Test specification

| Guarantee | Evidence | Type | Result |
| --- | --- | --- | --- |
| 300 alternating stdout/stderr chunks complete with two output posts | `packages/relay-daemon/tests/daemon.test.ts` | integration | PASS |
| One latency window emits at most one entry per stream | `packages/relay-daemon/tests/output-buffer.test.ts` | unit | PASS |
| Poll-appended ids are synchronized without rebuilding via `events.map` | `web/tests/useSessionEvents.test.ts` | unit | PASS |
| Memoized messages receive a stable artifact callback | `web/tests/messageBlock.test.ts` | source invariant | PASS |
| Live and settled text share one prose component and settle only the tail | `web/tests/streamingMarkdown.test.ts` | unit/source invariant | PASS |

The daemon run used `RELAY_SANDBOX_MODE=none`; BoxLite-specific tests were
excluded because forcing the no-sandbox mode contradicts their assertions, and
the local backend-listen test was skipped in the filesystem sandbox. A native
BoxLite run remains blocked by local Docker socket access.
Browser automation also remains unavailable because the configured Playwright
Chrome extension is not installed. Repository coverage is not configured for
these mixed Python/Node/browser suites, so no coverage percentage is claimed.

Focused Ruff identified only two pre-existing broad exception catches in
`daemon_node_routes.py`. Ruff format also reports pre-existing formatting in
that file and a distant section of `test_daemon_api.py`; those unrelated lines
were intentionally left unchanged.
