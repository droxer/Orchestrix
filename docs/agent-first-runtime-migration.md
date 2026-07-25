# Agent-First Runtime Migration Plan

**Goal:** Migrate Relay from employee-to-node routing to employee-owned logical
agents with placement-based runtime selection, while preserving existing
sessions, daemon protocols, and managed-node operations.

**Design:** [agent-first-runtime-design.md](agent-first-runtime-design.md)

## Implementation status — 2026-07-22

Implemented in the current vertical slice:

- event-sourced `EmployeeAgent` and `AgentPlacement` local stores;
- admin agent and placement APIs plus employee-visible `GET /agents`;
- multiple same-executor agents per employee;
- multiple dedicated managed nodes per employee;
- distinct compatibility agents and placements materialized from
  administrator-assigned daemon capabilities or during legacy dispatch,
  without mutating employee reads;
- additive daemon executor-capability registration;
- `POST /agent-runs` with ownership checks and stable routing errors;
- placement selection and node-scoped multi-assignment dispatch;
- logical agent, placement, node, executor, and version in run audit state;
- logical-agent instructions in executor prompts;
- named-agent selection in employee chat with legacy fallback;
- admin Agents view and drawer for creating agents and placements;
- PostgreSQL agent and placement snapshots with append-only event tables;
- durable task and routine assignment by logical `agentId`;
- scheduler resolution of task assignments through live placements;
- canonical daemon `workspaceId` registration and persistence;
- hard rejection of multi-agent workflows whose placements span nodes,
  regardless of workspace ID or `shared-path` metadata;
- managed-node supervisors derive stable employee-home workspace IDs or pass
  an explicit `workspacePolicy.workspaceId` to launched daemons;
- per-node capacity filtering plus agent/placement revalidation before every
  command enqueue;
- database-enforced employee-scoped normalized agent-name uniqueness.
- atomic single-placement moves, including database-backed stores;
- compatibility-agent materialization for legacy task and routine assignments;
- existing-session node affinity without shared-workspace exceptions;
- safe node removal that preserves custom and moved logical agents;
- logical-agent deletion blocked until active runs have drained;
- dispatch-time delivery of updated agent configuration, with monotonic
  placement-version audit updates that never gate runtime readiness;
- rejection of non-empty policy fields, including dispatch blocking for legacy
  policy metadata, until daemon-side enforcement exists.

Still pending:

- verified shared mounts and artifact transfer;
- provider-driven placement reconciliation and multi-placement failover;
- full chat-integration and TUI named-agent selection;
- observability dashboards, staged rollout controls, and compatibility removal.

## Delivery strategy

Use additive contracts first, dual-read/dual-write only where necessary, and
remove compatibility behavior only after old clients and daemons are no longer
required. Each phase must be independently deployable and reversible.

Do not change the invariant that the backend never executes agents. All runs
continue through daemon command queues and leases.

## Phase 0 — Baseline and terminology

### Objective

Establish regression coverage and remove ambiguity between logical agents and
CLI executor kinds without changing behavior.

### Work

- [ ] Record fixtures for current session assignments, task assignments,
  daemon registration, node health, disabled agents, role defaults, handoff,
  and leased command delivery.
- [ ] Introduce the internal alias `ExecutorKind = AgentName`; do not rename
  serialized fields yet.
- [ ] Document that existing `agents` maps and `supportedAgents` are runtime
  capability reports, not durable agent identity.
- [ ] Add metrics for legacy assignment dispatch, node selection failures, and
  executor readiness failures.
- [ ] Add a feature flag `RELAY_AGENT_FIRST_ROUTING` defaulting off.

### Verification

- [ ] Existing backend, daemon, relay-core, chat, TUI, and web tests pass.
- [ ] Serialized API and event fixtures are unchanged.

## Phase 1 — Logical-agent persistence and APIs

### Objective

Create durable employee-owned agents without changing dispatch.

### Backend

- [x] Add `EmployeeAgentStore` under `backend/relay/persistence/` with local
  event/snapshot persistence matching current repository conventions.
- [x] Add PostgreSQL tables and migrations when database-backed control-plane
  stores are enabled: `employee_agents`, `employee_agent_events`.
- [x] Define events: `agent.created`, `agent.updated`, `agent.enabled`,
  `agent.disabled`, and `agent.deleted`.
- [x] Add models and validation for executor kind, role, instructions, and
  version. Reserve policy fields but reject non-empty values until their
  runtime enforcement contract is implemented.
- [x] Enforce employee-scoped display-name uniqueness and permit duplicate
  executor kinds.
- [x] Add admin CRUD routes and employee-visible `GET /agents`.
- [ ] Ensure secrets are referenced, never embedded in agent snapshots or
  control-panel responses.

### Compatibility materialization

- [x] Add a deterministic compatibility mapping for
  `(employeeId, daemonNodeId, executorKind) -> agentId` so each registered
  computer exposes its own compatibility agent.
- [x] Lazily create compatibility agents for existing employees when an old
  assignment is first resolved.
- [ ] Provide an idempotent migration command to pre-create compatibility
  agents from existing sessions, tasks, and daemon assignments.
- [ ] Never rewrite historical session or task events.

### Web

- [x] Add API types and clients for logical agents.
- [ ] Add an admin Agents view behind a feature flag.
- [ ] Show logical agents under each employee in People view.

### Tests

- [ ] Store event/snapshot derivation and optimistic update tests.
- [ ] API authorization and validation tests.
- [ ] Duplicate executor-kind and duplicate display-name tests.
- [ ] Compatibility materialization idempotency tests.

### Exit criteria

- Logical agents can be created, listed, updated, disabled, and deleted.
- Existing routing behavior is unchanged.
- Every existing assignment can resolve to a compatibility agent.

## Phase 2 — Runtime capabilities and placements

### Objective

Represent where logical agents can run while keeping current daemon protocol
compatible.

### Capability normalization

- [ ] Define `DaemonExecutorCapability` in `relay-core`.
- [ ] Extend daemon registration with optional `executorCapabilities`.
- [ ] Normalize legacy `supportedAgents` and `agents` health maps into the new
  capability model in the backend.
- [ ] Continue emitting legacy fields in API responses during compatibility.
- [ ] Persist capability capacity, adapter, inventory, and configuration
  fingerprint on daemon observations.

### Placement persistence

- [ ] Add `AgentPlacementStore` and events: `placement.created`,
  `placement.updated`, `placement.draining`, `placement.removed`, and
  `placement.condition_changed`.
- [ ] Add placement CRUD/list APIs.
- [ ] Validate executor-kind compatibility between agent and node.
- [ ] Derive placement availability from desired state, daemon heartbeat,
  executor health, agent version, and node capacity.
- [ ] Keep availability derived; do not make heartbeats append durable
  placement events on every poll.

### Initial placement policy

- [x] Materialize one compatibility agent and placement for each supported
  executor on each assigned computer.
- [ ] Permit administrators to place different agents from one employee on
  different nodes.
- [x] Allow one active placement per logical agent; moves atomically supersede
  the previous placement. Several distinct agents may use the same executor
  capability on a node, subject to runtime capacity.
- [ ] Preserve node-level disabled-agent and role-default rules as additional
  placement constraints.

### Managed nodes

- [ ] Remove the storage constraint limiting an employee to one non-deleted
  dedicated managed node.
- [ ] Treat managed-node `employeeId` as a placement-policy hint during the
  transition.
- [ ] Do not let the supervisor create logical agents or placements.

### Tests

- [ ] Old and new daemon registration contract tests.
- [ ] Placement compatibility and derived availability tests.
- [ ] Multiple nodes per employee and multiple agents per employee tests.
- [ ] Managed-node duplicate constraint migration tests.

### Exit criteria

- One employee can own several logical agents placed across several nodes.
- Admin APIs show placement health and structured incompatibility reasons.
- Old daemons remain usable.

## Phase 3 — Agent-targeted assignments and placement selection

### Objective

Route new work by logical agent rather than by employee node.

### Protocol and events

- [ ] Add optional `agentId` to relay-core, backend, chat, TUI, and web
  assignment contracts.
- [ ] Add `logicalAgentId`, `placementId`, `daemonNodeId`, `executorKind`, and
  `agentVersion` to new run events and snapshots.
- [ ] Keep the serialized legacy `agent` field as executor kind.
- [ ] Add a structured placement-decision record to run-start audit data,
  including rejected candidate reason codes without secrets.

### Scheduler

- [x] Implement a pure placement candidate evaluator.
- [ ] Apply hard filters in this order: authorization, enabled state, desired
  placement state, agent version, executor compatibility, protocol version,
  heartbeat, workspace access, requested mode, and capacity.
- [ ] Rank candidates by session affinity, placement priority, available
  capacity, most recent healthy heartbeat, and stable placement ID.
- [x] Revalidate the selected candidate atomically immediately before command
  enqueue.
- [x] Return stable errors: `agent_not_found`, `agent_forbidden`,
  `agent_disabled`, `agent_offline`, `workspace_unavailable`,
  `agent_configuration_pending`, and `capacity_exhausted`.
- [x] Preserve leased at-least-once command delivery from ADR-010.

### Compatibility routing

- [x] When `agentId` is absent, resolve the employee's compatibility agent for
  the legacy executor kind.
- [x] Keep explicit `sandboxId` accepted for admin/internal compatibility but
  verify that it is an eligible placement for the resolved agent.
- [ ] Emit metrics comparing legacy node selection with agent-first selection
  while the feature flag is in shadow mode.

### Tests

- [ ] Deterministic candidate filtering/ranking unit tests.
- [ ] Authorization tests proving users cannot target arbitrary placements.
- [ ] Node outage, stale heartbeat, disabled agent, capacity, and retry tests.
- [ ] Two same-kind logical agents routed to different nodes.
- [ ] Multi-assignment workflow with each assignment on a different node.
- [ ] Legacy session and legacy client compatibility tests.

### Exit criteria

- Agent-first routing passes shadow comparison and can be enabled per tenant or
  installation.
- Every new run is attributable to logical agent, placement, and node.
- Existing clients still dispatch successfully.

## Phase 4 — Node-scoped collaborative workflows

> Superseded direction: ADR-011 rejects shared-path cross-node collaboration.
> Canonical workspace identity remains for continuity and drift detection.

### Objective

Require every agent in one collaborative workflow to execute on the same node.

### Session affinity

- [x] Introduce canonical `workspaceId` separate from host and guest paths.
- [x] Add workspace identity reports to daemon registration.
- [x] Keep sessions node-affine once their first run selects a node.
- [x] Reject a later assignment whose placement resolves to another node.

### Workspace identity

- [x] Treat canonical workspace identity as continuity metadata.
- [x] Do not treat a matching workspace ID as proof of agent co-location.
- [ ] Reject rather than silently dispatch when compatibility is uncertain.

### Artifact-handoff mode

- [ ] Define declared input/output artifact manifests with hashes, sizes, and
  media types.
- [ ] Transfer artifacts through the control-plane-approved storage path; do
  not proxy arbitrary work through backend process execution.
- [ ] Verify integrity before leasing the next command.
- [ ] Add retention, size, permission, and secret-scanning policy hooks.

### Tests

- [x] Cross-node rejection even when workspace IDs and policies match.
- [ ] Artifact transfer integrity, authorization, size-limit, and cleanup
  tests.
- [ ] Handoff recovery after either node or backend restart.

### Exit criteria

- Multi-agent workflows cannot span daemon nodes.
- Failures identify the node-scope violation clearly.

## Phase 5 — Employee and admin experience cutover

### Objective

Make agents primary in the product while retaining infrastructure operations.

### Employee experience

- [ ] Replace executor-kind/node selectors with named logical-agent selectors.
- [ ] Show role, executor kind, readiness, busy state, and actionable failure
  reason.
- [ ] Hide node identity in normal workflows; expose it in run diagnostics.
- [ ] Update conversations, tasks, routines, mentions, and handoff controls to
  use `agentId`.
- [ ] Preserve familiar provider icons as secondary executor-kind indicators.

### Admin experience

- [ ] Add top-level Agents navigation.
- [ ] Change People view from owned nodes to owned/shared agents.
- [ ] Rename Nodes to Runtime Nodes and focus it on infrastructure health,
  capacity, capabilities, placements, and managed-node linkage.
- [ ] Add placement move, drain, retry, and failure diagnostics.
- [ ] Create agents independently from node provisioning.
- [ ] Create managed nodes as capacity independently from employees.

### Chat integrations and TUI

- [ ] Resolve mentions and commands to logical agent IDs.
- [ ] Define ambiguity handling when two agents have similar names.
- [ ] Retain `@claude`, `@codex`, `@pi`, and `@kimi` as compatibility aliases
  for default compatibility agents.

### Tests

- [ ] Accessibility and interaction tests for agent selection and failure
  states.
- [ ] Admin placement workflows and optimistic-cache tests.
- [ ] Chat/TUI alias compatibility tests.

### Exit criteria

- Employees can complete all normal work without seeing or selecting a node.
- Administrators can trace every agent to its placements and runtime nodes.

## Phase 6 — Cutover and compatibility retirement

### Objective

Make agent-first routing authoritative and remove obsolete ownership behavior
only after evidence shows it is safe.

### Rollout

- [ ] Enable agent-first routing in shadow mode.
- [ ] Enable it for development and test installations.
- [ ] Enable it for selected employees/tenants with rollback controls.
- [ ] Monitor placement failures, legacy resolution, dispatch latency, and run
  success by agent and node.
- [ ] Make agent-first routing the default.

### Cleanup gates

- [ ] Stop creating new sessions without `agentId`.
- [ ] Stop deriving employee agent lists from node health maps.
- [ ] Remove employee-to-node uniqueness and ownership assumptions from web
  helpers and backend selection.
- [ ] Deprecate node-level role defaults after migration to agent policy.
- [ ] Deprecate legacy daemon capability fields only after the minimum daemon
  version is enforced.
- [ ] Retain executor-kind fields in historical events indefinitely.

### Exit criteria

- Legacy assignment resolution is unused for the agreed deprecation window.
- No supported daemon depends on the legacy capability contract.
- Rollback has been exercised before compatibility code is removed.

## Cross-cutting observability

- [ ] Metrics: logical agents by state, placements by state/reason, placement
  selection latency, candidates rejected by reason, runs by agent/placement,
  node-scope rejections, and legacy-resolution count.
- [ ] Logs: agent ID, placement ID, node ID, session ID, task ID, and run ID;
  never log instructions containing secrets or raw credentials.
- [ ] Admin activity events for agent and placement mutations.
- [ ] Health diagnostics distinguish logical-agent policy, placement, runtime,
  capability, workspace, and capacity failures.

## Security review checklist

- [ ] Employee authorization is checked before placement discovery results are
  exposed.
- [x] Reject non-empty agent policy fields until enforcement exists; once
  implemented, policy may only reduce the employee's effective authority.
- [ ] Placement mutation requires administrator authority.
- [x] Daemon registration cannot self-assign employee ownership. The backend
  may materialize compatibility agents only from a node ownership assignment
  already authorized in the control plane.
- [ ] Agent configuration secrets use server-side references and short-lived
  runtime delivery.
- [ ] Run audit records preserve effective agent and policy versions.
- [ ] Cross-node artifacts enforce tenant, employee, task, and retention scope.

## Final acceptance scenarios

- [ ] Alice owns `Researcher` (Claude), `Builder` (Codex), and `Reviewer`
  (Claude).
- [ ] The three agents are placed on one runtime node before being assembled
  into a team.
- [ ] Alice selects agents by name and completes a three-step workflow without
  selecting a node.
- [ ] One Claude node fails; only its placement becomes unavailable, and the
  other Claude agent continues working.
- [ ] A replacement placement resumes future work without changing agent or
  session identity.
- [ ] Bob cannot discover or invoke Alice's agents or placements.
- [ ] An old client using `{agent: "codex"}` still resolves to Alice's
  compatibility agent during the migration window.
- [ ] A cross-node workflow is rejected before command enqueue with an
  actionable error even when workspace identities match.
