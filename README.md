# Relay

<p align="center">
  <img src="assets/brand/relay-logo.svg" alt="Relay logo" width="380">
</p>

<p align="center"><strong>Every Employee. Amplified.</strong></p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

Relay is a local-first control plane for AI work. Employees start threads, assign persistent tasks, schedule routines, and coordinate named AI agents and teams from one interface — while Relay records identity, approvals, and history, and tracks which computer hosts each agent.

The Python backend never executes agents itself. Relay daemons run [Claude Code](https://github.com/anthropics/claude-code), Codex, Pi, and Kimi on local or managed computers, inside [BoxLite](https://github.com/boxlite-ai/boxlite) or a configured local environment.

## What you can do

| | |
|---|---|
| **Threads** | Start a thread with an explicit agent and computer. The agent decides whether the goal needs an answer, investigation, workspace changes, validation, review, or a clarifying question. Stream tool output, approve decisions, cancel or retry work, and hand the thread to another agent. |
| **Tasks & routines** | Plan work in a backlog, schedule recurring routines, assign agents or teams, set due dates, and follow dispatch and event history. |
| **Agents & teams** | Create named agents and teams with profiles, computer placement, workspace files, generated artifacts, and recent activity. |
| **Projects** | Bind a persistent shared workspace and an ordered roster of project agents to one computer, then run project conversations that share that workspace. |
| **Computers** | Enroll employee computers or reconcile managed computers while tracking health, capacity, command leases, and durable identity. |
| **Chat gateway** | Connect Discord, Telegram, and Lark through one gateway that maps external identities and conversations to Relay. |
| **Administration** | Operate employees, agents, computers, fleet health, activity, and token usage from one admin area. |

## Product snapshots

### Start and direct a thread

Choose where work runs and which named agent or team handles it; Relay gives the goal to the selected participants and lets each agent choose the appropriate execution path.

<p align="center">
  <img src="docs/images/relay-threads-phosphor.png" alt="Relay thread composer with agent and computer selection" width="960">
</p>

### Plan and dispatch work

The backlog keeps priority, assignment, due date, status, and dispatch context in one view.

<p align="center">
  <img src="docs/images/relay-backlog-phosphor.png" alt="Relay task backlog" width="960">
</p>

### Coordinate agent teams

Team workspaces bring active runs, tasks, threads, workspace files, and member activity together.

<p align="center">
  <img src="docs/images/relay-teams-phosphor.png" alt="Relay team workspace" width="960">
</p>

## Quick start

### Prerequisites

- Node.js 22.19 or newer
- npm
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Docker and hardware virtualization when using BoxLite
- Credentials or local login state for each agent CLI you want to run

Install dependencies and build the TypeScript packages, daemons, supervisor, and web app:

```bash
npm install
npm run build
```

Configure authentication, storage, and agent credentials as described in [Local Development](docs/local-development.md). Then start each service in a separate terminal:

```bash
make backend                     # FastAPI control plane on 127.0.0.1:8790
make daemon SANDBOX_ID=node_dev  # execution node connected to the backend
make web                         # Next.js app on 127.0.0.1:5000
```

Open <http://127.0.0.1:5000>.

Run verification and operational commands as needed:

```bash
npm test                # build and run the TypeScript and Python test suites
make supervisor         # reconcile requested managed computers
make backend-migrate    # apply Alembic migrations
make pre-commit-run     # run repository checks
make stop               # stop Relay, daemon, supervisor, and BoxLite
```

Use `make run-fresh` only after changing `dockerfile` or the BoxLite image contents.

## Built with

| Layer | Technology |
|---|---|
| Backend | [FastAPI](https://github.com/fastapi/fastapi), [SQLAlchemy](https://github.com/sqlalchemy/sqlalchemy), [Pydantic](https://github.com/pydantic/pydantic), [Alembic](https://github.com/sqlalchemy/alembic), [uv](https://github.com/astral-sh/uv) |
| Web | [Next.js](https://github.com/vercel/next.js), [React](https://github.com/facebook/react), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), [TanStack Query](https://github.com/TanStack/query), [Zustand](https://github.com/pmndrs/zustand) |
| Sandboxing | [BoxLite](https://github.com/boxlite-ai/boxlite) |
| Agents | [Claude Code](https://github.com/anthropics/claude-code), Codex, Pi, Kimi |

## Deployment

To host Relay rather than run it locally, [`docs/deployment.md`](docs/deployment.md) covers the web UI on Vercel and the backend plus Postgres on Railway. Daemons stay off both platforms — they run wherever the sandbox lives and connect out to the backend URL.

## Documentation

Start with the [`docs/` index](docs/README.md) for the canonical setup, API, product, architecture, design, decision, and operations documents.
