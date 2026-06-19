# Relay

<p align="center">
  <img src="assets/brand/relay-logo.svg" alt="Relay logo" width="380">
</p>

Every Employee. Amplified.

Relay is an AI Workforce Intelligence Platform. The long-term product direction
is to give every employee an AI partner that connects organizational knowledge,
business workflows, tools, and agent execution.

This repository contains the current local-first developer MVP. It has a
Python/FastAPI backend control plane, TypeScript daemon and TUI clients, a
Next.js web UI, local event-sourced state under `.relay/`, and BoxLite-backed
agent execution.

## Current MVP

- Durable tasks, sessions, events, snapshots, and artifacts under `.relay/`.
- Human approval and handoff flows through the TUI.
- Daemon-based execution for Claude, Pi, Codex, and Kimi agent CLIs.
- Readable rendering for Claude stream JSON and Codex JSONL output.
- Token usage tracking across sessions and agents.
- Local HTTP APIs for tasks, sessions, daemon nodes, sandboxes, the control
  panel, and the exported web UI.
- Admin console with dashboard (KPI tiles, fleet health, token usage charts,
  activity feed), node management, and user/department CRUD.
- Provider-neutral chat gateway (`relay-chat`) with Discord, Telegram, and
  Lark adapters.

Relay is control-plane-first: the backend owns task identity, workflow state,
approval gates, audit trails, daemon coordination, and policy boundaries. Agent
CLIs remain execution engines and run through daemons, not inside the backend.

## Quick Start

```bash
npm install
npm test
make run
```

Common commands:

```bash
make backend        # Python backend on port 8790
make daemon         # TypeScript daemon connected to the backend
make run            # local TUI flow
make web            # Next.js web UI in dev mode
make serve          # backend/server mode on port 8787
make backend-migrate  # run Alembic database migrations
make stop           # stop backend, daemon, TUI, and BoxLite processes
```

For full setup, environment variables, BoxLite devbox export, local API routes,
data layout, and test organization, see
[Local Development](docs/local-development.md).

## Documentation

- [Local Development](docs/local-development.md): setup, commands, environment,
  local services, data layout, source map, and tests.
- [Product Design](docs/product.md): product strategy, users, scenarios,
  positioning, roadmap, and business model.
- [Architecture Design](docs/system-architecture.md): target architecture,
  planes, runtime layers, sandbox strategy, MCP gateway, memory, and governance.
- [Technical Implementation Design](docs/implementation-plan.md): deployable
  components, data model, APIs, runtime flows, security, observability,
  implementation phases, and current local implementation map.
- [Chat Integrations](docs/chat-integrations.md): Discord, Telegram, and Lark
  adapter architecture, identity mapping, commands, security, and rollout.
- [Architecture Decision Records](docs/adr/README.md): accepted technical
  decisions for governance, sandboxing, and control-plane boundaries.
- [Visual Design](docs/design-system.md): marketing/UI design language and
  visual system direction.
- [Brand Assets](assets/brand/README.md): logo files, usage notes, and color
  tokens.

## Architecture Snapshot

Relay is split into a control plane and an execution plane.

- `backend/`: Python/FastAPI backend, event stores, session controller, daemon
  registry, HTTP routes split by domain (`api/admin_routes.py`,
  `api/daemon_node_routes.py`, `api/session_routes.py`, etc.), and Alembic
  migrations.
- `packages/relay-core/`: shared TypeScript protocol, command builders,
  prompts, renderers, token-usage normalization, and compatibility client
  exports.
- `packages/relay-chat/`: provider-neutral chat gateway; Discord, Telegram,
  and Lark adapters.
- `packages/relay-daemon/`: TypeScript daemon runtime, BoxLite integration, and
  agent process execution.
- `packages/relay-tui/`: Ink-based terminal UI.
- `web/`: Next.js web UI served at `/web`, including the admin console and
  dashboard.

The current local MVP keeps persistence file-backed under `.relay/`, but the
event model is intended to map cleanly to durable database-backed storage.

## Test Layout

- `backend/tests/`: Python backend unit and API tests.
- `packages/*/tests/`: TypeScript package tests next to the owning package.
- `web/tests/`: web UI tests next to the Next.js app.

Run the active suite with:

```bash
npm test
```

## Roadmap

The broader implementation roadmap remains in
[docs/implementation-plan.md](docs/implementation-plan.md). The next major
work areas are contract test coverage, storage parity, daemon/backend
integration tests, and enterprise control-plane hardening.
