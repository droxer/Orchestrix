# ADR-008: BoxLite-First Lightweight Execution

## Status

Accepted for MVP and local-first execution.

## Context

Relay must support sandboxed execution for agent CLIs, code tasks, file
processing, and automation. The architecture requires multiple sandbox tiers:
restricted workers for no-code tasks, lightweight sandboxes for frequent short
tasks, Kubernetes/gVisor for medium-risk work, stronger isolation for untrusted
customer code, and long-lived workspaces for development.

The current repository already uses BoxLite for local isolated execution.

## Decision

Relay will prioritize BoxLite as the default lightweight execution boundary for
local MVP and frequent low-to-medium-risk tasks. The codebase must treat BoxLite
as an implementation of an execution-plane interface, not as the control-plane
model itself.

## Consequences

- BoxLite remains the immediate runtime for local agent CLI execution.
- New orchestration code should depend on `ExecutionManager`-style interfaces
  instead of direct BoxLite calls.
- The same control-plane semantics should later map to Kubernetes Jobs,
  gVisor, E2B/Kata, or Cloud Workstations.
- BoxLite must not own durable task/session state, approval decisions, memory,
  or long-lived secrets.
