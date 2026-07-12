# Agent Home Workspace — Design

_Date: 2026-07-11 · Revised: 2026-07-12 (as-built) · Status: implemented._
_Scope: workspace runtime model (daemon + backend) and `AgentWorkspacePage` (web)._

## Context & motivation

Relay is inverting to an agent-first domain model (see
`docs/agent-facing-product-design.md`). The workspace was the last
employee/infrastructure-rooted concept in the product: an agent's files were
"a corner of some node's mount" — the node owned `workspaceId`/`workspacePath`,
agents got namespaced subdirs, and the backend browsed files by walking the
node's filesystem directly, which only worked when the backend and daemon
shared a filesystem.

Decisions locked during brainstorming (all shipped):

- **Agent-private home** — every agent owns exactly one workspace; no shared
  workspaces, no workspace entity, no ACLs. Collaboration stays in artifacts
  and session handoffs.
- **Logical home, artifact durability** — the home is a stable logical
  identity materialized per node; artifacts are the durable record. No
  file-transfer machinery on re-placement.
- **Read path via daemon commands** — file browsing/reading is routed through
  the agent's placement like runs; the backend stays a pure control plane.
- **UI: inspection + home status** — keep the inspection surface, add a thin
  live-vs-snapshot status line.

## 1. Concept

A **home workspace** is a property of the logical agent, not of any node.
Every agent has exactly one. Its identity is the agent id — there is no
separate workspace entity.

- **Logical home**: durable, exists even when the agent has no placement.
- **Materialization**: when a placement runs the agent, the daemon
  materializes the home as `agents/agent-<b64url(agentId)>/` (base64url, no
  padding — `agentWorkspaceSubpath` in
  `packages/relay-daemon/src/agent-workspace.ts`) under the node's workspace
  mount. Every run carries `logicalAgentId`; the subdir is unconditional.
- **Durability contract**: files are node-local and best-effort; **artifacts
  are the durable record**. On re-placement the agent starts with an empty
  home; everything indexed as a `workspace_file` artifact (the backend keeps
  content snapshots) remains browsable forever through the snapshot fallback.
- The node-level `workspaceId`/`workspacePath` identity and the
  `node-affine`/`shared-path` scheduling constraint remain, but they are pure
  infrastructure vocabulary and are never surfaced in the product UI.

## 2. Read path — workspace as a daemon capability

### Protocol (`packages/relay-core/src/daemon-node-protocol.ts`)

Two command types alongside `run.start`/`run.cancel` (both carry the standard
lease fields `leaseId`/`leaseExpiresAt`/`attempt`):

- `DaemonWorkspaceListCommand`
  `{ id, type: "workspace.list", agentId, path }` — `path` is relative to the
  agent home; `""` lists the home root.
- `DaemonWorkspaceReadCommand`
  `{ id, type: "workspace.read", agentId, path }`

Three result events, correlated by `commandId`:

- `workspace.listing`
  `{ commandId, agentId, path, exists, entries: DaemonWorkspaceEntry[] }` —
  `exists: false` with empty entries when the directory has not been
  materialized; entries are
  `{ name, path, kind: "directory" | "file", bytes (null for directories), updatedAt }`,
  sorted directories-first then case-insensitively by name. Symlinks and
  special files are skipped.
- `workspace.file`
  `{ commandId, agentId, path, bytes, isBinary, truncated, contentBase64? }` —
  `contentBase64` is omitted when `isBinary`; `bytes` is the full on-disk
  size even when the content window is truncated.
- `workspace.error`
  `{ commandId, agentId, path, code, message }` with
  `code: "invalid-path" | "not-found" | "is-directory" | "io-error"`.

Rules:

- The daemon resolves paths **only inside** `agents/agent-<b64>/`
  (`packages/relay-daemon/src/workspace-read.ts`); traversal is rejected
  daemon-side (`invalid-path`), and the backend re-validates independently —
  the path is untrusted input on both sides.
- Read cap is 256 KiB (`WORKSPACE_FILE_PREVIEW_LIMIT`), read from offset 0;
  larger files return the capped window with `truncated: true`. Binary
  detection: a null byte in the read window or a lossy UTF-8 decode →
  `isBinary: true`, content omitted.
- Daemons advertise `"workspace-read"` (`DAEMON_CAPABILITY_WORKSPACE_READ`)
  in `DaemonNodeCapability` at registration and post workspace events to the
  same `POST /daemon-nodes/{sandboxId}/events` route as run events.

### Backend dispatch (`backend/relay/services/workspace_query.py`)

The backend enqueues the command on the placement's node queue and awaits the
matching daemon event through an in-memory `WorkspaceQueryBroker`: one
`asyncio.Future` per command id, keyed to the serving sandbox so an event from
any other node cannot resolve it. The await timeout is 10 seconds
(`WORKSPACE_COMMAND_TIMEOUT_SECONDS`). The events route authorizes the daemon
token (`assert_node_event_authorized`) before resolving the broker.

Placement selection (`select_workspace_node` in
`backend/relay/services/agent_routing.py`): the highest-priority placement in
status `ready` or `busy` whose node advertises `workspace-read`; ties break on
placement id.

### Fallback

When the agent has no such live placement, the backend serves a virtual home
derived from the deduped newest-per-file `workspace_file` artifact snapshots
(`newest_agent_workspace_artifacts` in `backend/relay/api/helpers.py` +
`backend/relay/services/agent_workspace_snapshot.py`) and marks the response
`source: "snapshot"`. Snapshot listings synthesize directory entries one level
at a time from artifact paths inside the agent-home prefix; snapshot file
reads serve the full stored content (never truncated). The backend filesystem
walk is removed from the browse path (the bounded walk survives only as the
generated-files fallback for old daemons, per the existing invariant).

Note: the fallback triggers only when **no** live placement can serve reads.
While a placement is live, the Files tab shows the current home only; files
from earlier placements remain reachable as artifacts (the Artifacts tab and
`GET /agents/{id}/artifacts`).

### HTTP surface (agent-scoped, `backend/relay/api/agent_workspace_routes.py`)

- `GET /agents/{agentId}/workspace/files?path=` →
  `{ agentId, source: "live" | "snapshot", nodeId?, path, exists, entries, generatedAt }`
  (`nodeId` only when live; snapshot listings always report `exists: true`).
- `GET /agents/{agentId}/workspace/file?path=` →
  `{ agentId, source, nodeId?, path, exists, isBinary, bytes, content, truncated, limitBytes, generatedAt }`
  — `content` is decoded UTF-8 text (`null` when binary), not base64;
  `limitBytes` echoes the 256 KiB preview cap.
- Authorization at the existing seam: the caller must be the agent's
  supervisor (`agent_supervisor_employee_id`, which tolerates legacy
  `employeeId` snapshots) or an admin; unknown/deleted agents → 404.
- The employee-keyed `/workspace/files` and `/workspace/file` routes are
  **removed** (no compatibility layer, consistent with the inversion).
  `/workspace/brief` no longer exposes `workspacePath`.

## 3. Deletions (landed)

- Employee-rooted workspace resolution in
  `backend/relay/api/session_routes.py` (the node-chasing `workspacePath`
  guesswork).
- Backend-side directory walking as a browse path.
- Any UI copy or type that treats a workspace as belonging to an employee or a
  node (`EmployeeWorkspacePage` replaced by `AgentWorkspacePage`).

## 4. Web UI — `AgentWorkspacePage`

Keeps the inspection surface (browse pane with artifacts/files tabs +
dominant preview). The `source` field of the files response drives the home
status:

1. **Live**: `● Live · <node>` in the files bar next to the path breadcrumb
   (node id is dim diagnostic metadata, `workspace-home-node`).
2. **Snapshot**: a dismissible explainer banner (`SnapshotBanner`) on first
   load; once dismissed it collapses to the compact
   `○ Snapshot · agent offline` status chip. The Files tab then lists
   snapshot files only, with the `workspace.no_files_yet` empty state
   ("This agent hasn't produced files yet.") when none exist.
3. **Data source**: `web/src/api.ts` `listAgentWorkspaceFiles` /
   `readAgentWorkspaceFile` keyed by `agentId`; queries keyed
   `["agent-workspace", agentId, path]` / `["agent-workspace-file", agentId, path]`.

Empty states obey the agent-facing rule: never mention nodes, sandboxes, or
provisioning.

## 5. Error handling

- Daemon timeout on a workspace command → 503 with structured reason
  `placement-unavailable`; the UI shows the error state with a retry
  affordance (`workspace.retry`) — it does **not** silently fall back to the
  snapshot view, since a stale answer would misrepresent a live-but-slow home.
- Daemon `workspace.error` mapping: `not-found` → 404, `is-directory` → 400,
  `invalid-path` → 400, `io-error`/unknown → 502.
- Backend pre-validation: absolute or upward-traversing paths → 400; missing
  `path` on the file endpoint → 400; snapshot file misses → 404.
- Oversize/binary content → `truncated`/`isBinary` flags, never a hard error.

## 6. Testing (as landed)

- **Daemon** (`packages/relay-daemon/tests/daemon.test.ts`): `workspace-read`
  module list/read behavior, path-traversal rejection, read cap + binary
  detection, and an end-to-end poll→event round trip including the
  capability at registration and `workspace.error` on traversal.
- **Backend**: `backend/tests/unit/test_workspace_query.py` (broker),
  `backend/tests/unit/test_agent_workspace_snapshot.py` (virtual listing/file),
  `backend/tests/api/test_agent_workspace.py` (authz — supervisor ok,
  unrelated employee 403, admin ok; live dispatch through a placement;
  snapshot fallback; timeout → 503; traversal/missing errors).
- **Web** (`web/tests/api.test.ts`): `listAgentWorkspaceFiles` /
  `readAgentWorkspaceFile` URL construction and error mapping against the
  agent-scoped endpoints. The status line and snapshot banner are exercised
  manually; there is no component test for `AgentWorkspacePage` yet.

## Risks & follow-ups

- **Command round-trip latency**: browsing goes through the daemon poll loop;
  acceptable for an inspection surface, and the snapshot fallback bounds the
  offline case. If polling cadence ever hurts, the broker seam is where a
  push channel would slot in.
- **Two-sided path validation drift**: daemon and backend each validate
  paths; both are covered by tests so neither silently becomes the only
  guard.
- **Live view hides prior-placement files**: deliberate — the home is the
  current placement's materialization; history lives in artifacts. Revisit
  only if users conflate the two surfaces.
- **Removed employee routes**: any straggler client of `/workspace/files`
  breaks loudly — intended, pre-production.
