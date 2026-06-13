# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install: `npm install` (npm workspaces).
- Build packages: `make build-packages` builds `relay-core`, `relay-daemon`, and `relay-tui` only. Full build: `npm run build`.
- Test: `npm test` (or `make test`) — runs the TypeScript suite and the Python backend suite.
- Run a single built TypeScript test file: `node --test dist/packages/relay-core/tests/handoff.test.js` (build first).
- Run the Python backend: `make backend` (default port `8790`). Serves the control panel at `/cp` and the exported web UI at `/web`.
- Run a daemon: `make daemon` (registers against `RELAY_BACKEND_URL`, polls for commands, runs agent CLIs — inside a BoxLite sandbox with `SANDBOX_MODE=boxlite`, or as local processes by default).
- Run the TUI: `make run` (or `npm run run`). `local-run` starts the backend and a BoxLite-sandboxed daemon if they are not already running, then connects the TUI (`RELAY_BACKEND_URL`, default `http://127.0.0.1:8790`).
- Run the web UI in dev mode (proxies API to the backend): `make web`.
- Run the read-only/API server: `make serve` (default port `8787`, override with `PORT=9000`).
- Rebuild + export the BoxLite devbox image: `make run-fresh`. Only needed when `dockerfile` changes.
- Stop backend + daemon + BoxLite processes: `make stop`.

The canonical TypeScript test runner is `node --test` against the built JS.

Node ≥ 22.19 is required for the TypeScript packages. Python ≥ 3.12 and `uv` are required for the backend.

## Architecture

Relay splits into a **backend** (control plane) and **daemons** (execution plane): the backend owns sessions, tasks, and the daemon registry but never executes agents; each daemon registers with the backend, owns its sandbox, and runs the Claude Code, Pi, Codex, and Kimi CLIs inside it. The backend technical stack is Python/FastAPI; the daemon, TUI, web client, and shared agent runtime remain TypeScript during the migration.

### Workspace layout

- **`relay-core`** — Shared protocol and pure helpers. `state.ts` (agent state, `AgentName`), `agents.ts` (`AGENT_REGISTRY` — the per-agent definition table), `commands.ts`/`prompts.ts` (agent CLI argv + prompt text), `nodes.ts` (registry-driven `runAgentNode` execution unit), `renderers.ts` (streaming JSONL → terminal text), `codex-review.ts` (verdict parsing, `RELAY_REVIEW_VERDICT:` marker), `guest.ts`/`env.ts` (guest auth provisioning, env/`REPO_ROOT`), `daemon-node-protocol.ts` (backend ⇄ daemon command/event types), `daemon-node-token.ts` (per-employee token file under `<workspace>/.relay/daemon-nodes/<employee>.token`), `format.ts` (ANSI helpers).
- **root `backend/`** — Python control plane. Pure backend: it queues work for daemons and never runs agent CLIs or BoxLite itself.
  - `backend/relay/app.py` — FastAPI backend (`/sandboxes`, `/daemon-nodes`, `/sessions`, `/tasks`, `/cp`, `/web`); `backend/relay/daemon.py` — daemon registry and backend scheduler; `backend/relay/stores.py` — event-sourced file-backed stores under `.relay/`; `backend/relay/controller.py` — session mutation controller; `backend/relay/cli.py` — `relay` entrypoint.
- **`relay-core` TypeScript compatibility exports** — `daemon-client.ts`, `daemon-protocol.ts`, `session-store.ts`, `task-store.ts`, `session-controller.ts`, and `routing.ts` provide protocol types, the TUI/web HTTP client, and local TUI test helpers without a separate Node backend package.
- **`relay-daemon`** — Execution plane. The daemon service that connects agents to the backend.
  - `index.ts` — Daemon loop: registers with the backend, polls for commands, runs agent CLIs, posts `run.output`/`run.completed`/`run.failed`/`run.cancelled` events back. Survives backend restarts by retrying with backoff and re-registering when a poll is rejected. Sandbox modes: `boxlite` (the daemon boots a BoxLite VM lazily on the first run, keeps it for its lifetime, and runs agents inside the guest) or `none` (agents run as local processes — for daemons that already live inside a sandbox).
  - `box.ts` / `execution.ts` / `sandbox-session.ts` — BoxLite VM setup, `BoxLiteExecutionManager`, `startOrchestratorSession`/`withOrchestratorSession`, agent readiness preflight (`ensureAgentReady`).
- **`relay-tui`** — Ink TUI (`tui.tsx`). Owns input parsing (`@claude`/`@pi`/`@codex`/`@kimi` mentions, `/approve` `/reject` `/cancel` `/rerun` `/handoff` `/sessions` `/open` `/summary` `/quit`), shortcut completion, transcript rendering. `RelayTuiHost` provisions a sandbox via `RelayDaemonClient` and runs assignments through the backend (`createDaemonAssignmentRunner`), polling session events for output. `local-run.ts` boots backend + daemon + TUI for `make run`.
- **root `web/`** — Next.js web UI (`basePath: /web`, static export served by the backend at `/web`; dev mode proxies API routes to the backend).

### Backend / daemon / client token contract

- The per-employee token lives at `<workspace>/.relay/daemon-nodes/<employee>.token` (created by whichever side starts first via `ensureDaemonNodeToken`); `RELAY_DAEMON_TOKEN` overrides it (`RELAY_DAEMON_NODE_TOKEN` is the accepted legacy name). The backend stores only a SHA-256 hash; a fresh provision returns the plaintext exactly once.
- Re-registering a sandbox with a different token is rejected (401) — registration cannot rotate or hijack tokens.
- An authorized command poll revives a `stopped`/`failed` daemon record to `ready` (covers backend restarts); provisioning by employee prefers the live daemon over offline placeholders.
- Wire routes (`/daemon-nodes/...`) and on-disk paths keep the historical `daemon-node` names for compatibility.

### Key invariants

- **The backend never executes agents.** All agent execution flows through daemon commands (`ServerDaemonNodeBackend.run` → registry queue → daemon poll). Do not reintroduce in-process execution paths into the Python backend.
- **Sessions and tasks carry an owner.** `RelaySession.ownerEmployeeId` / `RelayTask.ownerEmployeeId` (set from the `session.created` / `task.created` events) attribute work to the employee whose agent runs it; `HumanDecision.actorEmployeeId` records who approved/rejected/handed off. `ServerDaemonNodeBackend.run` threads the sandbox's `employeeId` into the owner, and `assertSessionOwnedByEmployee` is the authorization seam — an employee's agent may only act on sessions its employee owns (ownerless legacy sessions are allowed). This is where the future task-scope / tool-policy / approval checks belong; keep it the single checkpoint rather than scattering ownership checks.
- **Event log is authoritative.** All session/task state changes go through `SessionStore.appendEvent` / `TaskStore.appendEvent`. Snapshots are derived. Never mutate snapshot fields directly outside the store's replay.
- **Immutability.** Session/task mutations return new objects (`mergeAgentState`, spread updates). Existing pattern; preserve it.
- **One controller per assignment flow.** The TUI creates a fresh `SessionController` per task; the controller owns the active session id and the `AgentEventSink` wiring back to the store.
- **TUI default-workflow is bypassed.** TUI assignments use `runStep` directly via `runAssignments`; the routing handoff narration (`routing.ts`) only fires in `relay run-workflow`.
- **Pi CLI version skew.** Pi versions differ — use `-P` only when `pi --help` advertises `-P`/`--print-streaming`, otherwise `-p`. `commands.ts` already handles this; keep both paths working.
- **Agent identity is registry-driven.** Four agents are recognized: `claude`, `pi`, `codex`, `kimi` (`AgentName` in `relay-core/src/state.ts`). The single source of truth is `AGENT_REGISTRY` in `relay-core/src/agents.ts` — command builder, renderer, preflight, failure budget, capabilities (only `codex` has `review`), role, and guest-auth flag. Dispatch sites use `getAgent`/`AGENT_NAMES`/`isAgentName` instead of literal switches, and per-agent failure counts live in `AgentState.agent_failures` (use `failureCount`/`withFailure`). Adding an agent = one `AGENT_REGISTRY` entry plus its CLI specifics: a command builder in `commands.ts`, a prompt in `prompts.ts`, any guest-auth file writes in the daemon (`relay-daemon/src/index.ts` `ensureHostAgentReady` + `box.ts`), and — because the web app cannot import the node-only registry — mirror the agent in `App.tsx`/`MessageBlock.tsx` literals and the `agent.<name>` i18n keys (the `Record<AgentName, …>` types enforce this). The default workflow stays Claude → Pi → Codex; extra agents are invoked via `@mention`/explicit assignment only. Kimi's CLI flags in `buildKimiImplementCommand` are provisional — confirm against the installed Kimi CLI.
- **`ensureAgentReady` is silent on success.** Preflight failures throw; do not re-add success narration — the TUI footer carries readiness state.
- **Never print raw JSONL.** Rendering is block-based: one `●` marker per agent turn, `○` + dim italic for thinking/reasoning, `⏺` for tool/command lines.

### Data layout

Generated state lives under `.relay/` (repo root by default — `DEFAULT_RELAY_DATA_DIR` — for backend stores; the host workspace for daemon tokens/logs):

```
.relay/sessions/<session-id>/events.jsonl     # append-only event log (source of truth)
.relay/sessions/<session-id>/snapshot.json    # materialized view
.relay/sessions/<session-id>/artifacts/*.txt  # captured agent output
.relay/tasks/<task-id>/{events.jsonl,snapshot.json}
.relay/daemon/{nodes,commands,runs,events}/   # persisted daemon registry state
<workspace>/.relay/daemon-nodes/<employee>.token   # shared daemon auth token
<workspace>/.relay/daemon-nodes/logs/*.jsonl       # daemon structured logs
```

The host workspace mounts into the BoxLite guest at `/workspace` (`GUEST_WORKSPACE`); the guest `agent` user's UID/GID is aligned to the host owner so file ownership stays sane.

### Testing

- `backend/tests/` — Python controller, event store behavior, HTTP API, backend + daemon registry (auth, persistence, revival, cancellation).
- `packages/relay-core/tests/handoff.test.ts` — routing, prompt construction, stream rendering. Must continue to prove no raw JSONL leaks through and that Codex review verdict parsing is correct.
- `packages/relay-tui/tests/tui.test.tsx` — Ink rendering via `ink-testing-library`. Frame assertions are sensitive to header/footer text — when changing TUI chrome, update assertions deliberately, not reflexively.
- `web/tests/status.test.ts` — web daemon-node status derivation and local-node claiming behavior.

Tests use Node's built-in `node:test` runner with `describe`/`it`; a vitest pass over the same files surfaces a spurious "No test suite found" line but real assertions are reported correctly under either runner.
