# ADR-009: Durable Control Plane Outside Sandbox

## Status

Accepted.

## Context

Relay's target architecture separates the control plane from the execution
plane. The control plane owns tenants, users, workspaces, tasks, sessions,
assignments, approvals, policy decisions, audit, and durable workflow state. The
execution plane runs untrusted commands and agent CLIs in isolated environments.

Putting workflow authority inside the sandbox would make cancellation,
approval, audit, retries, memory writeback, and future Temporal migration harder
to reason about.

## Decision

The durable Relay daemon and future cloud control plane must run outside the
sandbox. A sandbox may run only a minimal guest worker for approved command
execution, stream forwarding, exit-status reporting, and scoped local file
operations.

## Consequences

- `SessionController` remains the local durable orchestration boundary.
- Workflow state changes continue to flow through append-only task/session
  events.
- Sandbox guest workers cannot grant permissions, approve actions, own memory,
  or persist canonical session state.
- Future API execution endpoints must route through the same controller and
  daemon execution-manager boundary used by current API dispatch.
