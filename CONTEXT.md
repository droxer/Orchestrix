# Relay Orchestration

Relay coordinates employee-owned agents while keeping execution on registered
computers outside the control plane.

## Language

**Computer**:
The product-facing execution host on which agents are placed and collaborate.
_Avoid_: Machine, worker

**Daemon Node**:
The execution-plane runtime registered for one computer.
_Avoid_: Sandbox, agent

**Logical Agent**:
An employee-owned agent identity whose configuration is independent of the
computer that executes it.
_Avoid_: Executor, CLI

**Placement**:
The active binding of one logical agent to one daemon node.
_Avoid_: Assignment, deployment

**Node-scoped Team**:
A lead and member agents whose active placements all reference the same daemon
node. An unplaced agent or an agent on another node is not eligible to join.
_Avoid_: Cross-node team, shared-path team

**Thread Runtime**:
The computer selected when a thread is initialized. The selection is persisted
on the thread, cannot change after the thread starts, and bounds every agent
eligible to participate in that thread.
_Avoid_: Per-turn computer, movable thread

**Workspace Identity**:
A stable identity used to detect workspace continuity or drift for a daemon
node and its sessions. Matching workspace identities do not establish agent
co-location.
_Avoid_: Team scope, collaboration scope
