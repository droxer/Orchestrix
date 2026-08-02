# Relay Daemon Node

`relay-daemon` is the agent-box side service. It registers one daemon node with
the Relay backend, polls for commands, runs agent CLIs in the configured
workspace, streams output back to the backend, and reports terminal run status.

## Agent-Box Environment Contract

Required:

- `RELAY_BACKEND_URL`: backend base URL, for example `http://127.0.0.1:8790`.
- `RELAY_SANDBOX_ID`: daemon node id provisioned by the backend.
- `RELAY_DAEMON_NODE_TOKEN`: daemon node token issued for that node.
- `RELAY_ENROLLMENT_TOKEN`: single-use managed-node enrollment credential. On
  first start this replaces `RELAY_SANDBOX_ID` and
  `RELAY_DAEMON_NODE_TOKEN`; the backend creates the observed daemon identity
  and returns its runtime credential during enrollment.
- `RELAY_WORKSPACE` or `WORKSPACE`: node workspace root. On an employee-owned
  computer, the employee selects this existing writable directory during
  setup. On a managed cloud computer, the supervisor/provider provisions it.
  The daemon creates and reuses `<root>/<thread-id>/` for each new thread.
  Historical threads created before this layout retain the node root so an
  upgrade does not strand their existing files.

Optional:

- `RELAY_EMPLOYEE_ID`: employee id bound to this daemon node when preassigned.
- `RELAY_WORKSPACE_ID`: canonical identity for shared workspace storage. Nodes
  may use different local paths in a multi-agent workflow only when this value
  matches. The equivalent CLI option is `--workspace-id`.
- `RELAY_SANDBOX_MODE`: defaults to `boxlite`, where the daemon boots and owns a
  BoxLite VM. Set `none` for a manual/local node that runs agents in the
  daemon's current host environment, such as an employee workstation or an
  already-isolated agent box.
- `RELAY_BOXLITE_HOME`: BoxLite runtime state directory for `boxlite` mode.
  Defaults to a per-workspace directory under `~/.relay/boxlite`, isolated from
  BoxLite's global `~/.boxlite` state.
- `RELAY_AGENT_HOME`: override the home inspected by local mode. By default,
  local mode detects this user's existing Claude/Codex/Pi/Kimi installations,
  logins, skills, and MCP configuration under `HOME`.
- `RELAY_USE_LOCAL_AGENT_HOME`: deprecated compatibility flag; local mode now
  uses this user's home by default.
- `RELAY_DAEMON_LIVENESS_HEARTBEAT_MS`: optional override for the lightweight
  node-lease renewal cadence. By default the daemon uses the interval advertised
  by the backend (5 seconds with the default 15-second lease).
- `RELAY_DAEMON_HEARTBEAT_MS`: capability/inventory registration refresh
  interval. Defaults to five minutes. This is intentionally separate from the
  lightweight liveness heartbeat.
- `RELAY_DAEMON_INVENTORY_TIMEOUT_MS`: maximum time for the best-effort agent
  skill/MCP inventory scan. Defaults to 10 seconds.
- `RELAY_DAEMON_COMMAND_POLL_WAIT_MS`: long-poll wait for command requests
  (capped at 25 seconds).
- `RELAY_DAEMON_COMMAND_LEASE_SECONDS`: command lease duration requested from
  the backend. Defaults to 90 seconds and is renewed by command polls while the
  daemon still owns the run; values are capped at one hour.
- `RELAY_DAEMON_MAX_CONCURRENT_ASK_RUNS`: concurrent ask-mode capacity. Work
  modes (`action` and `review`) stay exclusive.
- `RELAY_DAEMON_SHUTDOWN_GRACE_MS`: max time to wait for active runs to report
  cancellation during shutdown.

Agent credentials:

- Codex uses `OPENAI_API_KEY` or `CODEX_API_KEY`.
- Claude uses the installed Claude CLI authentication.
- Pi uses `PI_API_KEY`, `OPENAI_API_KEY`/`CODEX_API_KEY`, or
  `ANTHROPIC_API_KEY`, plus `PI_MODEL`/`OPENAI_MODEL` when required.
- Kimi uses the installed Kimi CLI authentication.

## Operations

Run a preflight without starting the daemon loop:

```sh
relay-daemon --doctor --sandbox-id "$RELAY_SANDBOX_ID"
```

The doctor checks backend reachability, token registration, workspace
read/write access, auth file preparation, and agent CLI preflights.

Run the daemon:

```sh
relay-daemon --sandbox-id "$RELAY_SANDBOX_ID"
```

Run a daemon that is already inside an agent box against a specific workspace
using that box's installed Claude, Codex, and Kimi CLIs:

```sh
relay-daemon \
  --backend-url "$RELAY_BACKEND_URL" \
  --sandbox-id "$RELAY_SANDBOX_ID" \
  --token "$RELAY_DAEMON_NODE_TOKEN" \
  --sandbox none \
  --workspace "$RELAY_WORKSPACE" \
  --use-local-agent-home
```

The daemon has two scheduling classes. `action` and `review` are exclusive work
modes: only one can run on the computer at a time. `ask` mode can run
concurrently up to the configured ask capacity so lightweight conversations do
not block each other. New-layout runs receive their thread directory
explicitly, so concurrent new threads do not share a working directory.

## Thread workspace layout

For a local daemon configured with:

```sh
relay-daemon --sandbox none --workspace /Users/alice/RelayWorkspaces ...
```

Relay uses:

```text
/Users/alice/RelayWorkspaces/
  <thread-id>/
    agents/
      agent-<encoded-agent-id>/
```

BoxLite and cloud nodes use the same host layout. The node root is mounted at
`/workspace`, and the agent runs from `/workspace/<thread-id>`.

The backend stamps new threads with `workspaceLayout: thread`. A historical
thread without that event field runs from the configured node root for backward
compatibility. Thread-scoped live reads additionally require the daemon's
`thread-workspaces` capability; older daemons are never asked to interpret a
thread id they do not understand. The backend rejects a new thread-layout run
on an older daemon rather than weakening its isolation. Only genuinely
historical threads whose creation event has no workspace layout continue at
the node root.

## Delivery Semantics

The backend command queue uses at-least-once delivery. A command poll claims
work with a lease, and the daemon includes `leaseMode=explicit` plus each active
command id and its per-delivery lease id on later polls. Only matching deliveries are renewed. If the daemon
disconnects or restarts, unreported leases expire and the backend can redeliver
the command.

`run.start` is idempotent by command id while the daemon process is alive.
`run.cancel` remains retryable until the target run reports a terminal event;
returning a cancel command in one HTTP response is not treated as proof that it
was received. Output events are ordered and deduplicated by stream sequence,
and terminal events are retried across transient backend failures.
