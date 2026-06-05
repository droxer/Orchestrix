# Relay Architecture

Relay is organized around durable collaboration tasks and execution sessions. Tasks provide the backlog and Kanban board; sessions remain the append-only execution history for agent runs, artifacts, decisions, and review outcomes.

## Core Model

`RelayTask` is the collaboration task contract. A task contains title, description, priority, Kanban status, assigned agent, linked session IDs, activity, and the complete task event log.

`RelaySession` is the execution contract used by the TUI, CLI commands, orchestration engine, and HTTP API. A session contains:

- task goal and workspace path
- current status and phase
- agent runs with role, mode, status, and exit code
- artifacts such as command logs, reviews, summaries, and test output
- human decisions such as approve, reject, cancel, rerun, and mark done
- the complete timeline of `RelayEvent` records

The event log is authoritative. `snapshot.json` is rebuilt from events after each append.

## Subsystems

- `task.ts`: defines public task types, `LocalTaskStore`, task events, Kanban statuses, assignment, session linking, and materialization.
- `session.ts`: defines public session types, `LocalSessionStore`, event creation, artifact writing, and materialization.
- `controller.ts`: coordinates session events around agent node execution. It emits `agent.started`, `agent.output`, `artifact.created`, `agent.completed`, review verdicts, terminal session events, and optional linked task status/activity updates.
- `nodes.ts`: keeps the agent-specific command execution logic. Nodes render streams for humans while forwarding raw output chunks to the controller event sink.
- `workflow.ts`: owns BoxLite lifecycle, readiness checks, scripted workflow routing, and CLI commands.
- `tui.tsx`: provides the small-team operator surface. It creates pending sessions, records human decisions, and starts approved work.
- `server.ts`: exposes a local HTTP/SSE API over the task and session stores. It does not serve a browser UI.

## Default Workflow

The compatible scripted workflow remains:

```text
Claude implement -> Pi implement/test follow-up -> Codex review
```

Codex review verdicts preserve the existing routing behavior:

- `APPROVED` completes the workflow.
- `REJECTED` routes feedback back to Claude.
- runtime failure retries Codex review until the configured retry limit.

## Storage

The first implementation uses a file-backed store:

```text
.relay/tasks/<task-id>/events.jsonl
.relay/tasks/<task-id>/snapshot.json
.relay/sessions/<session-id>/events.jsonl
.relay/sessions/<session-id>/snapshot.json
.relay/sessions/<session-id>/artifacts/
```

This keeps Relay local-first, inspectable, and easy to replace later with SQLite or a remote store if team sharing needs grow.

## HTTP API Boundary

`relay serve` serves JSON/SSE endpoints for task and session management. The root route returns a JSON API index; there is no embedded browser UI. API clients can create durable backlog items, assign agents, pick up tasks into pending sessions, move tasks through Kanban states, and inspect linked sessions. Agent CLI execution remains in the orchestrator/TUI path.

The server exposes:

- task list and task detail
- task creation, update, assignment, pickup, and event export
- session list
- session detail
- task/session creation
- assignment plan updates
- human decisions and handoffs
- SSE event export
- artifact content

The API is backed only by `TaskStore` and `SessionStore` data. It must not seed demo tasks, mock agent runs, or display dummy artifacts.

Future writable controls that execute agents should go through the same `SessionController` and BoxLite readiness flow instead of bypassing the orchestrator.
