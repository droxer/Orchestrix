# Relay

<p align="center">
  <img src="assets/brand/relay-logo.svg" alt="Relay logo" width="380">
</p>

Every Employee. Amplified.

Relay is an AI Workforce Intelligence Platform. Its product direction is to give
every employee a long-term AI Partner that connects organizational knowledge,
business workflows, tools, and agent execution so people can create value faster.

This repository contains the current local-first developer MVP: a TypeScript
CLI/TUI that orchestrates Claude Code, Pi, and Codex inside an isolated BoxLite
workspace, persists task/session history under `.relay/`, and exposes a local
read-only JSON/SSE API.

Relay is not designed as a chatbot plus tool calls, and it is not an employee
replacement system. The architecture is control-plane-first: Relay owns task
identity, workflow state, approval gates, audit trails, memory writeback,
sandbox lifecycle, and tool policy while agent CLIs act as execution engines.

## Documentation Map

- [Product Design](docs/Product-Design.md): product strategy, users, scenarios,
  positioning, roadmap, and business model.
- [Architecture Design](docs/Architecture-Design.md): target architecture,
  planes, runtime layers, sandbox strategy, MCP gateway, memory, and governance.
- [Technical Implementation Design](docs/Technical-Implementation-Design.md):
  deployable components, data model, APIs, runtime flows, security,
  observability, implementation phases, and current local implementation map.
- [Visual Design](docs/Design.md): marketing/UI design language and visual
  system direction.
- [Brand Assets](assets/brand/README.md): logo files, usage notes, and color
  tokens.

## Product Direction

Relay's long-term product has three forms:

- **Personal Relay:** an AI Partner for each employee, with personal work
  assistance, knowledge assistance, task execution, and personal memory.
- **Team Relay:** team status, cross-person collaboration, project risks, and
  shared best practices.
- **Organization Relay:** organizational knowledge, expert experience assets,
  capability graphs, governance analytics, and memory writeback.

Initial high-value scenarios include sales value creation, customer success and
renewal growth, product and engineering collaboration, organizational knowledge
assistance, and expert experience capture.

## Current Local MVP

The current repository implements a local developer channel for engineering
collaboration:

- **Durable tasks and sessions:** append-only event logs and derived snapshots
  under `.relay/tasks` and `.relay/sessions`.
- **Human approval gates:** TUI assignments create pending sessions that can be
  approved, rejected, cancelled, rerun, opened, or summarized.
- **Multi-agent orchestration:** Claude, Pi, and Codex run as CLI agents inside
  BoxLite.
- **Readable streams:** Claude `stream-json` and Codex `exec --json` output are
  rendered into human-readable terminal text instead of raw JSONL.
- **Artifacts:** command output, assignment plans, logs, and review output are
  persisted with the session.
- **Local API:** `relay serve` exposes real task/session state from `.relay/`.

The scripted default workflow is:

```text
Claude implement -> Pi implement/test follow-up -> Codex review
```

Codex review must emit:

```text
RELAY_REVIEW_VERDICT: APPROVED
```

or:

```text
RELAY_REVIEW_VERDICT: REJECTED
```

## Target Architecture

The target system is organized around four architectural planes:

- **Control Plane:** tenants, users, workspaces, tasks, sessions, assignments,
  approvals, policy decisions, workflow state, and audit authority.
- **Execution Plane:** sandboxed commands, agent CLIs, file processing, browser
  automation, stream forwarding, and isolated tool adapters.
- **Memory Plane:** personal, task, project, team, and organization memory,
  retrieval, source links, indexing, and reviewed writeback.
- **Governance Plane:** identity, permissions, audit, retention, tool policy,
  approval rules, and compliance controls.

The recommended enterprise stack includes a web/API control plane, PostgreSQL,
Redis, Temporal, Relay Runtime, BoxLite/Kubernetes sandbox workers, MCP Gateway,
Secret Broker, object storage, and vector/search storage as needed.

The current local MVP intentionally keeps persistence file-backed under
`.relay/`, but the event model is meant to map cleanly to PostgreSQL later.

## Prerequisites

- Node.js 22.19 or newer
- npm
- Docker with the local daemon running
- Hardware virtualization for BoxLite
- API keys for the agents you plan to run

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

Do not put long-lived secrets into prompts, events, artifacts, or memory.

## Setup

Install dependencies and run the test suite:

```bash
npm install
npm test
```

Build and export the BoxLite devbox image:

```bash
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
make run
# or
npm run run
```

Assign agents from the TUI:

```text
@claude fix auth middleware
@claude @pi @codex add tests for upload routing
@codex inspect the current diff
```

Useful slash commands:

```text
/approve
/reject missing tests around timeout handling
/cancel
/rerun codex
/handoff claude
/sessions
/open <session-id>
/summary
/quit
```

Run the scripted workflow:

```bash
relay run-workflow "fix auth middleware"
```

List and inspect sessions:

```bash
relay sessions
relay show <session-id>
```

Stop Relay and BoxLite processes:

```bash
make stop
```

## Local API

Start the local JSON/SSE API:

```bash
make serve
# or choose a port:
make serve PORT=9000
```

By default, the server listens on `127.0.0.1:8787`. It reads real task and
session files from `.relay/tasks` and `.relay/sessions`; it does not seed,
mock, or display dummy work.

Current routes include:

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

The local API can create tasks, create pending sessions, attach assignment-plan
artifacts, record decisions, and expose historical events/artifacts. Agent CLI
execution still runs through the orchestrator/TUI path so BoxLite lifecycle,
credentials, readiness checks, streaming, and cancellation stay centralized.

## Data Layout

Relay writes local generated state under `.relay/`:

```text
.relay/
  tasks/
    <task-id>/
      events.jsonl
      snapshot.json
  sessions/
    <session-id>/
      events.jsonl
      snapshot.json
      artifacts/
        <artifact-id>.<ext>
```

The event log is the source of truth. The snapshot is a materialized view rebuilt
from events.

## Source Map

```text
packages/relay-daemon/src/cli.ts              compatibility CLI entrypoint
packages/relay-daemon/src/daemon-cli.ts       host daemon binary entrypoint
packages/relay-core/src/index.ts              shared protocol and agent runtime exports
packages/relay-daemon-node/src/cli.ts          daemon node binary entrypoint
packages/relay-daemon-node/src/index.ts        sandbox-side daemon node runtime
packages/relay-daemon/src/index.ts            public daemon re-export surface
packages/relay-daemon/src/relay/controller.ts session-aware orchestration controller
packages/relay-daemon/src/relay/session.ts    durable session event model and local store
packages/relay-daemon/src/relay/task.ts       backlog/task event model and local store
packages/relay-core/src/nodes.ts      Claude, Pi, and Codex execution nodes
packages/relay-core/src/commands.ts   agent command builders
packages/relay-core/src/prompts.ts    agent prompt builders
packages/relay-core/src/renderers.ts  stream-json and JSONL renderers
packages/relay-daemon/src/relay/routing.ts    default workflow routing
packages/relay-daemon/src/relay/workflow.ts   BoxLite lifecycle and runtime entrypoints
packages/relay-daemon/src/relay/server.ts     local JSON/SSE API
packages/relay-tui/src/cli.ts                 TUI binary entrypoint
packages/relay-tui/src/tui.tsx                Ink TUI and human commands
```

Keep new daemon public API exports in `packages/relay-daemon/src/index.ts`.
Keep runtime dispatch in `packages/relay-daemon/src/relay/workflow.ts`; package
binary wrappers should stay minimal.

## Development

```bash
npm run build
npm test
make test
```

Test coverage is organized as:

- `tests/session.test.ts`: event stores, artifacts, controller behavior, linked
  task updates, and HTTP API routes.
- `tests/handoff.test.ts`: routing, prompt contracts, Codex verdict parsing,
  command generation, stream renderers, and BoxLite helpers.
- `tests/tui.test.tsx`: TUI parsing, shortcuts, rendering, cancellation,
  session state updates, and slash commands.

For behavior changes, add or update focused tests and run `npm test`.

## Implementation Rules

- Keep the host orchestrator in TypeScript/Node.js. Do not add Python host code.
- Use BoxLite's Node SDK (`@boxlite-ai/boxlite`) for VM lifecycle and command
  execution.
- Keep durable state append-only; add events instead of mutating history.
- Keep snapshots derived from event logs.
- Keep tasks and sessions loosely coupled through `task.session_linked`.
- Keep API state real: no seeded demo tasks, fake agent runs, or dummy artifacts.
- Keep agent execution isolated to `nodes.ts`, command construction to
  `commands.ts`, and workflow lifecycle to `workflow.ts` / `box.ts`.
- Route future execution endpoints through `SessionController` and the same
  orchestrator readiness flow used by the CLI/TUI.
- Claude uses `--output-format stream-json`; Codex uses `exec --json`; render
  both through the stream renderers instead of printing raw JSON.
- Pi versions differ: use `-P` only when `pi --help` advertises `-P` or
  `--print-streaming`; otherwise fall back to `-p`.

## Roadmap

The technical implementation plan phases are:

1. **Local Relay hardening:** stabilize TypeScript orchestration, BoxLite
   lifecycle, event stores, command redaction, and artifacts.
2. **Execution service boundary:** extract `ExecutionManager` interfaces while
   keeping control-plane authority outside the sandbox.
3. **Durable backend:** move `.relay` stores to PostgreSQL-backed repositories
   with Redis fanout and object storage.
4. **Temporal runtime:** add durable workflow state machines, approval waits,
   cancellation signals, retries, and resumable sessions.
5. **MCP Gateway and governance:** add Tool Registry, Policy Engine, Secret
   Broker, audit, and approval gates for high-risk writes.
6. **Memory plane:** add retrieval, memory candidate extraction, reviewed
   writeback, vector indexing, and keyword search.
7. **Enterprise readiness:** tenant policies, audit export, retention controls,
   admin UI, private deployment, and sandbox tiering across BoxLite,
   Kubernetes/gVisor, E2B/Kata, and Cloud Workstations.
