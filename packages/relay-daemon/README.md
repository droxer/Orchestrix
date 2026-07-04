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
- `RELAY_SANDBOX_MODE`: `none` when the daemon already runs inside an agent box,
  or `boxlite` when it should boot and own a BoxLite VM.
- `RELAY_USE_LOCAL_AGENT_HOME`: set to `1` in local mode to use this user's
  existing Claude/Codex/Kimi login and config directories.
- `RELAY_DAEMON_HEARTBEAT_MS`: registration heartbeat interval.
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

Run a local daemon against a specific host workspace using the user's installed
Claude, Codex, and Kimi CLIs:

```sh
relay-daemon \
  --backend-url "$RELAY_BACKEND_URL" \
  --sandbox-id "$RELAY_SANDBOX_ID" \
  --token "$RELAY_DAEMON_NODE_TOKEN" \
  --sandbox none \
  --workspace "$RELAY_WORKSPACE" \
  --use-local-agent-home
```

The daemon intentionally runs one active command at a time. If a backend sends a
second distinct `run.start` while the node is busy, the daemon reports that
command as failed instead of starting parallel agent work in the same workspace.
