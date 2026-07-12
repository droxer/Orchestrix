# Agent Home Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace an agent-owned concept: the daemon serves agent-home file listing/reading via new `workspace.list`/`workspace.read` commands, the backend exposes agent-scoped workspace endpoints with an artifact-snapshot fallback, and `AgentWorkspacePage` shows a live-vs-snapshot home status line.

**Architecture:** New request/response daemon commands ride the existing command-queue/poll loop; the backend holds an `asyncio.Future` per command id (a broker) resolved when the daemon posts the matching event. When no live placement with the `workspace-read` capability exists, the backend serves a virtual listing derived from the deduped `workspace_file` artifact snapshots. The old employee-rooted `/workspace/files` + `/workspace/file` endpoints and the backend filesystem walk are removed.

**Tech Stack:** TypeScript (relay-core protocol types, relay-daemon, Next.js web), Python/FastAPI backend, `node --test`, pytest.

**Spec:** `docs/superpowers/specs/2026-07-11-agent-home-workspace-design.md`

## Global Constraints

- **Do NOT create git commits** (user rule). Leave all changes uncommitted; there are no commit steps in this plan.
- Read cap: `WORKSPACE_FILE_PREVIEW_LIMIT = 256 * 1024` bytes (reuse the existing constant value).
- Daemon command await timeout: `WORKSPACE_COMMAND_TIMEOUT_SECONDS = 10`.
- New daemon capability string: `"workspace-read"`.
- Agent home subdir: `agents/agent-<base64url(agentId, no padding)>/` under the node workspace root — must match `agentWorkspaceSubpath` in `packages/relay-daemon/src/agent-workspace.ts` and `managed_agent_workspace_subpath` in `backend/relay/api/session_routes.py`.
- Path traversal is validated on **both** daemon and backend; the path is untrusted input on both sides.
- Employee-facing copy must never mention nodes, sandboxes, or provisioning.
- TypeScript tests run against built JS: `npm run build` (or `make build-packages` for packages only), then `node --test dist/...`.
- Backend tests: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest <path> -q` from the repo root.
- Immutability: all snapshot/session mutations return new objects; never mutate store snapshots in place.

---

### Task 1: Protocol types — workspace commands, events, capability (relay-core)

**Files:**
- Modify: `packages/relay-core/src/daemon-node-protocol.ts`

**Interfaces:**
- Consumes: existing `DaemonNodeCommand`, `DaemonNodeEvent`, `DaemonNodeCapability` types.
- Produces (used by Tasks 2, 3, and mirrored by the backend):
  - `DAEMON_CAPABILITY_WORKSPACE_READ: DaemonNodeCapability` (value `"workspace-read"`)
  - `DaemonWorkspaceEntry { name, path, kind: "directory" | "file", bytes: number | null, updatedAt: string }`
  - `DaemonWorkspaceListCommand { id, type: "workspace.list", agentId, path, leaseId?, leaseExpiresAt?, attempt? }`
  - `DaemonWorkspaceReadCommand { id, type: "workspace.read", agentId, path, leaseId?, leaseExpiresAt?, attempt? }`
  - Events `workspace.listing`, `workspace.file`, `workspace.error` (shapes below)

- [ ] **Step 1: Add the types**

In `packages/relay-core/src/daemon-node-protocol.ts`, extend the capability union and constant block (after line 59):

```ts
export type DaemonNodeCapability = "generated-files" | "workspace-read";
export const DAEMON_CAPABILITY_GENERATED_FILES: DaemonNodeCapability = "generated-files";
/** The daemon can serve agent-home file listings and reads via
 * workspace.list / workspace.read commands. */
export const DAEMON_CAPABILITY_WORKSPACE_READ: DaemonNodeCapability = "workspace-read";
```

After `DaemonNodeCancelCommand`, add:

```ts
/** One entry in an agent-home directory listing. */
export interface DaemonWorkspaceEntry {
  name: string;
  /** Path relative to the agent home (posix separators). */
  path: string;
  kind: "directory" | "file";
  bytes: number | null;
  updatedAt: string;
}

export interface DaemonWorkspaceListCommand {
  id: string;
  type: "workspace.list";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  agentId: string;
  /** Relative path within the agent home; "" lists the home root. */
  path: string;
}

export interface DaemonWorkspaceReadCommand {
  id: string;
  type: "workspace.read";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
  agentId: string;
  path: string;
}

export type DaemonWorkspaceErrorCode = "invalid-path" | "not-found" | "is-directory" | "io-error";
```

Extend the command union:

```ts
export type DaemonNodeCommand =
  | DaemonNodeRunCommand
  | DaemonNodeCancelCommand
  | DaemonWorkspaceListCommand
  | DaemonWorkspaceReadCommand;
```

Append three members to the `DaemonNodeEvent` union:

```ts
  | {
      type: "workspace.listing";
      commandId: string;
      leaseId?: string;
      agentId: string;
      path: string;
      exists: boolean;
      entries: DaemonWorkspaceEntry[];
    }
  | {
      type: "workspace.file";
      commandId: string;
      leaseId?: string;
      agentId: string;
      path: string;
      bytes: number;
      isBinary: boolean;
      truncated: boolean;
      /** Base64 content; omitted when isBinary. */
      contentBase64?: string;
    }
  | {
      type: "workspace.error";
      commandId: string;
      leaseId?: string;
      agentId: string;
      path: string;
      code: DaemonWorkspaceErrorCode;
      message: string;
    };
```

- [ ] **Step 2: Verify the packages still compile**

Run: `make build-packages`
Expected: exits 0. (Types only; runtime behavior is tested in Tasks 2–3.)

---

### Task 2: Daemon workspace-read module

**Files:**
- Create: `packages/relay-daemon/src/workspace-read.ts`
- Test: `packages/relay-daemon/tests/daemon.test.ts` (append tests)

**Interfaces:**
- Consumes: `agentWorkspaceSubpath(agentId)` from `packages/relay-daemon/src/agent-workspace.ts`; `DaemonWorkspaceEntry`, `DaemonWorkspaceErrorCode` from relay-core.
- Produces (used by Task 3):
  - `class WorkspaceReadError extends Error { code: DaemonWorkspaceErrorCode }`
  - `listAgentWorkspace(workspaceRoot: string, agentId: string, relativePath: string): { path: string; exists: boolean; entries: DaemonWorkspaceEntry[] }`
  - `readAgentWorkspaceFile(workspaceRoot: string, agentId: string, relativePath: string, limitBytes?: number): { path: string; bytes: number; isBinary: boolean; truncated: boolean; contentBase64?: string }`

- [ ] **Step 1: Write failing tests**

Append to `packages/relay-daemon/tests/daemon.test.ts` (it already imports `mkdtempSync`, `rmSync`, `tmpdir`, `join`; add `writeFileSync`, `mkdirSync` to the `node:fs` import and import the new module):

```ts
import { listAgentWorkspace, readAgentWorkspaceFile, WorkspaceReadError } from "../src/workspace-read.js";

test("listAgentWorkspace lists only inside the agent home, directories first", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-ws-"));
  try {
    const home = join(root, agentWorkspaceSubpath("agent_1"));
    mkdirSync(join(home, "sub"), { recursive: true });
    writeFileSync(join(home, "report.md"), "hello");
    writeFileSync(join(root, "outside.txt"), "secret");

    const listing = listAgentWorkspace(root, "agent_1", "");
    assert.equal(listing.exists, true);
    assert.deepEqual(
      listing.entries.map((entry) => [entry.name, entry.kind]),
      [["sub", "directory"], ["report.md", "file"]],
    );
    assert.equal(listing.entries.every((entry) => !entry.path.includes("outside")), true);

    const missing = listAgentWorkspace(root, "agent_none", "");
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.entries, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace read rejects traversal and directories, caps and detects binary", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-ws-"));
  try {
    const home = join(root, agentWorkspaceSubpath("agent_1"));
    mkdirSync(join(home, "sub"), { recursive: true });
    writeFileSync(join(home, "small.txt"), "hello");
    writeFileSync(join(home, "bin.dat"), Buffer.from([0x00, 0x01, 0x02]));
    writeFileSync(join(home, "big.txt"), "x".repeat(64));

    assert.throws(() => readAgentWorkspaceFile(root, "agent_1", "../outside.txt"),
      (error: unknown) => error instanceof WorkspaceReadError && error.code === "invalid-path");
    assert.throws(() => readAgentWorkspaceFile(root, "agent_1", "sub"),
      (error: unknown) => error instanceof WorkspaceReadError && error.code === "is-directory");
    assert.throws(() => readAgentWorkspaceFile(root, "agent_1", "nope.txt"),
      (error: unknown) => error instanceof WorkspaceReadError && error.code === "not-found");

    const small = readAgentWorkspaceFile(root, "agent_1", "small.txt");
    assert.equal(Buffer.from(small.contentBase64 ?? "", "base64").toString("utf-8"), "hello");
    assert.equal(small.isBinary, false);
    assert.equal(small.truncated, false);

    const binary = readAgentWorkspaceFile(root, "agent_1", "bin.dat");
    assert.equal(binary.isBinary, true);
    assert.equal(binary.contentBase64, undefined);

    const capped = readAgentWorkspaceFile(root, "agent_1", "big.txt", 16);
    assert.equal(capped.truncated, true);
    assert.equal(Buffer.from(capped.contentBase64 ?? "", "base64").length, 16);
    assert.equal(capped.bytes, 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Note: `agentWorkspaceSubpath` is already imported in this test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `make build-packages` — Expected: **compile error** (`workspace-read.js` does not exist). That is the failing state for a new module.

- [ ] **Step 3: Implement the module**

Create `packages/relay-daemon/src/workspace-read.ts`:

```ts
import { lstatSync, openSync, readSync, readdirSync, closeSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { DaemonWorkspaceEntry, DaemonWorkspaceErrorCode } from "@relay/core";
import { agentWorkspaceSubpath } from "./agent-workspace.js";

const DEFAULT_READ_LIMIT_BYTES = 256 * 1024;

export class WorkspaceReadError extends Error {
  constructor(readonly code: DaemonWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceReadError";
  }
}

/** Resolve a relative path strictly inside the agent home; throws on escape. */
function resolveInsideHome(workspaceRoot: string, agentId: string, relativePath: string): { home: string; target: string } {
  const home = resolve(workspaceRoot, agentWorkspaceSubpath(agentId));
  const requested = relativePath.trim().replace(/^\/+/, "");
  const target = resolve(home, requested);
  if (target !== home && !target.startsWith(home + sep)) {
    throw new WorkspaceReadError("invalid-path", "Path escapes the agent workspace.");
  }
  return { home, target };
}

function entryTimestamp(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

export function listAgentWorkspace(
  workspaceRoot: string,
  agentId: string,
  relativePath: string,
): { path: string; exists: boolean; entries: DaemonWorkspaceEntry[] } {
  const { home, target } = resolveInsideHome(workspaceRoot, agentId, relativePath);
  const cleanPath = target === home ? "" : target.slice(home.length + 1).split(sep).join("/");
  let stats;
  try {
    stats = lstatSync(target);
  } catch {
    return { path: cleanPath, exists: false, entries: [] };
  }
  if (!stats.isDirectory()) {
    throw new WorkspaceReadError("invalid-path", "Listing target is not a directory.");
  }
  const entries: DaemonWorkspaceEntry[] = [];
  for (const name of readdirSync(target)) {
    let info;
    try {
      info = lstatSync(join(target, name));
    } catch {
      continue;
    }
    if (!info.isDirectory() && !info.isFile()) continue; // skip symlinks/devices
    entries.push({
      name,
      path: cleanPath ? `${cleanPath}/${name}` : name,
      kind: info.isDirectory() ? "directory" : "file",
      bytes: info.isDirectory() ? null : info.size,
      updatedAt: entryTimestamp(info.mtimeMs),
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.kind === "directory" ? -1 : 1,
  );
  return { path: cleanPath, exists: true, entries };
}

export function readAgentWorkspaceFile(
  workspaceRoot: string,
  agentId: string,
  relativePath: string,
  limitBytes: number = DEFAULT_READ_LIMIT_BYTES,
): { path: string; bytes: number; isBinary: boolean; truncated: boolean; contentBase64?: string } {
  const { home, target } = resolveInsideHome(workspaceRoot, agentId, relativePath);
  const cleanPath = target === home ? "" : target.slice(home.length + 1).split(sep).join("/");
  let stats;
  try {
    stats = lstatSync(target);
  } catch {
    throw new WorkspaceReadError("not-found", "Workspace file was not found.");
  }
  if (stats.isDirectory()) throw new WorkspaceReadError("is-directory", "Workspace path is a directory.");
  if (!stats.isFile()) throw new WorkspaceReadError("not-found", "Workspace path is not a regular file.");
  let raw: Buffer;
  let size: number;
  try {
    size = statSync(target).size;
    const handle = openSync(target, "r");
    try {
      raw = Buffer.alloc(Math.min(size, limitBytes));
      const read = readSync(handle, raw, 0, raw.length, 0);
      raw = raw.subarray(0, read);
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    throw new WorkspaceReadError("io-error", error instanceof Error ? error.message : String(error));
  }
  let isBinary = raw.includes(0);
  if (!isBinary) {
    // A replacement character from a lossy decode means non-UTF-8 content.
    isBinary = raw.toString("utf-8").includes("�");
  }
  return {
    path: cleanPath,
    bytes: size,
    isBinary,
    truncated: size > limitBytes,
    ...(isBinary ? {} : { contentBase64: raw.toString("base64") }),
  };
}
```

Check the actual import specifier for relay-core in `packages/relay-daemon/src/index.ts` (it may be a relative `../../relay-core/src/...` path or a workspace alias) and use the same one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/packages/relay-daemon/tests/daemon.test.js`
Expected: the two new tests PASS; all pre-existing tests still pass.

---

### Task 3: Daemon loop handles workspace commands and advertises the capability

**Files:**
- Modify: `packages/relay-daemon/src/index.ts` (command loop `else if` chain around line 411; registration `capabilities` around line 202)
- Test: `packages/relay-daemon/tests/daemon.test.ts` (append test)

**Interfaces:**
- Consumes: `listAgentWorkspace`, `readAgentWorkspaceFile`, `WorkspaceReadError` (Task 2); `DAEMON_CAPABILITY_WORKSPACE_READ` and event types (Task 1).
- Produces: daemon posts `workspace.listing` / `workspace.file` / `workspace.error` events to `POST {backendUrl}/daemon-nodes/{sandboxId}/events`, and registration includes `"workspace-read"` in `capabilities` (relied on by Task 7's placement selection).

- [ ] **Step 1: Write the failing integration test**

Append to `packages/relay-daemon/tests/daemon.test.ts`, following the `runRelayDaemon` + `fetchFn` fake-backend pattern used by "relay daemon ignores duplicate run.start commands already active":

```ts
test("relay daemon serves workspace.list and workspace.read commands", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-ws-"));
  const home = join(root, agentWorkspaceSubpath("agent_1"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "report.md"), "hello");
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  let registration: Record<string, unknown> | undefined;
  let served = false;
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: root,
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") {
        registration = await jsonBody<Record<string, unknown>>(init);
        return jsonResponse({ ok: true });
      }
      if (path.endsWith("/commands")) {
        if (!served) {
          served = true;
          return jsonResponse({ commands: [
            { id: "cmd_ls", type: "workspace.list", agentId: "agent_1", path: "" },
            { id: "cmd_read", type: "workspace.read", agentId: "agent_1", path: "report.md" },
            { id: "cmd_bad", type: "workspace.read", agentId: "agent_1", path: "../escape" },
          ] });
        }
        return jsonResponse({ commands: [] });
      }
      if (path.endsWith("/events")) {
        events.push(await jsonBody<DaemonNodeEvent>(init));
        if (events.length >= 3) stop.abort();
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  await daemon;
  rmSync(root, { recursive: true, force: true });

  assert.equal((registration?.capabilities as string[]).includes("workspace-read"), true);
  const listing = events.find((event) => event.type === "workspace.listing");
  assert.ok(listing && listing.type === "workspace.listing");
  assert.equal(listing.commandId, "cmd_ls");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["report.md"]);
  const file = events.find((event) => event.type === "workspace.file");
  assert.ok(file && file.type === "workspace.file");
  assert.equal(Buffer.from(file.contentBase64 ?? "", "base64").toString("utf-8"), "hello");
  const failure = events.find((event) => event.type === "workspace.error");
  assert.ok(failure && failure.type === "workspace.error");
  assert.equal(failure.code, "invalid-path");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/packages/relay-daemon/tests/daemon.test.js`
Expected: FAIL — no workspace events are posted (unknown command types are currently ignored), so `stop.abort()` never fires and the test times out or the capability assertion fails. If it hangs, that confirms the missing branch; proceed.

- [ ] **Step 3: Implement**

In `packages/relay-daemon/src/index.ts`:

1. Add `DAEMON_CAPABILITY_WORKSPACE_READ` to the relay-core import that already brings in `DAEMON_CAPABILITY_GENERATED_FILES`, and change the registration payload (line ~202) to:

```ts
    capabilities: [DAEMON_CAPABILITY_GENERATED_FILES, DAEMON_CAPABILITY_WORKSPACE_READ],
```

2. Import the Task 2 module:

```ts
import { listAgentWorkspace, readAgentWorkspaceFile, WorkspaceReadError } from "./workspace-read.js";
```

3. In the command loop, after the `else if (command.type === "run.cancel")` block, add:

```ts
        } else if (command.type === "workspace.list" || command.type === "workspace.read") {
          const eventUrl = `${backendUrl}/daemon-nodes/${encodeURIComponent(sandboxId)}/events`;
          let event: DaemonNodeEvent;
          try {
            if (command.type === "workspace.list") {
              const listing = listAgentWorkspace(workspacePath, command.agentId, command.path);
              event = {
                type: "workspace.listing",
                commandId: command.id,
                ...(command.leaseId ? { leaseId: command.leaseId } : {}),
                agentId: command.agentId,
                path: listing.path,
                exists: listing.exists,
                entries: listing.entries,
              };
            } else {
              const file = readAgentWorkspaceFile(workspacePath, command.agentId, command.path);
              event = {
                type: "workspace.file",
                commandId: command.id,
                ...(command.leaseId ? { leaseId: command.leaseId } : {}),
                agentId: command.agentId,
                path: file.path,
                bytes: file.bytes,
                isBinary: file.isBinary,
                truncated: file.truncated,
                ...(file.contentBase64 !== undefined ? { contentBase64: file.contentBase64 } : {}),
              };
            }
          } catch (error) {
            event = {
              type: "workspace.error",
              commandId: command.id,
              ...(command.leaseId ? { leaseId: command.leaseId } : {}),
              agentId: command.agentId,
              path: command.path,
              code: error instanceof WorkspaceReadError ? error.code : "io-error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          await postJsonWithRetry(fetchFn, eventUrl, event, token, runtimeSignal).catch((postError: unknown) => {
            logger.error("workspace event post failed", {
              sandboxId,
              commandId: command.id,
              error: postError instanceof Error ? postError.message : String(postError),
            });
          });
```

(Reads are bounded at 256 KB, so handling them inline before the next poll iteration is fine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/packages/relay-daemon/tests/daemon.test.js`
Expected: all tests PASS, including the three new ones.

---

### Task 4: Backend workspace query broker

**Files:**
- Create: `backend/relay/services/workspace_query.py`
- Test: `backend/tests/unit/test_workspace_query.py`

**Interfaces:**
- Consumes: nothing project-specific (pure asyncio).
- Produces (used by Tasks 5 and 7):
  - `WorkspaceQueryBroker.register(command_id: str, sandbox_id: str) -> asyncio.Future`
  - `WorkspaceQueryBroker.resolve(command_id: str, sandbox_id: str, payload: dict) -> bool`
  - `WorkspaceQueryBroker.discard(command_id: str) -> None`
  - `WORKSPACE_COMMAND_TIMEOUT_SECONDS = 10.0`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/unit/test_workspace_query.py`:

```python
import asyncio

import pytest

from relay.services.workspace_query import WorkspaceQueryBroker


@pytest.mark.asyncio
async def test_resolve_delivers_payload_to_waiter():
    broker = WorkspaceQueryBroker()
    future = broker.register("cmd_1", "sbx_a")
    assert broker.resolve("cmd_1", "sbx_a", {"type": "workspace.listing"}) is True
    assert await asyncio.wait_for(future, timeout=1) == {"type": "workspace.listing"}


@pytest.mark.asyncio
async def test_resolve_rejects_wrong_sandbox_and_unknown_command():
    broker = WorkspaceQueryBroker()
    future = broker.register("cmd_1", "sbx_a")
    assert broker.resolve("cmd_1", "sbx_other", {}) is False
    assert broker.resolve("cmd_unknown", "sbx_a", {}) is False
    assert not future.done()
    broker.discard("cmd_1")
    assert broker.resolve("cmd_1", "sbx_a", {}) is False
```

If `pytest-asyncio` is not already a backend dev dependency (check `backend/pyproject.toml`), write the tests with `asyncio.run` inside plain functions instead:

```python
def test_resolve_delivers_payload_to_waiter():
    async def scenario():
        broker = WorkspaceQueryBroker()
        future = broker.register("cmd_1", "sbx_a")
        assert broker.resolve("cmd_1", "sbx_a", {"type": "workspace.listing"}) is True
        assert await asyncio.wait_for(future, timeout=1) == {"type": "workspace.listing"}
    asyncio.run(scenario())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_workspace_query.py -q`
Expected: FAIL with `ModuleNotFoundError: relay.services.workspace_query`.

- [ ] **Step 3: Implement**

Create `backend/relay/services/workspace_query.py`:

```python
"""In-memory request/response broker for daemon workspace commands.

The backend enqueues a workspace.list / workspace.read command on a node's
command queue and awaits the matching daemon event here. Futures live in the
single FastAPI event loop, so no cross-thread signalling is needed.
"""

from __future__ import annotations

import asyncio
from typing import Any

WORKSPACE_COMMAND_TIMEOUT_SECONDS = 10.0


class WorkspaceQueryBroker:
    def __init__(self) -> None:
        self._pending: dict[str, tuple[str, asyncio.Future[dict[str, Any]]]] = {}

    def register(self, command_id: str, sandbox_id: str) -> asyncio.Future[dict[str, Any]]:
        future: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
        self._pending[command_id] = (sandbox_id, future)
        return future

    def resolve(self, command_id: str, sandbox_id: str, payload: dict[str, Any]) -> bool:
        entry = self._pending.get(command_id)
        if entry is None or entry[0] != sandbox_id:
            return False
        del self._pending[command_id]
        if not entry[1].done():
            entry[1].set_result(payload)
        return True

    def discard(self, command_id: str) -> None:
        self._pending.pop(command_id, None)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_workspace_query.py -q`
Expected: PASS.

---

### Task 5: Wire the broker into the app and the daemon events route

**Files:**
- Modify: `backend/relay/api/deps.py` (AppContext), `backend/relay/app.py` (app.state), `backend/relay/api/daemon_node_routes.py` (events route, line ~203), `backend/relay/daemon_registry/registry.py` (public auth method)
- Test: `backend/tests/api/test_daemon_api.py` (append test)

**Interfaces:**
- Consumes: `WorkspaceQueryBroker` (Task 4); registry `_assert_authorized` / `_mark_seen`.
- Produces (used by Task 7):
  - `ctx.workspace_query_broker: WorkspaceQueryBroker` on `AppContext`
  - `DaemonNodeRegistry.assert_node_event_authorized(sandbox_id: str, token: str | None) -> None`
  - `POST /daemon-nodes/{sandbox_id}/events` accepting `workspace.listing` / `workspace.file` / `workspace.error` events and resolving the broker.

- [ ] **Step 1: Write the failing API test**

Append to `backend/tests/api/test_daemon_api.py`, reusing the file's existing register-node fixture pattern (register a node with `"token": "node_token"`, admin auth via `RELAY_ADMIN_TOKEN`):

```python
def test_workspace_event_resolves_broker(monkeypatch, tmp_path):
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with make_client(tmp_path) as client:  # use this file's existing client fixture/helper name
        register_default_node(client)  # existing helper/pattern that registers sbx with "node_token"
        broker = client.app.state.workspace_query_broker
        future = broker.register("cmd_ws1", "sbx_alice")
        response = client.post(
            "/daemon-nodes/sbx_alice/events",
            json={
                "type": "workspace.listing",
                "commandId": "cmd_ws1",
                "agentId": "agent_1",
                "path": "",
                "exists": True,
                "entries": [],
            },
            headers={"Authorization": "Bearer node_token"},
        )
        assert response.status_code == 202
        assert future.done() and future.result()["type"] == "workspace.listing"

        # Wrong token is rejected before touching the broker.
        broker.register("cmd_ws2", "sbx_alice")
        response = client.post(
            "/daemon-nodes/sbx_alice/events",
            json={"type": "workspace.listing", "commandId": "cmd_ws2", "agentId": "agent_1", "path": "", "exists": True, "entries": []},
            headers={"Authorization": "Bearer wrong"},
        )
        assert response.status_code == 401
```

Adapt the client/registration helper names to what `test_daemon_api.py` actually uses (see its first test around line 83 — `client.post("/daemon-nodes/register", json={...})`). Note: `future.done()` requires the TestClient and app to share a loop; if the existing TestClient runs the app in a portal thread, assert via `broker._pending` emptiness instead: `assert "cmd_ws1" not in broker._pending`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py -q -k workspace_event`
Expected: FAIL — `AttributeError: workspace_query_broker` (or the event is ignored and the future never resolves).

- [ ] **Step 3: Implement**

1. `backend/relay/daemon_registry/registry.py` — add next to `handle_event`:

```python
    def assert_node_event_authorized(self, sandbox_id: str, token: str | None) -> None:
        """Public token check for non-run daemon events (workspace queries)."""
        self._assert_authorized(sandbox_id, token)
        self._mark_seen(sandbox_id)
```

2. `backend/relay/app.py` — where the other stores are attached to `app.state`, add:

```python
from .services.workspace_query import WorkspaceQueryBroker
...
app.state.workspace_query_broker = WorkspaceQueryBroker()
```

3. `backend/relay/api/deps.py` — add the field and constructor line:

```python
    workspace_query_broker: Any
...
        workspace_query_broker=request.app.state.workspace_query_broker,
```

4. `backend/relay/api/daemon_node_routes.py` — in `daemon_events` (line ~203), before the `ctx.registry.handle_event(...)` call and inside the same try/except that maps `KeyError`→404 and `PermissionError`→401 (follow the route's existing mapping):

```python
WORKSPACE_EVENT_TYPES = frozenset({"workspace.listing", "workspace.file", "workspace.error"})
...
        if event.get("type") in WORKSPACE_EVENT_TYPES:
            ctx.registry.assert_node_event_authorized(sandbox_id, bearer_token(request))
            command_id = event.get("commandId")
            if isinstance(command_id, str):
                ctx.workspace_query_broker.resolve(command_id, sandbox_id, event)
            return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py backend/tests/unit/test_workspace_query.py -q`
Expected: PASS (new test plus no regressions in the file).

---

### Task 6: Snapshot fallback helpers

**Files:**
- Modify: `backend/relay/api/helpers.py` (extract shared newest-per-file aggregation), `backend/relay/api/agent_routes.py` (reuse it in `agent_artifacts`, line ~67)
- Create: `backend/relay/services/agent_workspace_snapshot.py`
- Test: `backend/tests/unit/test_agent_workspace_snapshot.py`

**Interfaces:**
- Consumes: `workspace_artifacts`, `workspace_artifact_key`, `artifact_index_item` from `backend/relay/api/helpers.py`; `SessionStore.read_artifact_content(session_id, artifact_id)`.
- Produces (used by Task 7):
  - `helpers.newest_agent_workspace_artifacts(session_store, agent_id) -> list[dict]` — deduped newest-per-file `artifact_index_item`s for sessions owned by the agent (each item carries `sessionId`, `id`, `workspaceRelativePath`, `createdAt`, `bytes`, `title`).
  - `agent_workspace_snapshot.agent_home_relative(relative_path: str | None, agent_id: str) -> str | None` — strips the `agents/agent-<b64url>/` prefix; returns None for artifacts outside the home.
  - `agent_workspace_snapshot.snapshot_listing(artifacts, agent_id, path) -> list[dict]` — entries `{name, path, kind, bytes, updatedAt}` at one directory level, directories first.
  - `agent_workspace_snapshot.snapshot_file(session_store, artifacts, agent_id, path) -> dict | None` — `{path, bytes, isBinary, truncated, content}` from the stored artifact snapshot, or None when no artifact matches.

- [ ] **Step 1: Extract the shared aggregation**

In `backend/relay/api/helpers.py`, add (near `workspace_artifacts`):

```python
def newest_agent_workspace_artifacts(session_store: Any, agent_id: str) -> list[dict[str, Any]]:
    """Newest-per-file workspace artifacts across an agent's sessions."""
    newest: dict[str, dict[str, Any]] = {}
    for session in session_store.list_sessions():
        if session.get("ownerAgentId") != agent_id:
            continue
        for artifact in workspace_artifacts(session):
            if artifact.get("agentId") != agent_id:
                continue
            key = workspace_artifact_key(session, artifact)
            current = newest.get(key)
            if current is None or (artifact.get("createdAt") or "") >= (current.get("createdAt") or ""):
                newest[key] = artifact_index_item(session, artifact)
    return sorted(newest.values(), key=lambda item: item.get("createdAt") or "", reverse=True)
```

Rewrite the body of `agent_artifacts` in `backend/relay/api/agent_routes.py` (line ~67) to call it:

```python
    ordered = newest_agent_workspace_artifacts(ctx.session_store, agent_id)
    return {"agentId": agent_id, "artifacts": ordered}
```

(Remove the now-duplicated loop; keep the auth checks. Update imports.)

- [ ] **Step 2: Write failing unit tests for the snapshot module**

Create `backend/tests/unit/test_agent_workspace_snapshot.py`:

```python
import base64

from relay.services.agent_workspace_snapshot import (
    agent_home_relative,
    snapshot_file,
    snapshot_listing,
)


def _home_prefix(agent_id: str) -> str:
    encoded = base64.urlsafe_b64encode(agent_id.encode()).decode().rstrip("=")
    return f"agents/agent-{encoded}"


def _artifact(agent_id: str, relative: str, **extra):
    return {
        "id": f"art_{relative.replace('/', '_')}",
        "sessionId": "sess_1",
        "workspaceRelativePath": f"{_home_prefix(agent_id)}/{relative}",
        "title": relative.rsplit("/", 1)[-1],
        "bytes": 5,
        "createdAt": "2026-07-11T00:00:00Z",
        **extra,
    }


def test_agent_home_relative_strips_prefix_and_rejects_foreign_paths():
    assert agent_home_relative(f"{_home_prefix('agent_1')}/a/b.md", "agent_1") == "a/b.md"
    assert agent_home_relative("elsewhere/b.md", "agent_1") is None
    assert agent_home_relative(None, "agent_1") is None


def test_snapshot_listing_builds_one_directory_level():
    artifacts = [
        _artifact("agent_1", "report.md"),
        _artifact("agent_1", "sub/deep.md"),
        _artifact("agent_1", "sub/other.md"),
    ]
    root = snapshot_listing(artifacts, "agent_1", "")
    assert [(entry["name"], entry["kind"]) for entry in root] == [("sub", "directory"), ("report.md", "file")]
    sub = snapshot_listing(artifacts, "agent_1", "sub")
    assert [entry["path"] for entry in sub] == ["sub/deep.md", "sub/other.md"]


class FakeSessionStore:
    def __init__(self, content: bytes | None):
        self._content = content

    def read_artifact_content(self, session_id, artifact_id):
        return self._content


def test_snapshot_file_serves_stored_content_and_flags_binary():
    artifacts = [_artifact("agent_1", "report.md")]
    result = snapshot_file(FakeSessionStore(b"hello"), artifacts, "agent_1", "report.md")
    assert result == {"path": "report.md", "bytes": 5, "isBinary": False, "truncated": False, "content": "hello"}
    binary = snapshot_file(FakeSessionStore(b"\x00\x01"), artifacts, "agent_1", "report.md")
    assert binary["isBinary"] is True and binary["content"] is None
    assert snapshot_file(FakeSessionStore(b"x"), artifacts, "agent_1", "missing.md") is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_agent_workspace_snapshot.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 4: Implement the snapshot module**

Create `backend/relay/services/agent_workspace_snapshot.py`:

```python
"""Virtual agent-home views derived from stored workspace_file artifacts.

Serves the workspace browse/read API when an agent has no live placement:
artifact content snapshots are the durable record of what the agent produced.
"""

from __future__ import annotations

import base64
from typing import Any


def _agent_home_prefix(agent_id: str) -> str:
    encoded = base64.urlsafe_b64encode(agent_id.encode("utf-8")).decode("ascii").rstrip("=")
    return f"agents/agent-{encoded}/"


def agent_home_relative(relative_path: str | None, agent_id: str) -> str | None:
    if not isinstance(relative_path, str):
        return None
    prefix = _agent_home_prefix(agent_id)
    if not relative_path.startswith(prefix):
        return None
    return relative_path[len(prefix):]


def _home_paths(artifacts: list[dict[str, Any]], agent_id: str) -> list[tuple[str, dict[str, Any]]]:
    pairs = []
    for artifact in artifacts:
        home_path = agent_home_relative(artifact.get("workspaceRelativePath"), agent_id)
        if home_path:
            pairs.append((home_path, artifact))
    return pairs


def snapshot_listing(artifacts: list[dict[str, Any]], agent_id: str, path: str) -> list[dict[str, Any]]:
    """Entries for one directory level of the virtual home tree."""
    prefix = f"{path.strip('/')}/" if path.strip("/") else ""
    directories: dict[str, str] = {}
    files: list[dict[str, Any]] = []
    for home_path, artifact in _home_paths(artifacts, agent_id):
        if not home_path.startswith(prefix):
            continue
        remainder = home_path[len(prefix):]
        if not remainder:
            continue
        if "/" in remainder:
            name = remainder.split("/", 1)[0]
            created = artifact.get("createdAt") or ""
            if created >= directories.get(name, ""):
                directories[name] = created
        else:
            files.append(
                {
                    "name": remainder,
                    "path": home_path,
                    "kind": "file",
                    "bytes": artifact.get("bytes"),
                    "updatedAt": artifact.get("createdAt"),
                }
            )
    directory_entries = [
        {"name": name, "path": f"{prefix}{name}", "kind": "directory", "bytes": None, "updatedAt": created or None}
        for name, created in directories.items()
    ]
    directory_entries.sort(key=lambda item: item["name"].lower())
    files.sort(key=lambda item: item["name"].lower())
    return directory_entries + files


def snapshot_file(
    session_store: Any, artifacts: list[dict[str, Any]], agent_id: str, path: str
) -> dict[str, Any] | None:
    clean = path.strip("/")
    for home_path, artifact in _home_paths(artifacts, agent_id):
        if home_path != clean:
            continue
        content = session_store.read_artifact_content(artifact["sessionId"], artifact["id"])
        if content is None:
            return None
        is_binary = b"\x00" in content
        text: str | None = None
        if not is_binary:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                is_binary = True
        return {
            "path": clean,
            "bytes": artifact.get("bytes") or len(content),
            "isBinary": is_binary,
            "truncated": False,
            "content": text,
        }
    return None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_agent_workspace_snapshot.py backend/tests/api/test_agent_api.py -q`
Expected: PASS (including the untouched agent-artifacts API behavior after the helper extraction).

---

### Task 7: Agent-scoped workspace endpoints (live dispatch + snapshot fallback)

**Files:**
- Create: `backend/relay/api/agent_workspace_routes.py`
- Modify: `backend/relay/services/agent_routing.py` (add `select_workspace_node`), `backend/relay/app.py` (include the router)
- Test: `backend/tests/api/test_agent_workspace.py`

**Interfaces:**
- Consumes: `ctx.workspace_query_broker` + `WORKSPACE_COMMAND_TIMEOUT_SECONDS` (Tasks 4–5), `newest_agent_workspace_artifacts` + snapshot helpers (Task 6), `placement_status` from `backend/relay/persistence/agent_placement_store.py`, `ctx.registry.enqueue`, `new_relay_id` from `backend/relay/core/ids.py`.
- Produces (used by Task 9):
  - `GET /agents/{agent_id}/workspace/files?path=` → `{ agentId, source: "live"|"snapshot", path, exists, entries, nodeId?, generatedAt }`
  - `GET /agents/{agent_id}/workspace/file?path=` → `{ agentId, source, path, exists, isBinary, bytes, content, truncated, limitBytes, generatedAt }`
  - Errors: 403 non-supervisor, 404 unknown agent/missing file, 400 invalid path / directory, 503 `{"reason": "placement-unavailable"}` on daemon timeout.
  - `agent_routing.select_workspace_node(agent, placement_store, daemon_nodes) -> dict | None`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/api/test_agent_workspace.py`. Follow the client/auth fixture pattern of `backend/tests/api/test_agent_api.py` (which already creates agents against the API); reuse its helpers for creating an employee session and an agent. The test simulates the daemon by polling the node's command queue and posting the response event.

```python
"""Agent-scoped workspace API: live daemon dispatch and snapshot fallback."""
# Reuse the fixture/helper style of test_agent_api.py for client, admin auth,
# employee login, and agent creation, and of test_daemon_api.py for node
# registration with a token. Concrete flows to cover:


def test_snapshot_fallback_when_agent_has_no_live_placement(...):
    # 1. Create agent agent_1 supervised by alice; no node/placement.
    # 2. Seed a session owned by agent_1 whose store has a workspace_file
    #    artifact at agents/agent-<b64(agent_1)>/report.md with snapshot
    #    content b"hello" (use session_store.index_workspace_artifact via
    #    app.state.session_store, matching how test_task_artifacts.py seeds).
    # 3. GET /agents/agent_1/workspace/files as alice
    #    -> 200, source == "snapshot", entries == [report.md file entry]
    # 4. GET /agents/agent_1/workspace/file?path=report.md
    #    -> 200, source == "snapshot", content == "hello"
    # 5. GET .../file?path=missing.md -> 404


def test_live_dispatch_round_trip(...):
    # 1. Register node sbx_alice with token node_token and
    #    capabilities ["workspace-read"] in the registration payload.
    # 2. Create agent agent_1 + a ready placement on sbx_alice (create the
    #    placement the same way test_agent_placements.py does).
    # 3. In a background thread: poll GET /daemon-nodes/sbx_alice/commands
    #    until a workspace.list command appears, then POST the matching
    #    workspace.listing event with one entry.
    # 4. GET /agents/agent_1/workspace/files as alice
    #    -> 200, source == "live", nodeId == "sbx_alice", the entry present.


def test_timeout_returns_503_placement_unavailable(...):
    # Same setup as live dispatch but nobody serves the command; monkeypatch
    # relay.api.agent_workspace_routes.WORKSPACE_COMMAND_TIMEOUT_SECONDS to 0.2.
    # -> 503, body detail/reason == "placement-unavailable".


def test_authz(...):
    # bob (non-supervisor, non-admin) -> 403; admin -> 200; unknown agent -> 404.
```

Write these as real tests (the comments above are the scenario contract; the fixture plumbing comes from the two existing test files — copy their client setup verbatim rather than inventing new fixtures).

- [ ] **Step 2: Run tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_agent_workspace.py -q`
Expected: FAIL with 404 on `/agents/{id}/workspace/files` (route not registered).

- [ ] **Step 3: Implement placement selection helper**

Append to `backend/relay/services/agent_routing.py`:

```python
def select_workspace_node(
    agent: dict[str, Any], placement_store: Any, daemon_nodes: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Pick a live node able to serve workspace reads for this agent."""
    nodes = {node["id"]: node for node in daemon_nodes}
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    for placement in placement_store.list_placements(agent_id=agent["id"]):
        node = nodes.get(placement["daemonNodeId"])
        if not node or "workspace-read" not in (node.get("capabilities") or []):
            continue
        view = placement_status(placement, agent, node)
        if view["status"] not in ("ready", "busy"):
            continue
        candidates.append((int(placement.get("priority") or 100), placement["id"], node))
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: (item[0], item[1]))[0][2]
```

- [ ] **Step 4: Implement the routes**

Create `backend/relay/api/agent_workspace_routes.py`:

```python
"""Agent-scoped workspace browsing: live daemon reads with snapshot fallback."""

from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..core.ids import new_relay_id
from ..services.agent_routing import select_workspace_node
from ..services.agent_workspace_snapshot import snapshot_file, snapshot_listing
from ..services.workspace_query import WORKSPACE_COMMAND_TIMEOUT_SECONDS
from .deps import AppContextDep
from .helpers import newest_agent_workspace_artifacts, request_actor

router = APIRouter()

WORKSPACE_FILE_PREVIEW_LIMIT = 256 * 1024


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _authorized_agent(ctx: Any, request: Request, agent_id: str) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Agent not found.")
    if not actor["isAdmin"] and agent.get("supervisorEmployeeId") != actor["employeeId"]:
        raise HTTPException(403, "Cannot read another employee's agent workspace.")
    return agent


def _validate_relative_path(raw: str | None) -> str:
    path = (raw or "").strip().strip("/")
    if path.startswith("/") or ".." in path.split("/"):
        raise HTTPException(400, "Workspace path must be relative and must not traverse upward.")
    return path


async def _dispatch_workspace_command(ctx: Any, node: dict[str, Any], command: dict[str, Any]) -> dict[str, Any]:
    future = ctx.workspace_query_broker.register(command["id"], node["id"])
    try:
        ctx.registry.enqueue(node["id"], command)
        return await asyncio.wait_for(future, timeout=WORKSPACE_COMMAND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(503, {"reason": "placement-unavailable"})
    finally:
        ctx.workspace_query_broker.discard(command["id"])


def _raise_for_workspace_error(event: dict[str, Any]) -> None:
    if event.get("type") != "workspace.error":
        return
    code = event.get("code")
    if code == "not-found":
        raise HTTPException(404, "Workspace file path was not found.")
    if code == "is-directory":
        raise HTTPException(400, "Workspace file path is a directory.")
    if code == "invalid-path":
        raise HTTPException(400, "Workspace path is invalid.")
    raise HTTPException(502, event.get("message") or "Workspace read failed on the runtime node.")


@router.get("/agents/{agent_id}/workspace/files")
async def agent_workspace_files(agent_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    agent = _authorized_agent(ctx, request, agent_id)
    path = _validate_relative_path(request.query_params.get("path"))
    node = select_workspace_node(agent, ctx.agent_placement_store, ctx.registry.monitor_nodes())
    if node:
        event = await _dispatch_workspace_command(
            ctx,
            node,
            {"id": new_relay_id("cmd"), "type": "workspace.list", "agentId": agent_id, "path": path},
        )
        _raise_for_workspace_error(event)
        return {
            "agentId": agent_id,
            "source": "live",
            "nodeId": node["id"],
            "path": event.get("path", path),
            "exists": bool(event.get("exists")),
            "entries": event.get("entries") or [],
            "generatedAt": _timestamp(),
        }
    artifacts = newest_agent_workspace_artifacts(ctx.session_store, agent_id)
    return {
        "agentId": agent_id,
        "source": "snapshot",
        "path": path,
        "exists": True,
        "entries": snapshot_listing(artifacts, agent_id, path),
        "generatedAt": _timestamp(),
    }


@router.get("/agents/{agent_id}/workspace/file")
async def agent_workspace_file(agent_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    agent = _authorized_agent(ctx, request, agent_id)
    path = _validate_relative_path(request.query_params.get("path"))
    if not path:
        raise HTTPException(400, "Workspace file path is required.")
    node = select_workspace_node(agent, ctx.agent_placement_store, ctx.registry.monitor_nodes())
    if node:
        event = await _dispatch_workspace_command(
            ctx,
            node,
            {"id": new_relay_id("cmd"), "type": "workspace.read", "agentId": agent_id, "path": path},
        )
        _raise_for_workspace_error(event)
        content: str | None = None
        raw = event.get("contentBase64")
        if isinstance(raw, str):
            content = base64.b64decode(raw).decode("utf-8", errors="replace")
        return {
            "agentId": agent_id,
            "source": "live",
            "nodeId": node["id"],
            "path": event.get("path", path),
            "exists": True,
            "isBinary": bool(event.get("isBinary")),
            "bytes": event.get("bytes") or 0,
            "content": content,
            "truncated": bool(event.get("truncated")),
            "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
            "generatedAt": _timestamp(),
        }
    artifacts = newest_agent_workspace_artifacts(ctx.session_store, agent_id)
    result = snapshot_file(ctx.session_store, artifacts, agent_id, path)
    if result is None:
        raise HTTPException(404, "Workspace file path was not found.")
    return {
        "agentId": agent_id,
        "source": "snapshot",
        "exists": True,
        **result,
        "limitBytes": WORKSPACE_FILE_PREVIEW_LIMIT,
        "generatedAt": _timestamp(),
    }
```

Register the router in `backend/relay/app.py` next to the other API routers (before the web catch-all, matching how `agent_routes.router` is included):

```python
from .api import agent_workspace_routes
...
app.include_router(agent_workspace_routes.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_agent_workspace.py -q`
Expected: PASS.

---

### Task 8: Remove the employee-rooted workspace endpoints

**Files:**
- Modify: `backend/relay/api/session_routes.py` (delete `/workspace/files` + `/workspace/file` routes; delete `workspace_path_for_employee`, `workspace_path_for_agent`, `workspace_file_item`, `workspace_target_path`, `workspace_file_timestamp`, `WORKSPACE_FILE_LIMIT`, `WORKSPACE_FILE_PREVIEW_LIMIT`; trim `workspace_brief` — drop its `workspacePath` field and the `workspace_path_for_agent` call; keep `managed_agent_workspace_subpath` [used by session-creation dispatch] and `workspace_artifact_path` [used by artifact download])
- Modify/Delete: `backend/tests/api/test_workspace_file.py` — delete it (its behavior is now covered by `test_agent_workspace.py` from Task 7)
- Test: full backend suite

**Interfaces:**
- Consumes: nothing new.
- Produces: `/workspace/brief` no longer returns `workspacePath`; `/workspace/files` and `/workspace/file` return 404 (removed). Task 9 must stop calling them.

- [ ] **Step 1: Delete the routes and helpers**

Remove the functions and routes listed above from `backend/relay/api/session_routes.py`. In `workspace_brief`, delete the line `workspace_path = workspace_path_for_agent(ctx, agent, employee_id)` and the `**({"workspacePath": workspace_path} if workspace_path else {})` entry from the response. Clean unused imports (`stat`, possibly `base64` if `managed_agent_workspace_subpath` is the only user — it uses `base64`, so keep it).

- [ ] **Step 2: Delete `backend/tests/api/test_workspace_file.py`**

Run: `rm backend/tests/api/test_workspace_file.py`

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "workspace/files\|workspace/file\b\|workspace_path_for_employee\|workspace_path_for_agent" backend/relay backend/tests packages/relay-core/src web/src`
Expected: zero hits in `backend/relay` and `backend/tests` outside `agent_workspace_routes.py`'s own paths. Hits in `web/src/api.ts` are expected until Task 9 — note them, don't fix here.

- [ ] **Step 4: Run the backend suite**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest -q` (from repo root with `--project backend`)
Expected: PASS. If other tests referenced the deleted endpoints or the brief's `workspacePath` field, update those assertions (they encode the old model).

---

### Task 9: Web — agent workspace API, home status line, i18n

**Files:**
- Modify: `web/src/api.ts` (replace `listWorkspaceFiles`/`readWorkspaceFile`), `web/src/types.ts` (response types), `web/src/components/AgentWorkspacePage.tsx` (queries + status line + empty state), `web/src/i18n/locales/{en,zh-CN,zh-TW}/translation.json`
- Test: `web/tests/api.test.ts` (or the web test file that covers api helpers — follow its existing pattern), plus `npm run build`

**Interfaces:**
- Consumes: Task 7's endpoints and envelopes.
- Produces: user-visible status line; no employee-keyed workspace calls remain.

- [ ] **Step 1: Update types**

In `web/src/types.ts`, replace the old `WorkspaceFilesResponse` / `WorkspaceFileContentResponse` with:

```ts
export type AgentWorkspaceSource = "live" | "snapshot";

export interface AgentWorkspaceFilesResponse {
  agentId: string;
  source: AgentWorkspaceSource;
  nodeId?: string;
  path: string;
  exists: boolean;
  entries: WorkspaceFileEntry[];
  generatedAt: string;
}

export interface AgentWorkspaceFileResponse {
  agentId: string;
  source: AgentWorkspaceSource;
  nodeId?: string;
  path: string;
  exists: boolean;
  isBinary: boolean;
  bytes: number;
  content: string | null;
  truncated: boolean;
  limitBytes: number;
  generatedAt: string;
}
```

Keep `WorkspaceFileEntry` (shape unchanged: `name`, `path`, `kind`, `bytes`, `updatedAt`). If `WorkspaceBriefResponse` declares `workspacePath`, remove that field.

- [ ] **Step 2: Update api.ts**

Replace `listWorkspaceFiles` and `readWorkspaceFile` in `web/src/api.ts`:

```ts
export function listAgentWorkspaceFiles(
  input: { agentId: string; path?: string },
  signal?: AbortSignal,
): Promise<AgentWorkspaceFilesResponse> {
  const params = new URLSearchParams();
  if (input.path) params.set("path", input.path);
  const query = params.toString();
  return apiJson<AgentWorkspaceFilesResponse>(
    `/agents/${encodeURIComponent(input.agentId)}/workspace/files${query ? `?${query}` : ""}`,
    { signal },
  );
}

export function readAgentWorkspaceFile(
  input: { agentId: string; path: string },
  signal?: AbortSignal,
): Promise<AgentWorkspaceFileResponse> {
  const params = new URLSearchParams({ path: input.path });
  return apiJson<AgentWorkspaceFileResponse>(
    `/agents/${encodeURIComponent(input.agentId)}/workspace/file?${params.toString()}`,
    { signal },
  );
}
```

- [ ] **Step 3: Update AgentWorkspacePage**

In `web/src/components/AgentWorkspacePage.tsx`:

1. Swap the queries (lines ~95 and ~106):

```ts
  const fileQuery = useQuery({
    queryKey: ["agent-workspace", agent.id, filePath],
    queryFn: ({ signal }) => listAgentWorkspaceFiles({ agentId: agent.id, path: filePath }, signal),
  });
  ...
  const contentQuery = useQuery({
    queryKey: ["agent-workspace-file", agent.id, selectedFilePath],
    queryFn: ({ signal }) => readAgentWorkspaceFile({ agentId: agent.id, path: selectedFilePath! }, signal),
    enabled: selectedFilePath != null,
  });
```

2. Add the home status line to the Files pane header (inside the existing `PaneHeader` `meta` slot):

```tsx
  const source = fileQuery.data?.source;
  const homeStatus =
    source === "live" ? (
      <span className="workspace-home-status workspace-home-status--live">
        ● {t("workspace.source_live")}
        {fileQuery.data?.nodeId ? <span className="workspace-home-node">{fileQuery.data.nodeId}</span> : null}
      </span>
    ) : source === "snapshot" ? (
      <span className="workspace-home-status workspace-home-status--snapshot">○ {t("workspace.source_snapshot")}</span>
    ) : null;
```

Pass `meta={homeStatus}` where the Files `PaneHeader` is rendered. Add minimal styles in `web/src/styles/workspace.css` (dim, small; `--snapshot` uses the muted foreground color; the node id is dimmer still). Follow the file's existing class naming.

3. Empty state: when `source === "snapshot"` and `entries` is empty, render `t("workspace.no_files_yet")` in the files pane (reuse the existing `EmptyText` component).

4. On a 503 file-list error, show the existing error styling with a retry button that calls `fileQuery.refetch()` and label `t("workspace.retry")`.

- [ ] **Step 4: i18n keys (all three locales)**

Add under the `workspace` object:

- `en`: `"source_live": "Live"`, `"source_snapshot": "Snapshot · agent offline"`, `"no_files_yet": "This agent hasn't produced files yet."`, `"retry": "Retry"`
- `zh-CN`: `"source_live": "实时"`, `"source_snapshot": "快照 · 智能体离线"`, `"no_files_yet": "该智能体还没有生成文件。"`, `"retry": "重试"`
- `zh-TW`: `"source_live": "即時"`, `"source_snapshot": "快照 · 智慧代理離線"`, `"no_files_yet": "該智慧代理尚未產生檔案。"`, `"retry": "重試"`

Remove any now-unused keys the deleted employee-workspace calls referenced (grep each removed key across `web/src` before deleting).

- [ ] **Step 5: Web tests + build**

If `web/tests/api.test.ts` asserts URL construction for the old helpers, rewrite those cases for `listAgentWorkspaceFiles`/`readAgentWorkspaceFile` (asserting the `/agents/{id}/workspace/...` paths). Then:

Run: `npm run build && node --test dist/web/tests/*.test.js`
Expected: PASS, and the Next.js build completes with no type errors (this catches any remaining reference to the deleted types/functions).

---

### Task 10: Full verification sweep

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `npm test` (builds TS, runs all `node --test` suites, then backend pytest)
Expected: PASS.

- [ ] **Step 2: Greps to zero**

Run: `grep -rn "listWorkspaceFiles\|readWorkspaceFile({ employeeId\|workspace_path_for_employee\|/workspace/files\|/workspace/file?" web/src backend/relay --include="*.ts" --include="*.tsx" --include="*.py"`
Expected: no hits (agent-scoped equivalents only).

- [ ] **Step 3: Update CLAUDE.md invariants**

In the repo `CLAUDE.md` Key invariants section, add one bullet:

> **Agent home workspace.** An agent's files live in its home (`agents/agent-<b64>/` under the node mount) and are served through daemon `workspace.list`/`workspace.read` commands (capability `workspace-read`), with the artifact snapshot index as the offline fallback. The backend never walks a node workspace to browse files; artifacts are the durable record — homes do not migrate between nodes.

- [ ] **Step 4: Manual smoke (optional but recommended)**

`make run` locally, dispatch a run that generates a file, open the web AgentWorkspacePage: Files tab shows the agent home with the `● Live` status; stop the daemon, reload: `○ Snapshot · agent offline` with the artifact-derived listing. Do **not** commit anything.
