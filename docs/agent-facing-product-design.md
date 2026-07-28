# Agent-Facing Product Design

## Decision

Relay is an agent-facing product. An employee uses named agents to do work;
employees do not operate executors, sandboxes, placements, or nodes.

```text
employee (identity and ownership)
  -> agent (product identity and policy)
    -> placement (scheduler decision)
      -> node (execution infrastructure)
```

The arrow is a dependency boundary, not a navigation hierarchy. Only the first
two concepts belong in the everyday product. Placements and nodes belong to
infrastructure administration and operational audit records.

## Product model

### Employee

An employee is the authenticated principal, owner, and authorization boundary.
It answers “who may see or change this?” It is not a runtime target and should
not be a selector in the employee experience.

### Agent

An agent is the primary employee-facing object and a capability hosted by a
node. Relay materializes a stable ID for each employee/node agent capability so
threads and assignments do not use node IDs, but administrators do not create
agents separately. Starting or assigning a node publishes its available agents.

### Placement

A placement is an internal scheduling relationship between an agent and a
compatible node capability. The control plane selects it for every run. It is
visible only to administrators diagnosing capacity or availability.

### Node

A node is infrastructure. It heartbeats, advertises executor capabilities,
leases commands, and owns a sandbox. It never defines an employee or an agent.

## Information architecture

Employee navigation:

1. **Threads** — conversations with an agent; every new thread starts with an
   explicit agent.
2. **Agent workspace** — artifacts and files in the active agent context.
3. **Backlog** — work assigned to agents. Employee ownership is derived from
   the selected agent.
4. **Routines** — recurring work assigned to agents.

Administrator navigation:

1. **Employees** — identity, access, departments, and owned agents.
2. **Agents** — read-only inventory derived from node capabilities and availability.
3. **Infrastructure** — nodes, capabilities, capacity, heartbeats, and leases.
4. **Channels** — external identity mapping and the default named agent.

No employee-facing empty state may offer to provision a node or sandbox. It
must say that no agent is configured or no placement is currently available.

## Interaction contracts

- A new run requires `agentId`. Executor kind is agent configuration, not a run
  identity.
- A conversation records `agentId`; node and placement IDs are audit metadata.
- Continuing, retrying, rerunning, and handing off always resolve a logical
  agent. They never fall back to direct sandbox execution.
- Selecting an assignee selects an agent. `assigneeEmployeeId` is derived from
  the agent owner and cannot conflict with it.
- A routine requires an assigned agent before it can dispatch.
- A channel identity may resolve a default agent, and users may address another
  permitted named agent. Sandbox IDs are not part of channel commands.
- Agent availability is the aggregate of eligible placements. Node health is
  not rendered as the agent's identity.

## API boundaries

Canonical employee APIs use `/api/v1/agents`, `/api/v1/agent-runs`,
`/api/v1/threads`, and agent-scoped work and workspace resources. Direct
`/api/v1/sandboxes/{id}/runs` endpoints are compatibility-only: they are not called by
the web product, are excluded from new clients, and should be removed after the
daemon migration.

The backend remains the control plane and never executes an agent. Dispatch is:

```text
agent run request
  -> authorize employee ownership
  -> resolve agent policy and workspace
  -> select healthy placement
  -> queue daemon command
  -> record agent + placement + node in session events
```

## State ownership

- Authentication state owns the current employee. There is no
  `selectedEmployee` in the employee product.
- Shell state owns `activeAgentId` and `activeSessionId`.
- Server state owns agents, sessions, tasks, routines, placements, and nodes.
- Browser storage must not hold per-node tokens for the normal employee flow.
- Agent behavior comes from the agent runtime on its node. Relay does not assign
  default roles or expose a separate create-agent workflow.

## Migration rules

1. New writes require logical agent identity.
2. Legacy executor/sandbox fields may be read for old records but are not shown
   as primary UI or accepted by new employee workflows.
3. Compatibility materialization must produce explicit agents before an
   employee can dispatch; the UI must not synthesize infrastructure.
4. Chat clients migrate from executor/sandbox options to named agent options
   before direct sandbox run endpoints are retired.
5. Tests assert the boundary: deleting an employee disables its agents;
   cross-employee dispatch is forbidden; placement changes preserve agent
   history; no employee page requires a node ID.

## Completion criteria

The redesign is complete when an employee can use every page without seeing or
supplying a node, sandbox, placement, executor kind, or infrastructure token;
and an administrator can move an agent between nodes without changing its
threads, tasks, routines, artifacts, channel identity, or workspace link.
