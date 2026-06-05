# Relay: Human and AI Agent Collaboration Platform

Relay is a local-first collaboration control plane for small software teams working with autonomous coding agents. Humans, Claude Code, Pi, and Codex share one isolated BoxLite workspace, while Relay records each assignment as a durable session with structured events, artifacts, decisions, and review outcomes.

The goal is not to hide the terminal. Relay keeps agent streams readable while turning the work into a traceable timeline that can be inspected later from the TUI, CLI commands, or the read-only HTTP/SSE API.

## What Relay Provides

- **Durable collaboration sessions:** every run writes `.relay/sessions/<session-id>/events.jsonl`, `snapshot.json`, and artifact files.
- **Explicit human gates:** TUI assignments create a pending session first; `/approve`, `/reject`, `/cancel`, `/rerun`, and `/summary` record human decisions.
- **Bring your own agents:** Relay orchestrates Claude Code, Pi, and Codex CLI agents through the existing local toolchain.
- **Shared isolated workspace:** BoxLite mounts the host workspace at `/workspace` and aligns the guest `agent` UID/GID with the host owner.
- **Structured agent roles:** agents can act as implementers, reviewers, testers, planners, or fixers; v1 maps Claude to implementation, Pi to testing/follow-up, and Codex to implementation or review.
- **Readable streams plus artifacts:** Claude and Codex JSONL streams render as terminal text and are also captured as session events and command-log artifacts.
- **Web-ready service boundary:** `relay serve` exposes read-only session, artifact, and SSE event endpoints without adding a database.

## Prerequisites

1. Node.js 22.19+
2. npm
3. Docker, with the local daemon running
4. Hardware virtualization for BoxLite
5. API keys for the agents you plan to run

Set credentials in `.env`:

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OPENAI_BASE_URL=...     # optional compatible endpoint
OPENAI_MODEL=...        # optional
PI_API_KEY=...          # optional override
PI_BASE_URL=...         # optional override
PI_MODEL=...            # optional override
```

## Setup

```bash
npm install
npm test
make devbox-oci
```

You only need to rebuild/export the devbox image when `dockerfile` changes:

```bash
make run-fresh
```

Normal source changes only need:

```bash
make run
```

To mount a specific host workspace into the Relay devbox:

```bash
make run WORKSPACE=/path/to/workspace
```

## Running Relay

Start the TUI:

```bash
relay
# or
npm run run
```

Create a session by assigning agents:

```text
@claude fix auth middleware
@claude @pi @codex add tests for upload routing
@codex inspect the current diff
```

Relay creates a pending session. Use slash commands to control it:

```text
/approve
/reject missing tests around timeout handling
/cancel
/rerun codex
/sessions
/open <session-id>
/summary
```

The scripted workflow is still available and now creates a durable session:

```bash
relay run-workflow "fix auth middleware"
```

List and inspect sessions:

```bash
relay sessions
relay show <session-id>
```

Start the local HTTP API server:

```bash
make serve
# or choose a port:
make serve PORT=9000
```

Relay no longer serves a browser UI. `http://127.0.0.1:8787` returns a JSON API index, and task/session management is available through the HTTP endpoints.

The API reads only real Relay task and session files from `.relay/tasks` and `.relay/sessions`. It does not seed, mock, or display dummy work.

Task-management state is file-backed. Agent CLI execution still runs through the Relay orchestrator/TUI path so BoxLite lifecycle, credentials, readiness checks, streaming, and cancellation stay in one place.

The server exposes:

```text
GET /
GET /tasks
POST /tasks
GET /tasks/:id
PATCH /tasks/:id
POST /tasks/:id/assign
POST /tasks/:id/pickup
GET /tasks/:id/events
GET /sessions
GET /sessions/:id
GET /sessions/:id/events
GET /sessions/:id/artifacts/:artifactId
```

## Data Layout

Relay writes local generated state under `.relay/`:

```text
.relay/sessions/<session-id>/events.jsonl
.relay/sessions/<session-id>/snapshot.json
.relay/sessions/<session-id>/artifacts/<artifact-id>.txt
.relay/tasks/<task-id>/events.jsonl
.relay/tasks/<task-id>/snapshot.json
```

The event log is the source of truth. The snapshot is a materialized view for fast reads.

## Development

```bash
npm run build
npm test
make test
```

Important source areas:

```text
src/relay/session.ts      durable session event model and local store
src/relay/task.ts         backlog/Kanban task event model and local store
src/relay/controller.ts   session-aware orchestration controller
src/relay/workflow.ts     BoxLite lifecycle and CLI commands
src/tui.tsx               Ink TUI and human commands
src/relay/server.ts       read-only HTTP/SSE API
```

Keep the host orchestrator in TypeScript. Do not add Python host code.
