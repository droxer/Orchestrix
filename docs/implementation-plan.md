# Relay Technical Implementation Design V1.0

<p align="center">
  <img src="../assets/brand/relay-logo.svg" alt="Relay logo" width="360">
</p>

Enterprise AI Workforce Platform / Control Plane / Agent Runtime / Execution Plane / Memory / Governance

This document translates Relay's product and architecture strategy into an implementation blueprint. It is intentionally more concrete than the architecture deep dive: it defines deployable services, ownership boundaries, data models, runtime flows, integration contracts, and phased delivery.

Use this document after reading [system-architecture.md](system-architecture.md). The architecture document explains target system direction and strategic choices; this document explains how to build the system.

Supporting design specifications:

- [Managed Node Provisioning](managed-node-provisioning.md): desired-state
  reconciliation, provider lifecycle, secure daemon enrollment, and migration
  from the current supervisor workflow.

## Document Map

| Section | Purpose |
| :- | :- |
| 0-1 | implementation position and system boundary |
| 2 | deployable components and ownership |
| 3 | core data model and event model |
| 4 | runtime flows |
| 5 | public and internal APIs |
| 6-7 | security and observability |
| 8 | deployment topology |
| 9 | phased build plan |
| 10 | current local implementation map |
| 11-13 | decisions, open questions, and next steps |

## Architecture Decision Records

This implementation blueprint follows the current accepted ADRs:

| ADR | Implementation Impact |
| :- | :- |
| [ADR-007: Governed Enterprise Authority](adr/007-governed-enterprise-authority.md) | Tool calls, sensitive reads, writes, approvals, secrets, and audit must flow through governed Relay boundaries. |
| [ADR-008: BoxLite-First Lightweight Execution](adr/008-boxlite-lightweight-execution.md) | BoxLite is the current lightweight execution implementation, but orchestration should depend on execution-plane interfaces rather than BoxLite directly. |
| [ADR-009: Durable Control Plane Outside Sandbox](adr/009-control-plane-outside-sandbox.md) | Durable task/session state, permissions, approvals, memory, and workflow authority stay outside sandbox guest workers. |
| [ADR-010: Explicit Leases for Agent-Node Delivery](adr/010-leased-agent-node-delivery.md) | Backend-to-daemon commands use bounded, explicit leases and at-least-once delivery; only daemon-reported active work renews ownership. |

## 0. Design Position

Relay should be implemented as a control-plane-first agent platform. Agent CLIs such as Claude Code, Codex, and Pi are execution engines, not the system of record. Relay owns task identity, authorization, workflow state, approval gates, audit trails, memory writeback, sandbox lifecycle, and tool policy.

The sandbox is an execution plane. It may contain a minimal guest worker for command execution and stream forwarding, but it must not own durable task state, approval authority, permission decisions, long-lived secrets, or organizational memory.

## 1. System Boundary

| Boundary | Inside Relay | Outside Relay |
| :- | :- | :- |
| Product workflow | Tasks, sessions, assignments, approvals, handoffs, reviews | External ticketing, CRM, Git host, CI, docs systems |
| Agent orchestration | Agent selection, prompt assembly, state transitions, retries, cancellation | Claude/Codex/Pi model internals |
| Execution | Sandbox lifecycle, command execution policy, stream capture | Host OS internals, cloud provider sandbox implementation |
| Tool access | MCP Gateway, tool registry, policy checks, audit | Individual SaaS/internal APIs |
| Memory | personal/task/project/org memory, writeback approval, retrieval index | Source documents and external knowledge stores |
| Governance | identity, tenant policy, task scope, approval service, audit logs | Enterprise IdP and SIEM consumers |

## 2. Deployable Components

This section is organized by services and runtime responsibilities. Each component should have a clear owner, persistence boundary, and trust boundary.

### 2.1 Channel Layer

Responsibilities:

- Accept work from web app, CLI/TUI, Slack/Teams/Feishu, email, webhook, and API clients.
- Normalize user requests into Relay tasks or sessions.
- Present approval cards, review summaries, artifacts, and live status.

Initial implementation:

- Keep the local CLI/TUI as the developer MVP channel.
- Add a web API and UI once the backend state model is stable.
- Treat chat connectors as clients of the same task/session API, not special workflow engines.

### 2.2 Control Plane API

Responsibilities:

- Tenant, user, workspace, task, session, assignment, approval, artifact, and audit APIs.
- Authorization and policy enforcement before workflow execution.
- Durable persistence in PostgreSQL.
- Live updates through SSE or WebSocket.

Suggested implementation:

- API service in TypeScript/Node.js, FastAPI, or Go. The local MVP is already TypeScript; the cloud control plane language remains an explicit decision.
- PostgreSQL as source of truth.
- Redis for ephemeral coordination, rate limits, and fanout.
- Object storage for large artifacts.

MVP note:

The current local implementation stores tasks and sessions under `.relay/`. Keep that for local-first development, but design the model so it maps directly to PostgreSQL tables later.

### 2.3 Workflow Runtime

Responsibilities:

- Execute long-running task state machines.
- Persist workflow progress and resumable state.
- Coordinate approval waits, agent runs, retries, cancellation, and handoffs.
- Emit task/session events.

Suggested implementation:

- Temporal for durable workflow execution.
- A Relay Runtime library that contains workflow definitions, assignment policies, prompt assembly, routing, and event emission.
- LangGraph only where model-side planning graphs add value; do not use it as the durable system of record.

Workflow examples:

```text
engineering_fix:
  create session
  wait for human approval
  run claude implement
  run pi test/follow-up
  run codex review
  if approved: complete
  if rejected: route feedback to implementer
  if failed: retry within policy or mark blocked
```

```text
sales_followup:
  collect CRM/email/meeting context
  draft summary and CRM update
  request approval for external/customer-facing write
  execute approved writes through MCP Gateway
  write back memory
```

### 2.4 Agent Runtime

Responsibilities:

- Convert tasks and session state into agent-specific prompts.
- Select agent role and mode: implementer, reviewer, tester, planner, fixer.
- Launch Claude/Codex/Pi or other agents through the execution plane.
- Parse structured outputs and normalize them into Relay events.
- Enforce per-agent failure limits and handoff rules.

Implementation rules:

- Agent CLIs run inside the execution plane.
- Agent prompts must not contain long-lived secrets.
- JSON/JSONL output must be rendered into human-readable streams and captured as raw events.
- Review mode is informational: agents emit prose review notes; no machine-readable verdict marker is required.
- Agent-specific command builders should stay separate from workflow policy.

### 2.5 Execution Plane

Responsibilities:

- Provide isolated execution for code, scripts, file handling, browser automation, and agent CLIs.
- Mount scoped workspaces.
- Inject short-lived credentials or generated auth files only for the active task.
- Stream stdout/stderr back to the control plane.
- Support cancellation and cleanup.

Sandbox tiers:

| Tier | Use | Runtime |
| :- | :- | :- |
| L0 | No code execution, pure retrieval or summarization | restricted worker or control-plane-only execution |
| L1 | short coding/data tasks | BoxLite |
| L2 | dependency install, batch processing, medium risk | Kubernetes Job + gVisor |
| L3 | unknown/customer-uploaded code | E2B, Kata, or equivalent high-isolation sandbox |
| L4 | long-lived development workspace | Cloud Workstations or managed developer environments |

Control-plane and guest-worker boundary:

- Run the Relay control-plane daemon outside the sandbox.
- Optionally run a minimal sandbox guest worker.
- The guest worker may execute approved commands, forward streams, report exit status, and perform local file operations.
- The guest worker must not make authorization decisions, own workflow state, store durable memory, or hold long-lived secrets.

### 2.6 MCP Gateway and Tool Layer

Responsibilities:

- Register all tools and internal system connectors.
- Authenticate users and agents.
- Enforce user permission, agent permission, task scope, and tool policy.
- Proxy calls to internal APIs.
- Audit every tool call with request metadata, decision, and result summary.

Key services:

- Tool Registry: schema, owner, version, risk level, scopes, rate limits.
- Policy Engine: checks whether a tool call is allowed for the user, agent, tenant, and task.
- Secret Broker: issues short-lived task-scoped credentials.
- MCP Gateway: exposes approved MCP servers/tools to agents through a governed interface.

Write policy:

- Low-risk reads may execute after policy checks.
- Sensitive reads require stronger scopes and audit.
- External writes, customer-visible content, production changes, payments, deletions, and high-risk internal writes require human approval unless the tenant policy explicitly allows automation.

### 2.7 Memory Plane

Responsibilities:

- Retrieve relevant personal, task, project, team, and organization memory.
- Store session outcomes, artifacts, decisions, reusable patterns, and feedback.
- Separate raw artifacts from curated memory.
- Support memory writeback review and redaction.

Suggested data stores:

- PostgreSQL for canonical memory objects and relations.
- pgvector for MVP embeddings.
- Qdrant or another vector database when vector scale demands it.
- OpenSearch for keyword and faceted retrieval.
- Object storage for large artifacts.

Memory types:

| Type | Scope | Examples |
| :- | :- | :- |
| Personal memory | user | preferences, working style, recurring tasks |
| Task memory | session/task | decisions, files changed, review feedback |
| Project memory | repo/workspace | architecture notes, conventions, known pitfalls |
| Team memory | group | playbooks, reusable workflows |
| Organization memory | tenant | policies, domain knowledge, approved procedures |

Writeback flow:

```text
session completed
extract candidate memories
classify sensitivity and scope
deduplicate against existing memory
request review when policy requires it
persist accepted memory
index for retrieval
link memory to source session/artifacts
```

### 2.8 Governance Plane

Responsibilities:

- Enforce identity, permissions, approvals, policy, retention, and audit.
- Provide tenant-level controls for allowed agents, allowed tools, network egress, data residency, and memory writeback.
- Produce compliance-ready event histories.

Core checks:

```text
user permission
agent permission
task permission
tool policy
data sensitivity
approval requirement
egress/network policy
secret scope
```

Audit events should cover:

- task/session creation
- assignment and handoff
- human decision
- sandbox creation/destruction
- command execution
- tool call request/decision/result
- secret issuance
- memory read/writeback
- artifact creation
- external write

## 3. Core Data Model

The implementation should preserve an event-sourced task/session model. Local `.relay` files are the developer MVP persistence layer; PostgreSQL becomes the production source of truth without changing the conceptual model.

### 3.1 Primary Entities

| Entity | Purpose |
| :- | :- |
| Tenant | enterprise boundary and policy root |
| User | human identity from IdP |
| AgentIdentity | Claude/Codex/Pi/custom agent identity and permissions |
| Workspace | repo, project, business workspace, or mounted execution context |
| Task | durable work item |
| Session | one execution thread or handoff chain |
| Assignment | one agent role/mode step in a session |
| Artifact | command logs, diffs, reports, plans, summaries |
| Approval | human gate and decision record |
| ToolCall | governed external/internal tool invocation |
| SandboxRun | execution-plane lifecycle record |
| MemoryObject | accepted durable memory |
| AuditEvent | immutable governance event |

### 3.2 Event Model

Use append-only events as the source of truth for task/session execution.

Suggested event families:

```text
task.created
task.updated
task.assigned
task.status
task.session_linked

session.created
session.status
assignment.planned
human.decision

sandbox.created
sandbox.ready
sandbox.destroyed

agent.started
agent.output
agent.completed
agent.failed

tool.requested
tool.allowed
tool.denied
tool.completed

artifact.created
memory.candidate_created
memory.written

session.completed
session.failed
session.cancelled
```

### 3.3 PostgreSQL Tables

Initial relational schema:

```text
tenants
users
agent_identities
workspaces
tasks
task_events
sessions
session_events
assignments
approvals
artifacts
sandbox_runs
tool_registry
tool_calls
memory_objects
memory_links
audit_events
```

Implementation rule:

Task/session event append should be transactionally paired with materialized snapshot updates. For cloud deployment, use `SELECT ... FOR UPDATE` or optimistic versioning to prevent concurrent state corruption.

## 4. Runtime Flow

### 4.1 Task Creation

```text
client request
authenticate user
authorize workspace/task creation
create task
optionally create pending session
emit task/session events
return task/session id
```

### 4.2 Assignment Approval

```text
assignment plan generated
policy engine classifies risk
if approval required:
  create approval
  notify human
  pause workflow
else:
  continue
```

### 4.3 Agent Execution

```text
workflow starts assignment
resolve task context and memory
request sandbox
prepare workspace and scoped credentials
build agent command and prompt
execute in sandbox
stream stdout/stderr
capture artifacts
parse structured output
destroy or retain sandbox according to policy
emit assignment result
route next step
```

### 4.4 Tool Call Execution

```text
agent requests tool
MCP Gateway receives call
resolve user, agent, tenant, task, and tool
evaluate policy
if approval needed: pause and request decision
if allowed: issue short-lived credential
execute tool call
record audit event and result summary
return response to agent
```

### 4.5 Session Completion

```text
final agent/review step completes
write final artifacts
extract memory candidates
request memory writeback review if required
mark session completed or failed
update task status
notify channel clients
```

## 5. API Surface

APIs should expose Relay's canonical task/session model. Channel clients, web UI, chat integrations, and automation clients should all use the same underlying APIs.

### 5.1 Control Plane API

Minimum API groups:

```text
/v1/tasks
/v1/sessions
/v1/assignments
/v1/approvals
/v1/artifacts
/v1/events
/v1/workspaces
/v1/tools
/v1/memory
/v1/audit
```

Execution APIs:

```text
POST /v1/sessions
POST /v1/sessions/{id}/assignments
POST /v1/sessions/{id}/start
POST /v1/sessions/{id}/cancel
POST /v1/approvals/{id}/decisions
GET  /v1/sessions/{id}/events
GET  /v1/sessions/{id}/artifacts/{artifact_id}
```

### 5.2 Internal Runtime APIs

Control plane to workflow runtime:

```text
start_workflow(session_id, workflow_type)
signal_approval(session_id, approval_id, decision)
cancel_workflow(session_id)
query_workflow(session_id)
```

Workflow runtime to execution plane:

```text
create_sandbox(spec)
prepare_workspace(sandbox_id, workspace_spec)
prepare_credentials(sandbox_id, credential_spec)
exec(sandbox_id, command_spec)
stream(sandbox_id, execution_id)
kill(sandbox_id, execution_id)
destroy_sandbox(sandbox_id)
```

Execution plane to control plane:

```text
execution_started
stdout_chunk
stderr_chunk
execution_completed
sandbox_error
heartbeat
```

## 6. Security Implementation

### 6.1 Secrets

- Store long-lived integration credentials in a vault.
- Issue task-scoped short-lived tokens through Secret Broker.
- Never persist secret values in events, artifacts, memory, or prompts.
- Redact known secret patterns from logs before writing artifacts.

### 6.2 Sandbox Policy

- Default no inbound network to sandbox.
- Egress allowlist by tenant/workspace/task.
- Mount only scoped workspace paths.
- Prefer read-only mounts where mutation is unnecessary.
- Destroy short-task sandboxes after completion.
- Preserve only declared artifacts.

### 6.3 Approval Policy

Actions requiring approval by default:

- external messages to customers or partners
- production deployments
- production data mutation
- deletion or destructive operations
- payment, billing, contract, or legal actions
- memory writeback of sensitive or organization-wide knowledge
- granting new tool permissions

## 7. Observability

### 7.1 Metrics

Track:

- task completion rate
- approval wait time
- agent execution duration
- sandbox startup time
- tool call latency and denial rate
- review approval/rejection rate
- retry count by agent
- memory writeback acceptance rate
- cost per session

### 7.2 Logs and Traces

Use correlation IDs:

```text
tenant_id
user_id
task_id
session_id
assignment_id
sandbox_id
execution_id
tool_call_id
trace_id
```

### 7.3 Debuggability

Every session should answer:

- who requested the work
- which agent ran
- what command/tool executed
- what permissions were checked
- what approval was granted or denied
- what artifacts were produced
- what memory was read or written
- why the workflow completed, failed, or paused

## 8. Deployment Topology

### 8.1 Local MVP

```text
Relay CLI/TUI
Relay local API
.relay file store
BoxLite sandbox
Claude/Codex/Pi CLIs in sandbox
```

### 8.2 Team Server MVP

```text
Web app
Control Plane API
PostgreSQL
Redis
Temporal
BoxLite worker hosts
MCP Gateway
Secret Broker
Object storage
```

### 8.3 Enterprise SaaS / Private Deployment

```text
Next.js web app
Control Plane API service
Workflow service
Execution manager
Sandbox worker pool
MCP Gateway
Policy service
Secret Broker
Memory service
PostgreSQL
Redis
Temporal cluster
Vector/search storage
Object storage
Audit/SIEM export
```

## 9. Implementation Phases

The phases are ordered to keep the current local product usable while extracting cloud-ready boundaries incrementally.

### Phase 0: Local Relay Hardening

- Keep host orchestrator in TypeScript.
- Keep BoxLite lifecycle outside the sandbox.
- Keep task/session event model stable.
- Add explicit technical ADRs for control-plane and guest-worker boundaries.
- Improve command redaction and artifact handling.

### Phase 1: Execution Service Boundary

- Extract execution interfaces from direct BoxLite calls.
- Introduce `ExecutionManager` with `createSandbox`, `exec`, `stream`, `kill`, and `destroy`.
- Add optional sandbox guest worker for command execution and streaming.
- Keep all authorization and workflow state in the host/control plane.

### Phase 2: Durable Backend

- Move `.relay` stores to PostgreSQL-backed repositories.
- Add API auth and workspace ownership.
- Add Redis/SSE/WebSocket live event fanout.
- Add object storage for artifacts.

### Phase 3: Temporal Runtime

- Implement Temporal workflows for assignment chains.
- Add approval waits and cancellation signals.
- Add retry policies and failure classification.
- Add resumable sessions.

### Phase 4: MCP Gateway and Governance

- Build Tool Registry.
- Add Policy Engine checks.
- Add Secret Broker.
- Route internal/external tool calls through MCP Gateway.
- Add approval gates for high-risk writes.

### Phase 5: Memory Plane

- Add memory object schema.
- Add retrieval at prompt assembly time.
- Add memory candidate extraction after session completion.
- Add reviewable writeback.
- Add vector and keyword indexing.

### Phase 6: Enterprise Readiness

- Tenant policies.
- Audit export.
- Data retention controls.
- Admin UI.
- Multi-region or private deployment mode.
- Sandbox tiering across BoxLite, Kubernetes/gVisor, E2B/Kata, and Cloud Workstations.

## 10. Current Local Implementation Map

This section maps the current local Python backend and TypeScript client/daemon
implementation to the target implementation design. It should be kept current
while the product is still local-first.

### 10.1 Runtime Entrypoints

| Entry | File | Behavior |
| :- | :- | :- |
| `relay-core` | `packages/relay-core/src/index.ts` | Shared protocol, agent state, prompts, command builders, renderers, guest helpers, and agent execution units. |
| `relay-tui` | `packages/relay-tui/src/cli.ts` -> `packages/relay-tui/src/tui.tsx` | Starts the Ink TUI. |
| `backend` | `backend/relay/cli.py` -> `backend/relay/app.py` | Starts the Python backend/control plane. |
| `relay-daemon` | `packages/relay-daemon/src/cli.ts` -> `packages/relay-daemon/src/index.ts` | Starts the daemon node. |
| TypeScript backend client exports | `packages/relay-core/src/index.ts` | Re-exports protocol types, HTTP client helpers, local TUI session helpers, command builders, renderers, and workflow helpers. |

Keep backend runtime code in `backend/`, TypeScript protocol/client
exports in `packages/relay-core/src/index.ts`, and sandbox/execution exports in
`packages/relay-daemon/src/index.ts`. Package binary wrappers should stay
minimal.

### 10.2 Local Data Model

The local MVP persists two durable records:

- `RelayTask`: backlog/Kanban work item.
- `RelaySession`: append-only execution history for one run or handoff chain.

Both models are event-sourced. The event log is authoritative; `snapshot.json` is a materialized convenience view rebuilt after each append.

Routine tasks reuse the task model with `isRoutine`, `routineCadence`, and
`routineNextRunDate` fields. The backend `TaskScheduler`
(`backend/relay/services/task_scheduler.py`) promotes due routines and dispatches
assigned tasks to ready daemon nodes.

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
  daemon/
    nodes/
    commands/
    runs/
    run-requests/
    events/
  daemon-nodes/
    <employee-id>.token
    logs/
      *.jsonl
```

`LocalTaskStore` in `backend/relay/persistence/task_store.py` owns task
persistence and materialization (`backend/relay/stores.py` and
`backend/relay/task_store.py` re-export). It emits events such as
`task.created`, `task.updated`, `task.assigned`, `task.status`,
`task.session_linked`, and `task.activity`.

`LocalSessionStore` in `backend/relay/persistence/session_store.py` owns session
persistence, artifact files, and session materialization
(`backend/relay/session_store.py` re-exports). It emits events such as
`session.created`, `session.status`, `agent.started`, `agent.output`,
`artifact.created`, `human.decision`, `agent.completed`,
`session.completed`, and `session.failed`.

When adding a new event type, update the materializer and tests together.

### 10.3 Execution Controller

`SessionController` in `backend/relay/services/controller.py` is the backend
boundary between durable state and daemon execution
(`backend/relay/controller.py` re-exports).
`packages/relay-core/src/session-controller.ts` remains as a TypeScript TUI/test
compatibility helper.

Responsibilities:

- create sessions and link them to an optional task
- emit agent lifecycle and output events
- write command output artifacts
- record human decisions
- mark sessions completed or failed
- update linked task status and activity as agent steps progress

Use `runStep()` for one agent assignment and `runAssignments()` for an explicit ordered assignment list. Use `runDefaultWorkflow()` only for the built-in Claude -> Pi -> Codex routing loop.

Do not bypass `SessionController` when adding writable execution controls to the TUI or API.

### 10.4 Agent Execution

Agent-specific execution lives in `packages/relay-core/src/nodes.ts`.

| Node | Command Builder | Renderer | Output State |
| :- | :- | :- | :- |
| `claudeImplementNode()` | `buildClaudeImplementCommand()` | `ClaudeStreamRenderer` | Last log tail, exit code, Claude failure count |
| `piImplementNode()` | `buildPiImplementCommand()` | `PlainTextStreamRenderer` | Last log tail, exit code, Pi failure count |
| `codexImplementNode()` | `buildCodexImplementCommand()` | `CodexStreamRenderer` | Last log tail, exit code, Codex failure count |
| `codexReviewNode()` | `buildCodexReviewCommand()` | `CodexStreamRenderer` | Full review log, exit code |

Execution contracts:

- Claude runs with `--output-format stream-json`; render JSONL through `ClaudeStreamRenderer`.
- Codex runs with `exec --json`; render JSONL through `CodexStreamRenderer`.
- Pi uses `-P` only when `pi --help` advertises streaming print support; otherwise it falls back to `-p`.
- Nodes stream human-readable output to the sink and forward raw chunks to `AgentEventSink.agentOutput()`.
- Review mode is informational: agents emit prose review notes; no machine-readable verdict marker is required.

### 10.5 Workflow and BoxLite Runtime

Daemon-side sandbox orchestration in `packages/relay-daemon/src/sandbox-session.ts` wraps agent execution:

1. Ensures only one Relay orchestrator is active.
2. Ensures the devbox image is exported as OCI.
3. Creates a BoxLite runtime using `@boxlite-ai/boxlite`.
4. Mounts the host workspace into the guest at `/workspace`.
5. Syncs guest workspace ownership.
6. Configures guest auth/env for Codex and Pi when needed.
7. Runs the requested action.
8. Stops and removes the BoxLite runtime.

`ensureAgentReady()` performs per-agent preflight checks and caches readiness for the current orchestrator session:

- Claude: `claude --version`
- Codex: writes guest auth, then `codex login status`
- Pi: writes guest auth/model config, then `buildPiPreflightCommand()`

Normal execution should use `make run` or `npm run run`. Use `make run-fresh` only when `dockerfile` or the devbox image changes.

### 10.6 Routing, TUI, and Local API

The default scripted workflow is:

```text
Claude implement -> Pi implement/test follow-up -> Codex review
```

Routing helpers live in `packages/relay-core/src/routing.ts`.

- Claude success routes to Pi.
- Pi success ends the workflow (Codex review is optional via explicit assignment).

The TUI in `packages/relay-tui/src/tui.tsx` accepts leading agent mentions such as:

```text
@claude fix auth middleware
@claude @pi @codex implement and review the task
```

Slash commands include `/approve`, `/reject`, `/cancel`, `/rerun`, `/handoff`, `/sessions`, `/open`, `/summary`, and `/quit`.

The Python API in `backend/relay/app.py` exposes canonical `/api/v1`
task/thread/daemon/chat endpoints and starts the background task scheduler by default. Current API
routes can create tasks (including backlog and routine metadata), create pending
sessions, attach assignment-plan artifacts, record decisions, and expose
historical events/artifacts. Scheduled dispatch and daemon execution still flow
through `ServerDaemonNodeBackend.run`; the backend does not execute agent CLIs
in-process.

The web UI on the clean paths documented in [api.md](api.md) adds chat, backlog, routines, MCP, skills, channels, and
the admin console on top of the same backend APIs.

Future execution endpoints must call the same `SessionController` and orchestrator readiness flow used by the CLI/TUI.

### 10.7 Environment, Auth, and Testing

Environment helpers live in `packages/relay-core/src/env.ts`; guest setup helpers live in `packages/relay-core/src/guest.ts`.

Host-side configuration is converted into guest files/env:

- Codex auth/config under `/home/agent/.codex`
- Pi auth/model config under `/home/agent/.pi/agent`
- workspace mounted at `/workspace`
- commands executed as the guest `agent` user through `runAsAgent()`

Do not put long-lived secrets into prompts or persisted session artifacts.

Run local tests with:

```text
npm test
```

Test coverage is organized as:

- `backend/tests/`: Python event stores, artifacts, controller behavior, linked
  task updates, daemon registry behavior, task scheduler/routine promotion, and
  HTTP API routes.
- `packages/relay-core/tests/handoff.test.ts`: routing, prompt contracts, review-mode command generation (no verdict markers), stream renderers, BoxLite execution helpers.
- `packages/relay-tui/tests/tui.test.tsx`: TUI parsing, shortcuts, rendering, cancellation, session state updates, slash commands.
- `web/tests/status.test.ts`: web daemon-node status derivation.
- `web/tests/backlog.test.ts`: backlog filtering, sorting, and display helpers.

### 10.8 Local Change Guidelines

- Keep backend/control-plane runtime code in `backend/relay/` (`core/`,
  `persistence/`, `security/`, `services/`, and `api/`). Keep shared protocol,
  daemon execution, TUI, and web client code in TypeScript.
- Use BoxLite's Node SDK for VM lifecycle and command execution.
- Keep durable state append-only; add events instead of mutating history.
- Keep snapshots derived from event logs.
- Keep tasks and sessions loosely coupled through `task.session_linked`.
- Keep API state real: no seeded demo tasks, fake agent runs, or dummy artifacts.
- Keep agent execution isolated to `nodes.ts`, command construction to
  `commands.ts`, backend workflow state in `backend/relay/services/controller.py`,
  scheduled task dispatch in `backend/relay/services/task_scheduler.py`, and
  daemon sandbox lifecycle in `packages/relay-daemon/src/sandbox-session.ts` /
  `packages/relay-daemon/src/box.ts`.

## 11. Key Engineering Decisions

| Decision | Direction |
| :- | :- |
| Control plane location | outside sandbox |
| Sandbox process | optional minimal guest worker only |
| Durable state | PostgreSQL/event-sourced task and session logs |
| Workflow engine | Temporal for long-running/resumable work |
| Agent CLIs | executed inside sandbox |
| Secrets | short-lived task-scoped credentials |
| Tool access | MCP Gateway with policy and audit |
| Memory | layered memory with reviewed writeback |
| API state | task/session APIs are canonical, channels are clients |
| Current local mode | `.relay` file store remains acceptable for developer MVP |

## 12. Open Technical Questions

- Which backend language should own the cloud control plane: TypeScript for code reuse, or FastAPI/Go for enterprise service conventions?
- Should the guest worker use stdio, Unix socket, or localhost HTTP inside the sandbox?
- What is the minimum policy language for tool and approval rules?
- How much LangGraph is needed once Temporal owns durable state?
- Which memory candidates require human review by default?
- What sandbox tier should be the default for enterprise private deployment?
- How should artifact redaction be implemented before persistence?

## 13. Immediate Next Steps

1. Keep ADRs current for control-plane placement, sandbox guest-worker scope, and governed tool authority.
2. Continue expanding the TypeScript `ExecutionManager` boundary toward `SandboxHandle` and `ExecutionHandle` contracts.
3. Move remaining direct BoxLite usage behind the execution interface without changing behavior.
4. Keep current `SessionController` as the local durable orchestration boundary.
5. Add tests proving agent execution still streams, captures artifacts, supports cancellation, and never moves task authority into the sandbox.
