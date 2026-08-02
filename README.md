# Relay

[English](README.md) | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="assets/brand/relay-logo.svg" alt="Relay logo" width="380">
</p>

<p align="center"><strong>Every Employee. Amplified.</strong></p>

Relay is a local-first control plane for AI work. Employees can start threads,
assign durable tasks, schedule routines, and coordinate named AI agents and
teams. Relay keeps identity, policy, approvals, history, and computer placement
in one place while Claude Code, Codex, Pi, and Kimi execute through daemon
processes.

<p align="center">
  <img src="docs/images/relay.png" alt="Relay thread composer with agent and computer selection" width="960">
</p>

This repository contains the developer MVP: a Python/FastAPI control plane,
TypeScript daemons and clients, a Next.js web app, database-backed thread and
task storage, and BoxLite-backed execution. Relay can also run an agent on an
employee's existing computer without BoxLite.

## What works today

- Threaded chat with explicit agent, computer, and Ask, Action, or Review mode.
- A task backlog and recurring routines with assignment, scheduling, dispatch,
  and event history.
- Named agents and teams with profiles, files, generated artifacts, and recent
  activity.
- Local computers and managed computers with durable names, agent placement,
  health, command leases, and restart-safe enrollment.
- Daemon execution for Claude Code, Codex, Pi, and Kimi, including streamed tool
  output and normalized token usage.
- Human approval, cancellation, retry, and handoff flows in the web app.
- A provider-neutral chat gateway with Discord, Telegram, and Lark adapters.
- Admin views for employees, computers, fleet health, activity, and token usage.
- Database-backed thread and task event stores, with optional file-backed
  development stores only for non-thread operational state.

The backend never runs an agent CLI. It records state and queues commands. A
daemon claims each command, executes it in BoxLite or a configured local
environment, and streams ordered events back to the control plane.

## Product snapshots

### Plan and dispatch work

The backlog keeps priority, assignee, due date, status, and dispatch controls in
one view.

<p align="center">
  <img src="docs/images/relay-backlog.png" alt="Relay task backlog" width="960">
</p>

### Coordinate agent teams

Team workspaces collect active tasks, threads, artifacts, and member activity.

<p align="center">
  <img src="docs/images/relay-teams.png" alt="Relay team workspace" width="960">
</p>

## Quick start

### Prerequisites

- Node.js 22.19 or newer
- npm
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Docker and hardware virtualization when using BoxLite
- Credentials or local login state for the agent CLIs you want to run

Install the workspace and run the test suite:

```bash
npm install
npm test
```

Configure authentication, storage, and agent credentials as described in
[Local Development](docs/local-development.md). Then start the services in
separate terminals:

```bash
make backend                     # FastAPI control plane on 127.0.0.1:8790
make daemon SANDBOX_ID=node_dev  # execution node connected to the backend
make web                         # Next.js app on 127.0.0.1:5000
```

Open <http://127.0.0.1:5000>.

Useful commands:

```bash
make supervisor         # reconcile requested managed computers
make backend-migrate    # apply Alembic migrations
make pre-commit-run     # run repository checks
make stop               # stop Relay, daemon, supervisor, and BoxLite
```

Rebuild the BoxLite devbox with `make run-fresh` only after changing
`dockerfile` or the image contents.

## Architecture

```mermaid
flowchart LR
    Clients["Web and chat adapters"] --> API["FastAPI control plane"]
    API --> State["Event stores, auth, scheduler"]
    API --> Queue["Leased daemon command queue"]
    Queue --> Daemon["Relay daemon"]
    Daemon --> Runtime["BoxLite or local environment"]
    Runtime --> CLIs["Claude Code, Codex, Pi, Kimi"]
    Daemon -->|"ordered run events"| API
    Supervisor["Managed-computer supervisor"] --> Daemon
```

The control plane owns sessions, tasks, agent and team identity, computer
placement, policy, and audit history. Daemons own execution and workspace
access. The supervisor reconciles requested managed computers into daemon
processes; its current provider runs local processes, with a command-template
provider available for external infrastructure.

The current repository map, state ownership, and operational invariants are
maintained in [`AGENTS.md`](AGENTS.md). The target architecture and its
implementation blueprint live in
[`docs/system-architecture.md`](docs/system-architecture.md) and
[`docs/implementation-plan.md`](docs/implementation-plan.md).

## Documentation

Start with the [`docs/` index](docs/README.md), which identifies the canonical
owner for setup, APIs, product, architecture, design, decisions, and
operational guidance.
