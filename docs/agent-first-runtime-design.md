# Agent-First Runtime Design

## Status

Accepted for incremental implementation. The first vertical slice is
implemented: event-sourced employee agents and placements, compatibility
materialization from existing daemon capabilities, agent-targeted dispatch,
per-assignment node placement, run audit identity, logical-agent instructions,
employee chat selection, and an admin Agents view.

PostgreSQL-backed agent/placement stores, durable task and routine assignment
by logical agent, and canonical shared-workspace identity are also implemented.
Artifact transfer, placement reconciliation, broader named-agent clients, and
compatibility retirement remain rollout work.

Implementation is staged in
[agent-first-runtime-migration.md](agent-first-runtime-migration.md).

## Summary

Employees should work with named agents. They should not need to understand
which daemon node currently runs an agent. Nodes advertise runtime capability;
the control plane places employee-owned agents on compatible nodes and selects
a healthy placement for every run.

The current relationship:

```text
employee -> daemon node -> supported agent names
```

becomes:

```text
employee -> logical agent -> placement -> daemon node
```

This permits one employee to own several agents, including multiple agents of
the same executor kind, while those agents may run on different nodes.

## Goals

- Make the logical agent the employee-facing unit of identity and selection.
- Allow an employee to own multiple agents distributed across nodes.
- Separate agent configuration and policy from runtime health and capacity.
- Route each workflow assignment to a compatible healthy placement.
- Preserve daemon-only execution, command leases, event-sourced sessions, and
  managed-node reconciliation.
- Support gradual migration without breaking existing sessions or daemons.
- Keep node details available to administrators for infrastructure operations.

## Non-goals

- Scheduling one agent run across several nodes simultaneously.
- Transparent workspace replication in the first release.
- Autoscaling provider infrastructure from queue depth in the first release.
- Allowing arbitrary executor kinds beyond `claude`, `pi`, `codex`, and `kimi`
  during this migration.
- Removing manual daemon-node registration.

## Terminology

| Term | Meaning |
| :- | :- |
| Executor kind | Runtime implementation: `claude`, `pi`, `codex`, or `kimi`. This replaces the ambiguous use of agent name for a CLI type. |
| Logical agent | Employee-owned identity with a name, executor kind, role, instructions, and policy. |
| Runtime capability | A daemon's report that it can execute an executor kind, including health and capacity. |
| Placement | Binding that allows one logical agent to execute through one runtime capability on one daemon node. |
| Placement candidate | A placement that satisfies ownership, health, policy, workspace, and capacity requirements for a run. |
| Runtime node | The observed daemon node that heartbeats and executes leased commands. |
| Managed node | Desired infrastructure resource reconciled by the supervisor. |

## Design principles

### Agent identity belongs to the control plane

A logical agent exists even when all of its placements are offline. Its name,
role, instructions, permissions, and ownership must not be derived from daemon
registration.

### Nodes advertise capabilities; they do not define employees

Daemon registration reports what the runtime can execute. Employee ownership
is attached to logical agents. A node may host placements for several agents
and, subject to policy, several employees.

### Runs target agents and record placements

New run requests target a logical agent ID. Relay selects a placement and
records both the stable logical agent ID and the actual node/placement used.
This preserves the employee-facing identity and the operational audit trail.

### Placement is replaceable

Moving an agent to another node must not change its identity or split its
conversation history. A failed node makes a placement unavailable, not the
logical agent nonexistent.

### Workspace compatibility is a scheduling constraint

Relay must not dispatch an agent to a node that cannot access the session's
workspace. The first release favors explicit workspace affinity over implicit
file copying.

## Domain model

### EmployeeAgent

`EmployeeAgent` is the durable employee-owned logical identity.

| Field | Type | Notes |
| :- | :- | :- |
| `id` | string | Stable `agent_...` identity. |
| `employeeId` | string | Owning employee. |
| `displayName` | string | Employee-facing name such as `Researcher`. |
| `executorKind` | enum | `claude`, `pi`, `codex`, or `kimi`. |
| `defaultRole` | enum | Existing Relay role vocabulary. |
| `instructions` | string, nullable | Agent-specific control-plane instructions. |
| `skillPolicy` | JSON | Allowed or required skill references. |
| `toolPolicy` | JSON | MCP/tool allowlist and approval policy. |
| `modelPolicy` | JSON | Optional model and reasoning constraints. |
| `enabled` | boolean | Disabled agents cannot receive new work. |
| `version` | integer | Incremented for placement-relevant configuration changes. |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps. |

Agent display names need only be unique within an employee. Executor kind is
not unique: an employee may own both `Researcher` and `Reviewer` using Claude.

### AgentPlacement

`AgentPlacement` binds a logical agent to an observed daemon capability.

| Field | Type | Notes |
| :- | :- | :- |
| `id` | string | Stable `placement_...` identity. |
| `agentId` | string | Logical agent. |
| `daemonNodeId` | string | Runtime node. |
| `executorKind` | enum | Must equal the logical agent executor kind. |
| `desiredState` | enum | `active`, `draining`, or `removed`. |
| `status` | enum | `pending`, `ready`, `busy`, `offline`, `incompatible`, or `failed`. |
| `priority` | integer | Lower values are preferred after hard constraints. |
| `agentVersion` | integer | Configuration version realized by this placement. |
| `workspacePolicy` | JSON | Workspace scopes accessible from this placement. |
| `conditions` | JSON array | Structured incompatibility or failure reasons. |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps. |

The initial implementation supports one placement for a logical agent. The
schema permits several placements for failover and later horizontal capacity.

### Daemon runtime capability

Daemon registration continues to report executor health, but the protocol
renames the concept from agent identity to runtime capability:

```ts
interface DaemonExecutorCapability {
  executorKind: "claude" | "pi" | "codex" | "kimi";
  status: "ready" | "failed";
  adapter: "cli" | "service";
  maxConcurrentRuns: number;
  inventory?: DaemonAgentInventory;
  configurationFingerprint?: string;
}
```

During compatibility, `supportedAgents` and the existing `agents` health map
remain accepted and are normalized into capabilities by the backend.

### Session and run additions

New assignments carry logical identity and retain executor kind for compatibility:

```ts
interface AgentAssignment {
  agentId?: string;
  agent: "claude" | "pi" | "codex" | "kimi";
  mode: "action" | "review" | "ask";
  role?: AgentRole;
}
```

Run records add:

- `logicalAgentId`
- `placementId`
- `daemonNodeId`
- `executorKind`
- `agentVersion`

Old assignments without `agentId` are resolved through a compatibility agent
owned by the session employee.

## Ownership and authorization

- An employee may use agents they own or agents explicitly shared with them.
- A non-admin cannot select an arbitrary daemon node or placement.
- Placement selection occurs only after agent authorization succeeds.
- Agent tool policy can further restrict employee permissions but cannot widen
  them.
- Administrators manage placements and runtime nodes; employees manage only
  agent settings permitted by policy.
- Audit events record the employee, logical agent, placement, daemon node,
  executor kind, and effective policy version.

## Placement and dispatch

For each assignment, the control plane:

1. Resolves `agentId`, verifies ownership/sharing, and checks that it is enabled.
2. Loads active placements matching the agent version and executor kind.
3. Rejects placements whose daemon heartbeat, executor capability, protocol,
   or policy is incompatible.
4. Rejects placements without access to the session workspace.
5. Rejects placements without capacity for the requested mode.
6. Prefers existing session affinity, then placement priority, available
   capacity, recent health, and stable placement ID.
7. Acquires or verifies the daemon command lease and dispatches the run.
8. Records the selected placement in the run event before execution begins.

Selection must return structured rejection reasons so the UI can distinguish
`agent offline`, `workspace unavailable`, `capacity exhausted`, and
`configuration pending`.

### Multi-agent workflows

Each assignment is placed independently:

```text
Researcher (Claude) @ node-a
    -> Builder (Codex) @ node-b
    -> Reviewer (Claude) @ node-c
```

The session remains the durable workflow authority. Handoff data is carried by
session events and artifacts, not by node-local process memory.

## Workspace policy

The first release defines three explicit workspace compatibility modes:

| Mode | Behavior |
| :- | :- |
| `node-affine` | Session remains on placements attached to the original workspace/node. |
| `shared-path` | Placements may run when they advertise the same canonical shared workspace ID. |
| `artifact-handoff` | Cross-node steps receive declared input artifacts and publish output artifacts; arbitrary untracked files are not assumed. |

`node-affine` is the safe compatibility default. `shared-path` may be enabled
for verified shared storage. `artifact-handoff` is introduced after artifact
transfer integrity and size limits are implemented.

## Managed-node relationship

Managed nodes remain infrastructure desired state. Employee ownership is
removed from their core identity over time:

- `ManagedNode.employeeId` becomes an optional placement-policy hint.
- the one-dedicated-node-per-employee constraint is removed;
- managed nodes declare capacity, locality, and workspace policy;
- agent placements decide which employee agents use that capacity;
- pooled nodes become useful once placements can target them.

The supervisor continues to reconcile infrastructure only. It must not create
logical agents or decide employee authorization.

## API direction

### Employee agents

- `GET /agents` — agents visible to the authenticated employee.
- `POST /cp/employees/{employeeId}/agents` — create a logical agent.
- `GET /cp/agents/{agentId}` — admin detail including placements.
- `PATCH /cp/agents/{agentId}` — update configuration or desired state.
- `DELETE /cp/agents/{agentId}` — disable and retire after active runs drain.

### Placements

- `POST /cp/agents/{agentId}/placements`
- `PATCH /cp/agent-placements/{placementId}`
- `DELETE /cp/agent-placements/{placementId}`
- `GET /cp/agent-placements?agentId=&nodeId=`

### Runtime nodes

Existing daemon-node APIs remain operational. Employee-facing responses stop
using daemon node as the primary selectable resource.

### Runs

New clients send `agentId`. During migration, the backend also accepts the
legacy `agent` executor kind and resolves a compatibility logical agent.

## User experience

### Employee

The primary selector lists named agents with role and availability:

```text
Researcher       Ready
Builder          Busy
Reviewer         Offline
```

Node identity is hidden by default. Diagnostics may show `Runs on node-a` and
placement failure detail when useful.

### Administrator

The control panel separates:

- **People** — employees and their logical agents;
- **Agents** — identity, policy, configuration, availability, and placements;
- **Runtime Nodes** — infrastructure, capabilities, capacity, and health.

Agent availability is derived from placements. Runtime-node health is not
presented as employee ownership.

## Compatibility and migration rules

- Existing `AgentName` remains the executor-kind type until a later rename.
- Existing sessions and tasks without `agentId` remain executable.
- One compatibility agent is created per `(employeeId, executorKind)` observed
  in existing assignments or assigned daemon capabilities.
- Existing node-level disabled-agent and role-default settings remain enforced
  until equivalent placement/agent policy is materialized.
- Daemons can upgrade independently because the backend accepts both old
  health maps and new capability records during the compatibility window.
- No event history is rewritten. New identity links are appended or stored in
  derived compatibility mappings.

## Success criteria

- One employee can own multiple logical agents, including two of the same
  executor kind.
- Those agents can be placed on different daemon nodes.
- Employees select agents without selecting nodes.
- Every run records logical agent, placement, runtime node, and executor kind.
- A node outage makes only its placements unavailable and does not remove
  logical agents or history.
- Legacy sessions, clients, and daemons continue to operate during rollout.
- Cross-node dispatch never occurs without a compatible workspace policy.
