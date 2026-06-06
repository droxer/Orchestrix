# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install: `npm install`
- Build: `npm run build` (or `make build`) — runs `tsc -p tsconfig.json` to `dist/`.
- Test: `npm test` (or `make test`) — builds first, then runs `node --test dist/tests/*.test.js`.
- Run a single test file: `node --test dist/tests/handoff.test.js` (build first).
- Run the TUI: `make run` (or `npm run run`). Optionally `make run WORKSPACE=/path/to/workspace`.
- Run the read-only API server: `make serve` (default port `8787`, override with `PORT=9000`).
- Rebuild + export the BoxLite devbox image: `make run-fresh`. Only needed when `dockerfile` changes — normal source edits use `make run`.
- Stop orchestrator + BoxLite processes: `make stop` (kills `relay`/`boxlite-shim`, clears `~/.boxlite/.lock`).

Vitest is also configured locally for ad-hoc runs (`npx vitest run tests/`), but the canonical test runner is `node --test` against the built JS.

Node ≥ 22.19 is required.

## Architecture

Relay is a **local-first orchestration control plane** that lets a human and the Claude Code, Pi, and Codex CLIs collaborate inside one isolated BoxLite VM. The host process is TypeScript-only — **do not add Python host code**.

### Layered structure (`src/`)

- **`index.ts`** — CLI entrypoint. Routes `relay`, `relay run-workflow`, `relay sessions`, `relay show`, `relay serve` to the right module.
- **`tui.tsx`** — Ink-based TUI. Owns input parsing (`@claude`/`@pi`/`@codex` mentions, `/approve` `/reject` `/cancel` `/rerun` `/handoff` `/sessions` `/open` `/summary` `/quit`), shortcut completion, transcript rendering, and translates user intent into `SessionController` calls.
- **`relay.ts`** — Re-export surface; everything the TUI and tests touch flows through here.
- **`relay/`** — Implementation modules:
  - `workflow.ts` — VM lifecycle (`withOrchestratorSession`), agent readiness preflight (`ensureAgentReady`), and the default Claude → Pi → Codex pipeline.
  - `controller.ts` — `SessionController`: the only object that mutates sessions. Each `runStep` emits `agent.started` / `artifact.created` / `agent.completed` / `review.verdict` events through the store and notifies the TUI via `onUpdate`.
  - `session.ts` / `task.ts` — Event-sourced stores. The JSONL event log under `.relay/sessions/<id>/events.jsonl` is the source of truth; `snapshot.json` is a materialized cache rebuilt by replaying events. Same pattern for `.relay/tasks/`.
  - `nodes.ts` — Single-agent execution units (`claudeImplementNode`, `piImplementNode`, `codexImplementNode`, `codexReviewNode`). Each one runs the agent CLI in BoxLite via `execStream`, pipes stdout/stderr through the renderers, and reports back to the controller's event sink.
  - `commands.ts` / `prompts.ts` — Build the actual shell argv and prompt text for each agent + mode.
  - `routing.ts` — Default-workflow transition function (`routeClaudeHandoff` / `routePiHandoff` / `routeCodexHandoff`) used only by `runWorkflow`. TUI assignments do not go through this.
  - `box.ts` / `guest.ts` / `env.ts` — BoxLite VM setup, guest-side auth provisioning, env loading.
  - `renderers.ts` — Streaming JSONL → terminal text converters. `ClaudeStreamRenderer` consumes `--output-format stream-json`; `CodexStreamRenderer` consumes `exec --json`. Rendering is block-based: one `●` marker per agent turn, `○` + dim italic for thinking/reasoning, `⏺` for tool/command lines, continuation lines indent 2 spaces. **Never print raw JSONL.**
  - `format.ts` — ANSI helpers (`color`, `status`, `section`, `keyValue`). Colors are TTY-gated.
  - `server.ts` — Read-only HTTP/SSE API. Reads only real files under `.relay/`; never mocks or seeds.

### Key invariants

- **Event log is authoritative.** All session/task state changes go through `SessionStore.appendEvent` / `TaskStore.appendEvent`. Snapshots are derived. Never mutate snapshot fields directly outside the store's `replay()`.
- **Immutability.** Session/task mutations return new objects (`mergeAgentState`, spread updates). Existing pattern; preserve it.
- **One controller per assignment flow.** The TUI creates a fresh `SessionController` per task; the controller owns the active session id and the `AgentEventSink` wiring back to the store.
- **TUI default-workflow is bypassed.** TUI assignments use `runStep` directly via `runAssignments` in `tui.tsx`; the routing handoff narration (`routing.ts`) only fires in `relay run-workflow`.
- **Pi CLI version skew.** Pi versions differ — use `-P` only when `pi --help` advertises `-P`/`--print-streaming`, otherwise `-p`. `commands.ts` already handles this; keep both paths working.
- **Agent identity.** Currently three agents are recognized everywhere: `claude`, `pi`, `codex` (`AgentName` in `state.ts`). Adding an agent means touching parsing in `tui.tsx`, validation in `controller.ts`/`routing.ts`, command builders, prompts, and renderers.
- **`ensureAgentReady` is silent on success.** Preflight failures throw; do not re-add success narration — the TUI footer carries readiness state.

### Data layout

Generated state lives under `.relay/` in the host workspace:

```
.relay/sessions/<session-id>/events.jsonl     # append-only event log (source of truth)
.relay/sessions/<session-id>/snapshot.json    # materialized view
.relay/sessions/<session-id>/artifacts/*.txt  # captured agent output
.relay/tasks/<task-id>/{events.jsonl,snapshot.json}
```

The host workspace mounts into the BoxLite guest at `/workspace` (`GUEST_WORKSPACE`); the guest `agent` user's UID/GID is aligned to the host owner so file ownership stays sane.

### Testing

- `tests/handoff.test.ts` — routing, prompt construction, stream rendering. Must continue to prove no raw JSONL leaks through and that Codex review verdict parsing is correct.
- `tests/session.test.ts` — controller + event store behavior, HTTP API.
- `tests/tui.test.tsx` — Ink rendering via `ink-testing-library`. Frame assertions are sensitive to header/footer text — when changing TUI chrome, update assertions deliberately, not reflexively.

Tests use Node's built-in `node:test` runner with `describe`/`it`; a vitest pass over the same files surfaces a spurious "No test suite found" line but real assertions are reported correctly under either runner.
