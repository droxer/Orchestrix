# Agent Home Workspace — Design

_Date: 2026-07-11 · Scope: workspace runtime model (daemon + backend) and `AgentWorkspacePage` (web)._

## Context & motivation

Relay is inverting to an agent-first domain model (see
`docs/agent-facing-product-design.md` and the in-flight re-anchor plan). The
workspace is the last employee/infrastructure-rooted concept in the product:
today an agent's files are "a corner of some node's mount" — the node owns
`workspaceId`/`workspacePath`, agents get namespaced subdirs, and the backend
browses files by walking the node's filesystem directly, which only works when
the backend and daemon share a filesystem.

Decisions locked during brainstorming:

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
  materializes the home as `agents/agent-<b64url(agentId)>/` under the node's
  workspace mount (the existing `packages/relay-daemon/src/agent-workspace.ts`
  mechanism, made unconditional — every run carries `logicalAgentId`).
- **Durability contract**: files are node-local and best-effort; **artifacts
  are the durable record**. On re-placement the agent starts with an empty
  home; everything indexed as a `workspace_file` artifact (the backend already
  keeps content snapshots) remains browsable forever.
- The node-level `workspaceId`/`workspacePath` identity and the
  `node-affine`/`shared-path` scheduling constraint remain, but they are pure
  infrastructure vocabulary and are never surfaced in the product UI.

## 2. Read path — workspace as a daemon capability

### Protocol (`packages/relay-core/src/daemon-node-protocol.ts`)

Two new command types alongside `run`/`cancel`, with result events:

- `workspace.list` `{ commandId, agentId, path }` →
  `workspace.listing` event
  `{ commandId, entries: [{ name, path, isDirectory, bytes, modifiedAt }] }`
- `workspace.read` `{ commandId, agentId, path }` →
  `workspace.file` event
  `{ commandId, content (base64, capped), isBinary, truncated, bytes }`

Rules:

- The daemon resolves paths **only inside** `agents/agent-<id>/`; traversal is
  rejected daemon-side, and the backend re-validates independently — the path
  is untrusted input on both sides.
- Read cap is the existing 256 KiB workspace preview limit. Binary detection: null
  byte in the read window or UTF-8 decode failure → `isBinary: true`, content
  omitted.
- Daemons advertise a new `workspace-read` value in `DaemonNodeCapability` at
  registration.
- The backend queues the command through the agent's healthy placement
  (existing lease/poll loop) and awaits the matching event with a 10-second
  timeout (constant `WORKSPACE_COMMAND_TIMEOUT_SECONDS`).

### Fallback

When the agent has no live placement, or its placement's daemon lacks the
`workspace-read` capability, the backend serves the deduped `workspace_file`
artifact snapshot index instead and marks the response `source: "snapshot"`.
The backend filesystem walk is removed from the browse path (the bounded walk
survives only as the generated-files fallback for old daemons, per the
existing invariant).

### HTTP surface (agent-scoped)

- `GET /agents/{agentId}/workspace/files?path=` →
  `{ source: "live" | "snapshot", entries, placementId?, generatedAt }`
- `GET /agents/{agentId}/workspace/file?path=` → same envelope plus
  `content`, `isBinary`, `truncated`, `bytes`, `limitBytes`
- Authorization at the existing seam: the caller must supervise/own the agent
  or be an admin.
- The employee-keyed `/workspace/files` and `/workspace/file` routes are
  **removed** (no compatibility layer, consistent with the inversion).

## 3. Deletions

- Employee-rooted workspace resolution in
  `backend/relay/api/session_routes.py` (the node-chasing `workspacePath`
  guesswork around lines 124–153).
- Backend-side directory walking as a browse path.
- Any UI copy or type that treats a workspace as belonging to an employee or a
  node.

## 4. Web UI — `AgentWorkspacePage`

Keep the current inspection surface (browse pane with artifacts/files tabs +
dominant preview). Two changes:

1. **Home status line** in the pane header — one small element, not a panel:
   - `● Live · <node>` when served by a placement (node name is dim diagnostic
     metadata).
   - `○ Snapshot · agent offline` when serving artifact snapshots; the Files
     tab then lists snapshot files only, with a short explainer empty-state if
     none exist.
2. **Data source swap**: `web/src/api.ts` gains `listAgentWorkspaceFiles` /
   `readAgentWorkspaceFile` keyed by `agentId`; queries keyed
   `["agent-workspace", agentId, path]`. The `source` field drives the status
   line. No other layout change.

Empty states obey the agent-facing rule: never mention nodes, sandboxes, or
provisioning — "This agent hasn't produced files yet."

## 5. Error handling

- Daemon timeout on a workspace command → 503 with structured reason
  `placement-unavailable`; the UI falls back to the snapshot view with a retry
  affordance.
- Path traversal → 400; missing file → 404; directory passed to `file` → 400.
  Validated on both daemon and backend.
- Oversize/binary content → `truncated`/`isBinary` flags, never a hard error.

## 6. Testing

- **Daemon** (`packages/relay-daemon/tests/daemon.test.ts`): list/read command
  handling, path-traversal rejection, read cap + binary behavior, capability
  advertised at registration.
- **Backend** (`backend/tests/`): agent-scoped endpoints — authz (supervisor
  ok, unrelated employee 403, admin ok), live dispatch through a placement,
  snapshot fallback when offline or capability missing, timeout → 503,
  traversal/missing/directory errors.
- **Web** (`web/tests/`): status line live vs snapshot, snapshot-only Files
  tab, existing selection/preview tests re-keyed to `agentId`.

## 7. Sequencing

This is a reshaped **Phase 4b** of the in-flight agent-first re-anchor plan:
it depends on Phase 1 (agent ids) and pairs with Phase 4 (per-node tokens,
unconditional per-agent subdirs); the UI change lands with Phase 5.

## Risks

- **Command round-trip latency**: browsing goes through the daemon poll loop;
  acceptable for an inspection surface, and the snapshot fallback bounds the
  worst case.
- **Two-sided path validation drift**: daemon and backend each validate paths;
  tests must cover both so neither silently becomes the only guard.
- **Removed employee routes**: any straggler client of `/workspace/files`
  breaks loudly — intended, pre-production.
