# ADR-013: Isolate Workspaces by Thread on Local and Cloud Computers

## Status

Accepted. This decision refines ADR-011: collaboration remains pinned to one
daemon node, but the writable workspace is shared only by participants in the
same thread, not by every thread assigned to that node.

## Context

A daemon node previously exposed one writable directory to every run. That
made handoffs within a thread simple, but independent threads could overwrite
the same files, contend for one Git checkout, and observe unrelated work. It
also made concurrent read-only runs depend on process-global workspace state.

Relay supports two ownership models for computers:

- on an employee-owned computer, the employee chooses the workspace root while
  setting up the local daemon;
- on a cloud computer, the backend supervisor's provider adapter chooses and
  provisions the workspace root.

Agents should see the same execution contract in both models.

## Decision

The configured path is a **node workspace root**, not a thread's working
directory. The daemon creates and reuses exactly one child directory for each
thread:

```text
<configured-node-workspace-root>/<thread-id>/
```

The internal `sessionId` is the canonical thread ID and directory name. The
daemon accepts only a bounded portable identifier containing letters, digits,
dot, underscore, and hyphen; it rejects traversal, path separators, and a
symbolic-link thread directory.

The daemon owns this mapping through one interface that returns:

- `hostPath`, used for filesystem snapshots and artifact collection;
- `executionPath`, used as the agent process working directory.

For local execution (`sandbox: none`), both paths are the host thread
directory. For BoxLite execution, the daemon mounts the node root at
`/workspace` once and uses `/workspace/<thread-id>` as the execution path.
Every run passes its workspace explicitly; it does not mutate a process-global
environment variable.

Agents participating in one thread share its root. A logical agent's private
directory remains `agents/agent-<encoded-agent-id>/`, now beneath the thread
root. Generated-file paths remain thread-relative in session artifacts. A
daemon advertises the `thread-workspaces` capability so the backend can resolve
host paths correctly during rolling upgrades.

## Ownership and lifecycle

- Employee devices: the selected root remains local configuration and must
  already exist and be writable at daemon setup. Relay creates only validated
  thread children beneath it.
- Cloud computers: the supervisor/provider provisions the root and its
  persistent volume or recovery mechanism before starting the daemon.
- Daemon restart: an existing thread child is reused.
- Thread archive or deletion: directory retention and garbage collection are a
  separate policy decision; this change does not delete employee or cloud data.
- Node reassignment: ADR-011's immutable thread runtime still applies. Moving a
  thread requires an explicit checkpoint/restore design rather than path reuse.

## Consequences

- Independent threads cannot collide through their default working directory.
- All agents and handoffs in one thread retain filesystem continuity.
- Local and cloud computers use the same daemon interface despite different
  root ownership.
- The node workspace browser sees thread directories at its root.
- Live agent-home reads include a thread ID. Cross-thread agent workspace views
  use durable artifacts instead of treating the legacy node root as an agent
  home.
- Existing daemons without `thread-workspaces` retain legacy node-root behavior
  until upgraded; the backend continues to interpret their artifacts using the
  legacy root.
- A mounted node root is still visible to the BoxLite guest. This decision
  provides working-directory isolation, not a stronger per-thread VM security
  boundary; a future hard-isolation mode may mount only the selected thread.
