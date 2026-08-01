# Backend low-latency scalability — TDD evidence

## Scope

This packet covers notification-driven session/daemon delivery, cross-replica
workspace coordination, node-capacity admission, sharded dispatch, compact
session projections, bounded summaries and command queues, database pool
controls, and control-plane notification metrics.

## Red checkpoints

| Checkpoint | Failing evidence | Commit |
| --- | --- | --- |
| Notifications | SSE/daemon notification guarantees were absent | `32496a8` |
| Replica coordination | `workspace_response_key` was missing during collection | `4f4a229` |
| Capacity admission | Both local and database stores accepted a third two-slot request | `b4d4191` |
| Dispatch latency | The event loop blocked for ~54 ms and no per-node scope existed | `0ab18bd` |
| Snapshot amplification | Raw snapshots still contained the complete `events` array | `5419eea` |
| Summary projection | `list_session_summaries` did not exist | `0915e9f` |
| Pool/metrics controls | Pool option builder did not exist | `2feb245` |
| Queue admission | Both stores accepted commands beyond the configured node limit | `0a80f39` |
| Review regressions | Terminal SSE stopped after one bounded page; workspace replies lacked node ownership checks; node lock entries were retained | `883dfdf` |

## Green checkpoints

- Notification stage: 155 focused tests passed.
- Replica workspace stage: 139 focused tests passed.
- Dispatch/capacity stage: 129 daemon tests and 75 API tests passed.
- Compact projection stage: 38 focused tests and 233 controller/daemon/API tests passed.
- Production controls: 12 dashboard/notifier/pool tests passed.
- Queue admission: 145 daemon/workspace tests passed.
- Review regressions: 6 focused terminal-stream, response-correlation, and
  dispatch-scope tests passed.
- Re-review fixes: 215 affected tests passed, including explicit lock-order,
  cross-replica first-contact, and high-cardinality notifier churn coverage.
- Two independent final reviews reported clean after the terminal-stream,
  response-correlation, lock-order, and notifier-lifecycle fixes.

## Final verification

- `uv run --project backend --extra dev --with coverage coverage run ...`
  — 639 passed, 1 warning.
- The same 639-test suite produced 87% aggregate line
  coverage across the eight principal changed runtime modules.
- `npm run test:ts` — production build succeeded and 667 TypeScript/web tests
  passed.
- `git diff --check` — passed.
- Focused Ruff checks for the new notifier, pool configuration, session store,
  and associated tests passed. A repository-wide Ruff run still reports legacy
  findings outside this change packet.

The single Python warning is Starlette's existing `TestClient` deprecation
notice. PostgreSQL migration head verification also passed at
`20260801_0054 (head)`; live production-schema drift still requires a configured
PostgreSQL test database.
