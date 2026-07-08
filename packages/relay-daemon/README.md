# Relay Daemon Node

`relay-daemon` is the agent-box side service. It registers one daemon node with
the Relay backend, polls for commands, runs agent CLIs in the configured
workspace, streams output back to the backend, and reports terminal run status.

## Agent-Box Environment Contract

Required:

- `RELAY_BACKEND_URL`: backend base URL, for example `http://127.0.0.1:8790`.
- `RELAY_SANDBOX_ID`: daemon node id provisioned by the backend.
- `RELAY_DAEMON_NODE_TOKEN`: daemon node token issued for that node.
- `RELAY_WORKSPACE` or `WORKSPACE`: host workspace path mounted into or owned by
  the agent box.

Optional:

- `RELAY_EMPLOYEE_ID`: employee id bound to this daemon node when preassigned.
- `RELAY_SANDBOX_MODE`: defaults to `boxlite`, where the daemon boots and owns a
  BoxLite VM. Set `none` only when the daemon already runs inside an agent box.
- `RELAY_USE_LOCAL_AGENT_HOME`: set to `1` in local mode to use this user's
  existing Claude/Codex/Kimi login and config directories.
- `RELAY_DAEMON_HEARTBEAT_MS`: registration heartbeat interval.
- `RELAY_DAEMON_COMMAND_POLL_WAIT_MS`: long-poll wait for command requests
  (capped at 25 seconds).
- `RELAY_DAEMON_COMMAND_LEASE_SECONDS`: command lease duration requested from
  the backend. Defaults to the run timeout plus 60 seconds, capped at one hour.
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
modes: only one can run in the workspace at a time. `ask` mode can run
concurrently up to the configured ask capacity so lightweight conversations do
not block each other.
