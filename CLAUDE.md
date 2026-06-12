# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install: `npm install` (npm workspaces).
- Build: `npm run build` (or `make build`) — builds `relay-core` → `relay-backend` → `relay-tui` → `relay-web`, then compiles `tests/` via the root `tsconfig.json` to `dist/`.
- Test: `npm test` (or `make test`) — builds first, then runs `node --test dist/tests/*.test.js`.
- Run a single test file: `node --test dist/tests/handoff.test.js` (build first).
- Run the host daemon: `make backend` (default port `8790`). Serves the control panel at `/control` and the exported web UI at `/web`.
- Run a daemon node: `make daemon` (registers against `RELAY_BACKEND_URL`, polls for commands, executes agent CLIs locally).
- Run the TUI: `make run` (or `npm run run`). The TUI connects to the daemon (`RELAY_BACKEND_URL`, default `http://127.0.0.1:8790`).
- Run daemon + daemon node + TUI together with a shared token: `make run-with-daemon`.
- Run the web UI in dev mode (proxies API to the daemon): `make web`.
- Run the read-only API server: `make serve` (default port `8787`, override with `PORT=9000`).
- Rebuild + export the BoxLite devbox image: `make run-fresh`. Only needed when `dockerfile` changes.
- Stop orchestrator + BoxLite processes: `make stop`.

Vitest is also configured locally for ad-hoc runs (`npx vitest run tests/`), but the canonical test runner is `node --test` against the built JS.

Node ≥ 22.19 is required.

## Architecture

Relay is a **local-first orchestration control plane** that lets a human and the Claude Code, Pi, and Codex CLIs collaborate inside isolated sandboxes. The host process is TypeScript-only — **do not add Python host code**.

### Workspace layout (`packages/`)

- **`relay-core`** — Shared protocol and pure helpers. `state.ts` (agent state, `AgentName`), `commands.ts`/`prompts.ts` (agent CLI argv + prompt text), `nodes.ts` (single-agent execution units), `renderers.ts` (streaming JSONL → terminal text), `codex-review.ts` (verdict parsing, `RELAY_REVIEW_VERDICT:` marker), `guest.ts`/`env.ts` (guest auth provisioning, env/`REPO_ROOT`), `daemon-node-protocol.ts` (daemon ⇄ daemon-node command/event types), `daemon-node-token.ts` (per-employee token file under `<workspace>/.relay/daemon-nodes/<employee>.token`), `format.ts` (ANSI helpers).
- **`relay-backend`** — Host daemon and daemon-node runtime.
  - `relay/daemon.ts` — HTTP daemon (`/sandboxes`, `/daemon-nodes`, `/sessions`, `/control`, `/web`), `DaemonNodeRegistry`, `ServerDaemonNodeBackend` (queues `run.start`/`run.cancel` commands for polling nodes), `LocalDaemonStore` (persisted nodes/commands/runs under `.relay/daemon/`).
  - `daemon-node/index.ts` — Daemon node loop: registers with the daemon, polls for commands, runs agent CLIs as local processes, posts `run.output`/`run.completed`/`run.failed`/`run.cancelled` events back. Survives daemon restarts by retrying with backoff and re-registering when a poll is rejected.
  - `relay/daemon-client.ts` — `RelayDaemonClient` used by the TUI; adopts the one-time plaintext token returned by a fresh provision.
  - `relay/session.ts` / `relay/task.ts` — Event-sourced stores. JSONL event log is the source of truth; `snapshot.json` is a materialized cache.
  - `relay/controller.ts` — `SessionController`: the only object that mutates sessions. Each `runStep` emits `agent.started` / `artifact.created` / `agent.completed` / `review.verdict` events.
  - `relay/server.ts` — Session/task HTTP API (also mounted by the daemon under `/sessions` and `/tasks`).
  - `relay/workflow.ts` — CLI entrypoint (`relay daemon|serve|sessions|show|run-workflow`), BoxLite VM lifecycle (`withOrchestratorSession`), agent readiness preflight (`ensureAgentReady`).
  - `relay/box.ts` — BoxLite VM setup; `relay/routing.ts` — default-workflow handoff transitions (only used by `run-workflow`).
- **`relay-tui`** — Ink TUI (`tui.tsx`). Owns input parsing (`@claude`/`@pi`/`@codex` mentions, `/approve` `/reject` `/cancel` `/rerun` `/handoff` `/sessions` `/open` `/summary` `/quit`), shortcut completion, transcript rendering. `RelayTuiHost` provisions a sandbox via `RelayDaemonClient` and runs assignments through the daemon (`createDaemonAssignmentRunner`), polling session events for output.
- **`relay-web`** — Next.js web UI (`basePath: /web`, static export served by the daemon at `/web`; dev mode proxies API routes to the daemon).

### Daemon / daemon-node / client token contract

- The per-employee token lives at `<workspace>/.relay/daemon-nodes/<employee>.token` (created by whichever side starts first via `ensureDaemonNodeToken`); `RELAY_DAEMON_TOKEN` overrides it. The daemon stores only a SHA-256 hash; a fresh provision returns the plaintext exactly once.
- Re-registering a sandbox with a different token is rejected (401) — registration cannot rotate or hijack tokens.
- An authorized command poll revives a `stopped`/`failed` node record to `ready` (covers daemon restarts); provisioning by employee prefers the live node over offline placeholders.

### Key invariants

- **Event log is authoritative.** All session/task state changes go through `SessionStore.appendEvent` / `TaskStore.appendEvent`. Snapshots are derived. Never mutate snapshot fields directly outside the store's replay.
- **Immutability.** Session/task mutations return new objects (`mergeAgentState`, spread updates). Existing pattern; preserve it.
- **One controller per assignment flow.** The TUI creates a fresh `SessionController` per task; the controller owns the active session id and the `AgentEventSink` wiring back to the store.
- **TUI default-workflow is bypassed.** TUI assignments use `runStep` directly via `runAssignments`; the routing handoff narration (`routing.ts`) only fires in `relay run-workflow`.
- **Pi CLI version skew.** Pi versions differ — use `-P` only when `pi --help` advertises `-P`/`--print-streaming`, otherwise `-p`. `commands.ts` already handles this; keep both paths working.
- **Agent identity.** Currently three agents are recognized everywhere: `claude`, `pi`, `codex` (`AgentName` in `relay-core/src/state.ts`). Adding an agent means touching parsing in `tui.tsx`, validation in `controller.ts`/`routing.ts`, command builders, prompts, and renderers.
- **`ensureAgentReady` is silent on success.** Preflight failures throw; do not re-add success narration — the TUI footer carries readiness state.
- **Never print raw JSONL.** Rendering is block-based: one `●` marker per agent turn, `○` + dim italic for thinking/reasoning, `⏺` for tool/command lines.

### Data layout

Generated state lives under `.relay/` (repo root by default — `DEFAULT_RELAY_DATA_DIR` — for daemon stores; the host workspace for daemon-node tokens/logs):

```
.relay/sessions/<session-id>/events.jsonl     # append-only event log (source of truth)
.relay/sessions/<session-id>/snapshot.json    # materialized view
.relay/sessions/<session-id>/artifacts/*.txt  # captured agent output
.relay/tasks/<task-id>/{events.jsonl,snapshot.json}
.relay/daemon/{nodes,commands,runs,events}/   # persisted daemon-node registry state
<workspace>/.relay/daemon-nodes/<employee>.token   # shared daemon-node auth token
<workspace>/.relay/daemon-nodes/logs/*.jsonl       # daemon-node structured logs
```

The host workspace mounts into the BoxLite guest at `/workspace` (`GUEST_WORKSPACE`); the guest `agent` user's UID/GID is aligned to the host owner so file ownership stays sane.

### Testing

- `tests/handoff.test.ts` — routing, prompt construction, stream rendering. Must continue to prove no raw JSONL leaks through and that Codex review verdict parsing is correct.
- `tests/session.test.ts` — controller + event store behavior, HTTP API, daemon + daemon-node registry (auth, persistence, revival, cancellation).
- `tests/tui.test.tsx` — Ink rendering via `ink-testing-library`. Frame assertions are sensitive to header/footer text — when changing TUI chrome, update assertions deliberately, not reflexively.

Tests use Node's built-in `node:test` runner with `describe`/`it`; a vitest pass over the same files surfaces a spurious "No test suite found" line but real assertions are reported correctly under either runner.
