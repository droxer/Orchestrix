# Per-Task Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every backlog task and every routine occurrence its own durable workspace directory shared by all of its rounds and agents, and let the owning employee browse that directory from the task drawer.

**Architecture:** Add a fourth `workspaceLayout` value, `task`, alongside the existing `node-root`/`thread`/`project`. The daemon already owns generic durable-subpath resolution (built for projects); the `task` layout reuses it verbatim. The backend derives the subpath from task ids in one new module and chooses the layout at dispatch time, falling back to today's `thread` layout when the chosen daemon is too old. Two new read routes mirror the project workspace browse routes, and one new drawer section renders them.

**Tech Stack:** Python 3.12 / FastAPI (backend), TypeScript / Node 22 (relay-core, relay-daemon), Next.js + React + TanStack Query + react-i18next (web). Tests: `pytest` for the backend, `node --test` against built JS for TypeScript.

**Spec:** `docs/task-workspace-separation-design.md`

## Global Constraints

- Node >= 22.19 for the TypeScript packages; Python >= 3.12 and `uv` for the backend.
- The backend never executes agents. Everything reaches the daemon as a command.
- Session and task state changes go through `append_event`. Never mutate snapshot fields outside the store's replay.
- Mutations return new objects. No in-place mutation of session/task dicts.
- Wire routes and on-disk paths keep historical `daemon-node` naming.
- Project workspace behavior must not change. Every project assertion in the existing suite must still pass.
- The workspace subpath alphabet is the daemon's `THREAD_ID_PATTERN`: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/` per segment. Database ids already satisfy it.
- The literal subpath root is `tasks` (lowercase, no leading or trailing slash).
- The new daemon capability string is exactly `task-workspaces`.
- The new layout string is exactly `task`.

## Build and test commands

```bash
# Python, whole backend suite
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests

# Python, single file or single test
UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_task_workspace.py -v

# TypeScript: build first, then run the built JS
npm run build
node --test dist/packages/relay-daemon/tests/daemon.test.js
node --test dist/web/tests/taskWorkspace.test.js
```

---

### Task 1: Task workspace subpath derivation

The pure function every other backend task depends on. No I/O, no store access — it reads a task dict and returns strings.

**Files:**
- Create: `backend/relay/services/task_workspace.py`
- Test: `backend/tests/unit/test_task_workspace.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `TASK_WORKSPACE_ROOT: str` = `"tasks"`
  - `WORKSPACE_LAYOUT_TASK: str` = `"task"`
  - `WORKSPACE_LAYOUT_THREAD: str` = `"thread"`
  - `WORKSPACE_LAYOUT_PROJECT: str` = `"project"`
  - `DAEMON_CAPABILITY_TASK_WORKSPACES: str` = `"task-workspaces"`
  - `task_workspace_subpath(task: dict[str, Any]) -> str`
  - `resolve_task_workspace(task: dict[str, Any], *, node: dict[str, Any] | None, project_snapshot: dict[str, Any] | None = None) -> tuple[str, str | None]`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_task_workspace.py`:

```python
from relay.services.task_workspace import (
    resolve_task_workspace,
    task_workspace_subpath,
)

TASK_CAPABLE_NODE = {"capabilities": ["thread-workspaces", "task-workspaces"]}
OLD_NODE = {"capabilities": ["thread-workspaces"]}


def test_backlog_task_gets_its_own_directory():
    assert task_workspace_subpath({"id": "tsk_one"}) == "tasks/tsk_one"


def test_routine_occurrence_nests_under_its_routine():
    occurrence = {"id": "tsk_run", "sourceRoutineId": "tsk_routine"}
    assert task_workspace_subpath(occurrence) == "tasks/tsk_routine/tsk_run"


def test_blank_source_routine_id_is_treated_as_absent():
    assert task_workspace_subpath({"id": "tsk_one", "sourceRoutineId": ""}) == "tasks/tsk_one"


def test_capable_node_resolves_to_the_task_layout():
    assert resolve_task_workspace({"id": "tsk_one"}, node=TASK_CAPABLE_NODE) == (
        "task",
        "tasks/tsk_one",
    )


def test_project_wins_over_the_task_workspace():
    snapshot = {"projectId": "prj_one", "workspaceSubpath": "projects/prj_one"}
    assert resolve_task_workspace(
        {"id": "tsk_one"}, node=TASK_CAPABLE_NODE, project_snapshot=snapshot
    ) == ("project", "projects/prj_one")


def test_node_without_the_capability_falls_back_to_thread():
    assert resolve_task_workspace({"id": "tsk_one"}, node=OLD_NODE) == ("thread", None)


def test_missing_node_falls_back_to_thread():
    assert resolve_task_workspace({"id": "tsk_one"}, node=None) == ("thread", None)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_task_workspace.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'relay.services.task_workspace'`

- [ ] **Step 3: Write the implementation**

Create `backend/relay/services/task_workspace.py`:

```python
"""Where a task's work lives on the computer that runs it.

A task's workspace identity is derived from its ids and never stored, the
same way a project's ``workspaceSubpath`` is a pure function of its project
id. This module is the one seam that resolves it, mirroring how
``computer_limits`` is the one seam for personal-computer limits: call it
wherever a dispatch or a browse needs to know where a task's files are, and
never rebuild the path by hand at a call site.
"""

from __future__ import annotations

from typing import Any

TASK_WORKSPACE_ROOT = "tasks"
WORKSPACE_LAYOUT_TASK = "task"
WORKSPACE_LAYOUT_THREAD = "thread"
WORKSPACE_LAYOUT_PROJECT = "project"
DAEMON_CAPABILITY_TASK_WORKSPACES = "task-workspaces"


def task_workspace_subpath(task: dict[str, Any]) -> str:
    """The durable directory a task's rounds share, under the node root.

    A routine occurrence nests under its routine so an employee browsing the
    routine sees every run's directory side by side, while the runs stay
    isolated from each other.
    """
    routine_id = task.get("sourceRoutineId")
    if isinstance(routine_id, str) and routine_id:
        return f"{TASK_WORKSPACE_ROOT}/{routine_id}/{task['id']}"
    return f"{TASK_WORKSPACE_ROOT}/{task['id']}"


def resolve_task_workspace(
    task: dict[str, Any],
    *,
    node: dict[str, Any] | None,
    project_snapshot: dict[str, Any] | None = None,
) -> tuple[str, str | None]:
    """The ``(workspaceLayout, workspaceSubpath)`` a dispatch of `task` should use.

    Resolved against the node that was already chosen, so the session records
    the layout the run will really get. A daemon that predates task workspaces
    degrades to the per-thread directory rather than failing the run: a project
    *is* its workspace, so a missing project capability is fatal, but a task
    merely loses shared state between rounds.
    """
    if project_snapshot:
        return (WORKSPACE_LAYOUT_PROJECT, project_snapshot["workspaceSubpath"])
    capabilities = (node or {}).get("capabilities") or []
    if DAEMON_CAPABILITY_TASK_WORKSPACES not in capabilities:
        return (WORKSPACE_LAYOUT_THREAD, None)
    return (WORKSPACE_LAYOUT_TASK, task_workspace_subpath(task))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_task_workspace.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add backend/relay/services/task_workspace.py backend/tests/unit/test_task_workspace.py
git commit -m "feat: derive per-task workspace subpaths"
```

---

### Task 2: Add the `task` layout to the shared protocol

One-line type widening in `relay-core`, which both the daemon and the backend's wire contract read.

**Files:**
- Modify: `packages/relay-core/src/session-store.ts:9`

**Interfaces:**
- Consumes: nothing.
- Produces: `WorkspaceLayout = "node-root" | "thread" | "project" | "task"`, re-exported as `DaemonWorkspaceLayout` from `packages/relay-core/src/daemon-node-protocol.ts` with no change needed there.

- [ ] **Step 1: Widen the type**

In `packages/relay-core/src/session-store.ts`, replace line 9:

```typescript
export type WorkspaceLayout = "node-root" | "thread" | "project";
```

with:

```typescript
export type WorkspaceLayout = "node-root" | "thread" | "project" | "task";
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build`
Expected: PASS. This step has no test of its own — it is scaffolding that Task 3's tests exercise. It is committed here so Task 3's diff stays about behavior.

- [ ] **Step 3: Commit**

```bash
git add packages/relay-core/src/session-store.ts
git commit -m "feat: add the task workspace layout to the shared protocol"
```

---

### Task 3: Daemon resolves and gates task workspaces

The daemon's `resolveProject`/`ensureProject` are already generic durable-subpath resolution with symlink rejection and realpath containment. Rename them to say so, and route the `task` layout through them. The run-gate line is the correctness-critical part: two agents in one task now share a directory.

**Files:**
- Modify: `packages/relay-daemon/src/thread-workspace.ts` — rename `resolveProject` → `resolveSubpath`, `ensureProject` → `ensureSubpath`, `validateProjectSubpath` → `validateWorkspaceSubpath`
- Modify: `packages/relay-daemon/src/index.ts` — run-gate key (~line 521), workspace read branch (~line 588), run branch (~line 826), `requiredProjectSubpath` (~line 798), capability list (~line 287)
- Test: `packages/relay-daemon/tests/daemon.test.ts`

**Interfaces:**
- Consumes: `WorkspaceLayout` including `"task"` from Task 2.
- Produces:
  - `ThreadWorkspaceManager.resolveSubpath(sessionId: string, workspaceSubpath: string): ThreadWorkspace`
  - `ThreadWorkspaceManager.ensureSubpath(sessionId: string, workspaceSubpath: string): ThreadWorkspace`
  - The daemon advertises `"task-workspaces"` in its registration `capabilities` array.

- [ ] **Step 1: Write the failing tests**

Add to `packages/relay-daemon/tests/daemon.test.ts`. Follow the file's existing harness conventions for building a daemon and feeding it commands — copy the setup used by the existing project-workspace test near `cmd_ls`/`cmd_read` and substitute the task layout:

```typescript
it("resolves a task workspace under the node root", async () => {
  const taskSubpath = "tasks/tsk_one";
  const events = await runWorkspaceCommands([
    { id: "cmd_ls", type: "workspace.list", sessionId: "ses_one", workspaceLayout: "task", workspaceSubpath: taskSubpath, path: "" },
  ]);
  assert.equal(events[0].type, "workspace.listed");
  assert.ok(existsSync(join(nodeRoot, "tasks", "tsk_one")) || events[0].exists === false);
});

it("rejects a task workspace path that escapes the node root", async () => {
  const events = await runWorkspaceCommands([
    { id: "cmd_bad", type: "workspace.read", sessionId: "ses_one", workspaceLayout: "task", workspaceSubpath: "tasks/../../escape", path: "report.md" },
  ]);
  assert.equal(events[0].type, "workspace.failed");
});

it("serializes two runs that share one task workspace", async () => {
  // Two run.start commands with the same workspaceSubpath must not execute
  // concurrently: they share a directory, so an unserialized pair lets a
  // reviewer overwrite an implementer's files mid-run.
  const order: string[] = [];
  const daemon = await startDaemonWithSlowAgent((runId) => order.push(runId));
  await daemon.deliver([
    { id: "cmd_a", type: "run.start", sessionId: "ses_a", runId: "run_a", agent: "claude", taskGoal: "a", workspaceLayout: "task", workspaceSubpath: "tasks/tsk_one" },
    { id: "cmd_b", type: "run.start", sessionId: "ses_b", runId: "run_b", agent: "claude", taskGoal: "b", workspaceLayout: "task", workspaceSubpath: "tasks/tsk_one" },
  ]);
  await daemon.settled();
  assert.deepEqual(order, ["run_a", "run_a:done", "run_b", "run_b:done"]);
});
```

If `runWorkspaceCommands` / `startDaemonWithSlowAgent` do not already exist under those names, reuse whatever the neighbouring project-workspace and concurrency tests use and keep the assertions identical.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test dist/packages/relay-daemon/tests/daemon.test.js`
Expected: FAIL — the task layout falls through to the node root, so the escape test does not fail the command and the gate test interleaves.

- [ ] **Step 3: Rename the subpath helpers**

In `packages/relay-daemon/src/thread-workspace.ts`:

```typescript
  resolveSubpath(sessionId: string, workspaceSubpath: string): ThreadWorkspace {
    validateThreadId(sessionId);
    const segments = validateWorkspaceSubpath(workspaceSubpath);
    const hostPath = resolve(this.rootPath, ...segments);
    if (!hostPath.startsWith(this.rootPath + sep)) {
      throw new Error(`Invalid durable workspace path ${JSON.stringify(workspaceSubpath)}.`);
    }
    rejectSymlinkComponents(this.rootPath, segments);
    assertContainedRealPath(this.rootPath, hostPath, "Durable workspace");
    return {
      sessionId,
      hostPath,
      executionPath: this.sandboxMode === "boxlite" ? GUEST_WORKSPACE : hostPath,
    };
  }

  ensureSubpath(sessionId: string, workspaceSubpath: string): ThreadWorkspace {
    const workspace = this.resolveSubpath(sessionId, workspaceSubpath);
    mkdirSync(workspace.hostPath, { recursive: true });
    return this.resolveSubpath(sessionId, workspaceSubpath);
  }
```

Rename `validateProjectSubpath` to `validateWorkspaceSubpath` and change its two throw messages from `Invalid project workspace path` to `Invalid durable workspace path`. Change `rejectSymlinkComponents`'s message from `Project workspace must not contain a symbolic link` to `Durable workspace must not contain a symbolic link`. Leave every other function untouched.

- [ ] **Step 4: Route the task layout through them**

In `packages/relay-daemon/src/index.ts`, replace the `requiredProjectSubpath` helper (~line 798):

```typescript
function durableWorkspaceLayout(layout: string | undefined): boolean {
  return layout === "project" || layout === "task";
}

function requiredWorkspaceSubpath(command: { workspaceSubpath?: string }): string {
  if (!command.workspaceSubpath) {
    throw new Error("Durable workspace command is missing workspaceSubpath.");
  }
  return command.workspaceSubpath;
}
```

Replace the run-gate key (~line 521):

```typescript
          const sharedWorkspaceKey = durableWorkspaceLayout(command.workspaceLayout)
            ? threadWorkspaces.resolveSubpath(command.sessionId, requiredWorkspaceSubpath(command)).hostPath
            : undefined;
```

and pass `sharedWorkspaceKey` to `workspaceRunGate.run(...)` in place of `projectWorkspaceKey`.

Replace the workspace read branch (~line 588):

```typescript
          const commandWorkspacePath = durableWorkspaceLayout(command.workspaceLayout) && command.sessionId
            ? threadWorkspaces.resolveSubpath(command.sessionId, requiredWorkspaceSubpath(command)).hostPath
            : workspacePath;
```

Replace the run branch (~line 826):

```typescript
  const threadWorkspace = command.workspaceLayout === "thread"
    ? threadWorkspaces.ensure(command.sessionId)
    : durableWorkspaceLayout(command.workspaceLayout)
      ? threadWorkspaces.ensureSubpath(command.sessionId, requiredWorkspaceSubpath(command))
      : threadWorkspaces.nodeRoot(command.sessionId);
```

- [ ] **Step 5: Advertise the capability**

In `packages/relay-core/src/daemon-node-protocol.ts:62`, widen the union and add the constant after `DAEMON_CAPABILITY_PROJECT_WORKSPACES` (line 71):

```typescript
export type DaemonNodeCapability = "generated-files" | "workspace-read-shared" | "structured-agent-events" | "thread-workspaces" | "project-workspaces" | "task-workspaces" | "round-result";
```

```typescript
/** The daemon can map every round of one task onto a single validated task directory. */
export const DAEMON_CAPABILITY_TASK_WORKSPACES: DaemonNodeCapability = "task-workspaces";
```

Re-export it from `packages/relay-core/src/index.ts` next to `DAEMON_CAPABILITY_PROJECT_WORKSPACES` (line 85):

```typescript
  DAEMON_CAPABILITY_TASK_WORKSPACES,
```

In `packages/relay-daemon/src/index.ts`, add it to the `relay-core` import list beside `DAEMON_CAPABILITY_PROJECT_WORKSPACES` (line 64), then add it to the `capabilities` array (line 292) directly after `DAEMON_CAPABILITY_PROJECT_WORKSPACES,`:

```typescript
      DAEMON_CAPABILITY_TASK_WORKSPACES,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && node --test dist/packages/relay-daemon/tests/daemon.test.js`
Expected: PASS, including every pre-existing project-workspace test.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-daemon/src/thread-workspace.ts packages/relay-daemon/src/index.ts packages/relay-daemon/tests/daemon.test.ts
git commit -m "feat: resolve and gate task workspaces in the daemon"
```

---

### Task 4: Backend accepts and forwards the task layout

The registry builds run commands and records generated-file artifacts. Both need a `task` branch, and the capability needs registering so a daemon may advertise it.

**Files:**
- Modify: `backend/relay/daemon_registry/registry.py` — capability constants (~line 188), run command build (~line 2715), `_record_generated_workspace_artifacts` (~line 3321)
- Modify: `backend/relay/daemon_registry/node_backend.py:645` — layout allowlist
- Test: `backend/tests/unit/test_daemon_registry.py`

**Interfaces:**
- Consumes: `WORKSPACE_LAYOUT_TASK` and `DAEMON_CAPABILITY_TASK_WORKSPACES` from Task 1's module.
- Produces: a run command carrying `workspaceLayout: "task"` and `workspaceSubpath`, and `DAEMON_CAPABILITY_TASK_WORKSPACES` accepted in `DAEMON_NODE_CAPABILITIES`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_daemon_registry.py`, following the surrounding tests' harness (copy the setup from the existing project-workspace test that asserts `command["workspaceLayout"] == "project"`):

```python
def test_task_layout_reaches_the_run_command():
    with registry_harness(
        capabilities=["thread-workspaces", "task-workspaces"],
        session_fields={
            "workspaceLayout": "task",
            "workspaceSubpath": "tasks/tsk_one",
        },
    ) as harness:
        command = harness.next_command()
        assert command["workspaceLayout"] == "task"
        assert command["workspaceSubpath"] == "tasks/tsk_one"


def test_task_workspace_artifacts_resolve_under_the_subpath():
    with registry_harness(
        capabilities=["generated-files", "task-workspaces"],
        session_fields={
            "workspaceLayout": "task",
            "workspaceSubpath": "tasks/tsk_one",
        },
        workspace_path="/workspace",
    ) as harness:
        artifact = harness.record_generated_file("report.md")
        assert artifact["workspacePath"] == "/workspace/tasks/tsk_one"
```

Name the harness helpers to match whatever the neighbouring tests already use; do not introduce a second harness.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py -k task_layout -v`
Expected: FAIL — the command omits `workspaceSubpath` for the task layout, and the artifact path falls back to the node root.

- [ ] **Step 3: Register the capability**

In `backend/relay/daemon_registry/registry.py`, after `DAEMON_CAPABILITY_PROJECT_WORKSPACES`:

```python
DAEMON_CAPABILITY_TASK_WORKSPACES = "task-workspaces"
```

and add `DAEMON_CAPABILITY_TASK_WORKSPACES,` to the `DAEMON_NODE_CAPABILITIES` frozenset after `DAEMON_CAPABILITY_PROJECT_WORKSPACES,`.

- [ ] **Step 4: Forward the subpath on the run command**

In the same file (~line 2715), replace:

```python
            **(
                {"workspaceSubpath": session_snapshot["workspaceSubpath"]}
                if workspace_layout == "project"
                else {}
            ),
```

with:

```python
            **(
                {"workspaceSubpath": session_snapshot["workspaceSubpath"]}
                if workspace_layout in ("project", "task")
                else {}
            ),
```

- [ ] **Step 5: Resolve generated-file artifact paths under the task workspace**

In `_record_generated_workspace_artifacts` (~line 3321), change the `elif` condition so a task workspace confines the same way a project one does:

```python
        elif (
            workspace_path
            and session.get("workspaceLayout") in ("project", "task")
            and isinstance(session.get("workspaceSubpath"), str)
            and session["workspaceSubpath"]
            and (
                DAEMON_CAPABILITY_PROJECT_WORKSPACES
                if session.get("workspaceLayout") == "project"
                else DAEMON_CAPABILITY_TASK_WORKSPACES
            )
            in (sandbox.get("capabilities") or [])
        ):
            artifact_workspace_path = _confined_workspace_path(
                workspace_path, session["workspaceSubpath"]
            ) or workspace_path
```

- [ ] **Step 6: Widen the controller allowlist**

In `backend/relay/daemon_registry/node_backend.py:645`, replace:

```python
        if workspace_layout not in ("thread", "project"):
```

with:

```python
        if workspace_layout not in ("thread", "project", "task"):
```

- [ ] **Step 7: Leave the command-build gate without a task branch**

`registry.py` (~line 2618) fails a run request when a `thread` layout meets a daemon lacking `thread-workspaces`, or a `project` layout meets one lacking `project-workspaces`. Deliberately add **no** equivalent branch for `task`. The layout was already resolved against this node in Task 5, so a `task` session on an incapable node cannot arise from a normal dispatch, and a fail-fast here would instead punish the one real case that produces it: a daemon that re-registered advertising fewer capabilities mid-task. Such a run degrades — the daemon falls through to its node root — which is recoverable, while failing the request is not. Add this comment above the `if workspace_layout == "project":` block so the omission reads as a decision:

```python
        # No task branch: the task layout is resolved against this node at
        # dispatch, and a node that dropped the capability mid-task should
        # degrade rather than have its queued work failed.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py -v`
Expected: PASS, including every pre-existing project and thread workspace test.

- [ ] **Step 9: Commit**

```bash
git add backend/relay/daemon_registry/registry.py backend/relay/daemon_registry/node_backend.py backend/tests/unit/test_daemon_registry.py
git commit -m "feat: forward task workspaces through the daemon registry"
```

---

### Task 5: Dispatch chooses the task layout

Three run-request builders stop hardcoding the layout. This is where the capability fallback lands, so the session records the layout the run will really get.

**Files:**
- Modify: `backend/relay/services/task_dispatch.py` — `TaskDispatcher._request`, around the `workspaceLayout: "project"` block at line 555
- Modify: `backend/relay/tasks/scheduler.py` — the dispatch request around line 585
- Modify: `backend/relay/collaboration/service.py` — the project branch around line 450
- Test: `backend/tests/unit/test_task_dispatch.py` (create if absent), `backend/tests/` scheduler test file

**Interfaces:**
- Consumes: `resolve_task_workspace` from Task 1.
- Produces: run requests whose `workspaceLayout` is `"task"` (with `workspaceSubpath`), `"project"`, or `"thread"` (with no subpath).

- [ ] **Step 1: Write the failing tests**

```python
import pytest

from relay.services.task_workspace import resolve_task_workspace


@pytest.mark.asyncio
async def test_dispatch_sends_the_task_layout_to_a_capable_node(dispatch_harness):
    harness = dispatch_harness(capabilities=["thread-workspaces", "task-workspaces"])
    request = await harness.dispatch({"id": "tsk_one", "title": "Write the report"})
    assert request["workspaceLayout"] == "task"
    assert request["workspaceSubpath"] == "tasks/tsk_one"


@pytest.mark.asyncio
async def test_dispatch_falls_back_to_thread_on_an_older_node(dispatch_harness):
    harness = dispatch_harness(capabilities=["thread-workspaces"])
    request = await harness.dispatch({"id": "tsk_one", "title": "Write the report"})
    assert request["workspaceLayout"] == "thread"
    assert "workspaceSubpath" not in request


@pytest.mark.asyncio
async def test_project_task_keeps_the_project_workspace(dispatch_harness):
    harness = dispatch_harness(
        capabilities=["thread-workspaces", "task-workspaces", "project-workspaces"],
        project_snapshot={"projectId": "prj_one", "workspaceSubpath": "projects/prj_one"},
    )
    request = await harness.dispatch({"id": "tsk_one", "projectId": "prj_one"})
    assert request["workspaceLayout"] == "project"
    assert request["workspaceSubpath"] == "projects/prj_one"


@pytest.mark.asyncio
async def test_routine_occurrence_dispatch_nests_under_its_routine(dispatch_harness):
    harness = dispatch_harness(capabilities=["thread-workspaces", "task-workspaces"])
    request = await harness.dispatch(
        {"id": "tsk_run", "sourceRoutineId": "tsk_routine", "title": "Nightly"}
    )
    assert request["workspaceSubpath"] == "tasks/tsk_routine/tsk_run"
```

Build `dispatch_harness` from whatever fixture the existing task-dispatch tests use to reach `TaskDispatcher._request`; capture the request rather than running it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_task_dispatch.py -v`
Expected: FAIL — the request has no `workspaceLayout` for a non-project task.

- [ ] **Step 3: Use the resolver in `TaskDispatcher._request`**

In `backend/relay/services/task_dispatch.py`, import at the top:

```python
from .task_workspace import resolve_task_workspace
```

and replace the project block:

```python
        if self.project_snapshot:
            request.update(
                {
                    "projectId": self.project_snapshot["projectId"],
                    "workspaceLayout": "project",
                    "workspaceSubpath": self.project_snapshot["workspaceSubpath"],
                }
            )
```

with:

```python
        layout, subpath = resolve_task_workspace(
            self.task,
            node=self.ctx.registry.get(self.run_assignments[0]["daemonNodeId"]),
            project_snapshot=self.project_snapshot,
        )
        request["workspaceLayout"] = layout
        if subpath:
            request["workspaceSubpath"] = subpath
        if self.project_snapshot:
            request["projectId"] = self.project_snapshot["projectId"]
```

- [ ] **Step 4: Use the resolver in the scheduler**

In `backend/relay/tasks/scheduler.py`, import `resolve_task_workspace` from `..services.task_workspace`, then replace the inline conditional in the request dict:

```python
                    **(
                        {
                            "projectId": project_snapshot["projectId"],
                            "workspaceLayout": "project",
                            "workspaceSubpath": project_snapshot["workspaceSubpath"],
                        }
                        if project_snapshot
                        else {}
                    ),
```

with a value computed just above the `await self.backend.run(...)` call:

```python
            layout, subpath = resolve_task_workspace(
                task,
                node=self.registry.get(node_id),
                project_snapshot=project_snapshot,
            )
            workspace_fields: dict[str, Any] = {"workspaceLayout": layout}
            if subpath:
                workspace_fields["workspaceSubpath"] = subpath
            if project_snapshot:
                workspace_fields["projectId"] = project_snapshot["projectId"]
```

and splice `**workspace_fields,` into the request dict where the removed conditional was.

- [ ] **Step 5: Leave the collaboration service on the project branch**

`backend/relay/collaboration/service.py` dispatches chat threads, which have no task. Change nothing there. This step exists so an implementer reading the spec's "three builders" line does not go looking for a fourth edit: the collaboration builder only ever sets a project layout, and that stays correct.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests -v`
Expected: PASS, whole backend suite.

- [ ] **Step 7: Commit**

```bash
git add backend/relay/services/task_dispatch.py backend/relay/tasks/scheduler.py backend/tests
git commit -m "feat: dispatch backlog tasks and routines into task workspaces"
```

---

### Task 6: Task workspace browse routes

Two read routes mirroring the project pair. Authorization reuses the same helper the artifacts route uses, so owner rules cannot drift between the two task surfaces.

**Files:**
- Modify: `backend/relay/api/task_routes.py` — add two routes and two module-private helpers near the existing `task_artifacts` route
- Test: `backend/tests/api/test_task_workspace_routes.py`

**Interfaces:**
- Consumes: `task_workspace_subpath` from Task 1; `get_task_for_actor` from `.helpers`; `occurrence_tasks` already in `task_routes.py`; `dispatch_workspace_command`, `live_workspace_listing`, `live_workspace_file`, `raise_workspace_error`, `workspace_path` from `.workspace_transport`.
- Produces:
  - `GET /api/v1/tasks/{task_id}/workspace/files?path=` → `{taskId, scope: "shared", source: "live", nodeId, path, exists, entries, generatedAt}`
  - `GET /api/v1/tasks/{task_id}/workspace/file?path=` → the `live_workspace_file` shape with the same `taskId`/`scope`/`nodeId` metadata

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_task_workspace_routes.py`, modelled on `backend/tests/api/test_project_routes.py`'s workspace tests:

```python
def test_owner_lists_the_task_workspace(client, task_with_run):
    task, node = task_with_run(capabilities=["task-workspaces", "workspace-read-shared"])
    response = client.get(f"/api/v1/tasks/{task['id']}/workspace/files")
    assert response.status_code == 200
    body = response.json()
    assert body["taskId"] == task["id"]
    assert body["nodeId"] == node["id"]
    assert body["scope"] == "shared"


def test_another_employee_cannot_read_the_task_workspace(client, task_with_run, other_employee):
    task, _ = task_with_run(capabilities=["task-workspaces", "workspace-read-shared"])
    response = client.get(
        f"/api/v1/tasks/{task['id']}/workspace/files",
        headers=other_employee.headers,
    )
    assert response.status_code == 403


def test_node_without_shared_read_reports_placement_unavailable(client, task_with_run):
    task, _ = task_with_run(capabilities=["task-workspaces"])
    response = client.get(f"/api/v1/tasks/{task['id']}/workspace/files")
    assert response.status_code == 503
    assert response.json()["detail"]["reason"] == "placement-unavailable"


def test_task_that_never_dispatched_reports_placement_unavailable(client, backlog_task):
    response = client.get(f"/api/v1/tasks/{backlog_task['id']}/workspace/files")
    assert response.status_code == 503
    assert response.json()["detail"]["reason"] == "placement-unavailable"


def test_routine_lists_its_occurrence_directories(client, routine_with_occurrence):
    routine, occurrence, node = routine_with_occurrence(
        capabilities=["task-workspaces", "workspace-read-shared"]
    )
    response = client.get(f"/api/v1/tasks/{routine['id']}/workspace/files")
    assert response.status_code == 200
    assert response.json()["taskId"] == routine["id"]


def test_reads_a_file_from_the_task_workspace(client, task_with_run):
    task, _ = task_with_run(capabilities=["task-workspaces", "workspace-read-shared"])
    response = client.get(
        f"/api/v1/tasks/{task['id']}/workspace/file", params={"path": "report.md"}
    )
    assert response.status_code == 200
    assert response.json()["taskId"] == task["id"]
```

Build the fixtures from `backend/tests/api/test_project_routes.py`'s node registration helper, which already stubs a daemon that answers workspace commands.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_task_workspace_routes.py -v`
Expected: FAIL — 404, the routes do not exist.

- [ ] **Step 3: Write the helpers and routes**

Add to `backend/relay/api/task_routes.py`. Add to the `.helpers` import list nothing new; add these imports at the top:

```python
from ..services.task_workspace import task_workspace_subpath
from .workspace_transport import (
    dispatch_workspace_command,
    live_workspace_file,
    live_workspace_listing,
    raise_workspace_error,
    workspace_path,
)
```

Then, after the `task_artifacts` route:

```python
def _task_workspace_node(
    ctx: Any, task: dict[str, Any], actor: dict[str, Any]
) -> dict[str, Any]:
    """The live computer holding this task's workspace.

    Unlike a project, a task pins no computer of its own — it ran wherever its
    sessions ran. The newest linked session names the node; a routine never runs
    itself, so it borrows the node from its newest occurrence's session. A task
    that has not dispatched yet has no workspace to read, which reads to the
    caller the same way an offline computer does.
    """
    session_ids = list(task.get("linkedSessionIds") or [])
    for occurrence in occurrence_tasks(ctx, task, actor):
        session_ids.extend(occurrence.get("linkedSessionIds") or [])
    for session_id in reversed(session_ids):
        session = ctx.session_store.get_session(session_id)
        node_id = (session or {}).get("daemonNodeId")
        if not node_id:
            continue
        node = next(
            (item for item in ctx.registry.monitor_nodes() if item["id"] == node_id),
            None,
        )
        if (
            node
            and node.get("online")
            and "workspace-read-shared" in (node.get("capabilities") or [])
        ):
            return node
    raise HTTPException(503, {"reason": "placement-unavailable"})


def _task_workspace_command(
    task: dict[str, Any], *, command_id: str, command_type: str, path: str
) -> dict[str, Any]:
    return {
        "id": command_id,
        "type": command_type,
        # Task ids use the same validated database-id alphabet as sessions. The
        # daemon treats this only as a routing identifier; workspaceSubpath is
        # what selects the durable task root.
        "sessionId": task["id"],
        "workspaceLayout": "task",
        "workspaceSubpath": task_workspace_subpath(task),
        "path": path,
    }


@router.get("/tasks/{task_id}/workspace/files")
async def task_workspace_files(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    """Live listing of the directory this task's rounds share.

    Live reads need the computer to be up. The artifact index remains the
    durable record of what a task produced.
    """
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    path = workspace_path(request.query_params.get("path"))
    node = _task_workspace_node(ctx, task, actor)
    event = await dispatch_workspace_command(
        ctx,
        node,
        _task_workspace_command(
            task,
            command_id=new_database_id(),
            command_type="workspace.list",
            path=path,
        ),
    )
    raise_workspace_error(event)
    return live_workspace_listing(
        event,
        path=path,
        metadata={"taskId": task["id"], "scope": "shared", "nodeId": node["id"]},
    )


@router.get("/tasks/{task_id}/workspace/file")
async def task_workspace_file(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    path = workspace_path(request.query_params.get("path"), required=True)
    node = _task_workspace_node(ctx, task, actor)
    event = await dispatch_workspace_command(
        ctx,
        node,
        _task_workspace_command(
            task,
            command_id=new_database_id(),
            command_type="workspace.read",
            path=path,
        ),
    )
    raise_workspace_error(event)
    return live_workspace_file(
        event,
        path=path,
        metadata={"taskId": task["id"], "scope": "shared", "nodeId": node["id"]},
    )
```

If `new_database_id` is not already imported in `task_routes.py`, add `from ..core.ids import new_database_id`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/relay/api/task_routes.py backend/tests/api/test_task_workspace_routes.py
git commit -m "feat: browse a task's workspace over the API"
```

---

### Task 7: Task workspace section in the drawer

One new section in the drawer's existing stack, reusing the workspace browser components the project page and thread panel already share.

**Files:**
- Modify: `web/src/types.ts:78` and the response types near line 228
- Modify: `web/src/api.ts` — two new functions after `readProjectWorkspaceFile`
- Create: `web/src/components/task-board/TaskDrawerWorkspace.tsx`
- Modify: `web/src/components/task-board/TaskDrawer.tsx` — render the section between `TaskDrawerArtifacts` and the history/ledger
- Modify: `web/src/i18n/locales/{en,zh-CN,zh-TW}/translation.json`
- Test: `web/tests/taskWorkspace.test.ts`

**Interfaces:**
- Consumes: the two routes from Task 6.
- Produces: `listTaskWorkspaceFiles(input: { taskId: string; path?: string }, signal?: AbortSignal): Promise<TaskWorkspaceFilesResponse>` and `readTaskWorkspaceFile(input: { taskId: string; path: string }, signal?: AbortSignal): Promise<TaskWorkspaceFileResponse>`; component `TaskDrawerWorkspace({ taskId }: { taskId: string })`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/taskWorkspace.test.ts`, following the conventions in `web/tests/workspaceHome.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskWorkspaceState } from "../src/components/task-board/taskWorkspaceState";

describe("task workspace section state", () => {
  it("reports loading before the first response", () => {
    assert.equal(taskWorkspaceState({ isLoading: true, error: null, data: undefined }), "loading");
  });

  it("reports unavailable when the computer is offline", () => {
    const error = { status: 503, body: { reason: "placement-unavailable" } };
    assert.equal(taskWorkspaceState({ isLoading: false, error, data: undefined }), "unavailable");
  });

  it("reports empty when the workspace exists but holds nothing", () => {
    const data = { exists: true, entries: [] };
    assert.equal(taskWorkspaceState({ isLoading: false, error: null, data }), "empty");
  });

  it("reports ready when there are entries", () => {
    const data = { exists: true, entries: [{ name: "report.md", path: "report.md", kind: "file", bytes: 12, updatedAt: "" }] };
    assert.equal(taskWorkspaceState({ isLoading: false, error: null, data }), "ready");
  });

  it("reports failed for any other error", () => {
    assert.equal(taskWorkspaceState({ isLoading: false, error: { status: 500 }, data: undefined }), "failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/web/tests/taskWorkspace.test.js`
Expected: FAIL — `taskWorkspaceState` does not exist.

- [ ] **Step 3: Add the types**

In `web/src/types.ts`, widen line 78:

```typescript
  workspaceLayout?: "node-root" | "thread" | "project" | "task";
```

and add next to the project response types:

```typescript
export interface TaskWorkspaceFilesResponse {
  taskId: string;
  scope: "shared";
  source: "live";
  nodeId: string;
  path: string;
  exists: boolean;
  entries: WorkspaceFileEntry[];
  generatedAt: string;
}

export interface TaskWorkspaceFileResponse {
  taskId: string;
  scope: "shared";
  source: "live";
  nodeId: string;
  path: string;
  name: string;
  bytes: number;
  content: string;
  encoding: string;
  truncated: boolean;
  generatedAt: string;
}
```

Match `TaskWorkspaceFileResponse`'s field list to `ProjectWorkspaceFileResponse` exactly — read it and copy, substituting `taskId` for `projectId`.

- [ ] **Step 4: Add the API functions**

In `web/src/api.ts`, after `readProjectWorkspaceFile`:

```typescript
export function listTaskWorkspaceFiles(
  input: { taskId: string; path?: string },
  signal?: AbortSignal,
): Promise<TaskWorkspaceFilesResponse> {
  const params = new URLSearchParams();
  if (input.path) params.set("path", input.path);
  const query = params.toString();
  return apiJson<TaskWorkspaceFilesResponse>(`/tasks/${encodeURIComponent(input.taskId)}/workspace/files${query ? `?${query}` : ""}`, { signal });
}

export function readTaskWorkspaceFile(
  input: { taskId: string; path: string },
  signal?: AbortSignal,
): Promise<TaskWorkspaceFileResponse> {
  const params = new URLSearchParams({ path: input.path });
  return apiJson<TaskWorkspaceFileResponse>(`/tasks/${encodeURIComponent(input.taskId)}/workspace/file?${params.toString()}`, { signal });
}
```

Add both new types to the existing `types` import at the top of the file.

- [ ] **Step 5: Write the state helper**

Create `web/src/components/task-board/taskWorkspaceState.ts`:

```typescript
/** Which of the section's five renderings a query pair calls for.
 *
 *  Extracted from the component so the decision is testable without mounting
 *  React: "the computer is offline" and "the task produced nothing" look the
 *  same to a careless reader and must not be conflated in the UI. */
export type TaskWorkspaceState = "loading" | "unavailable" | "empty" | "ready" | "failed";

export function taskWorkspaceState(query: {
  isLoading: boolean;
  error: unknown;
  data: { exists: boolean; entries: unknown[] } | undefined;
}): TaskWorkspaceState {
  if (query.isLoading) return "loading";
  if (query.error) {
    const status = (query.error as { status?: number }).status;
    return status === 503 ? "unavailable" : "failed";
  }
  if (!query.data || !query.data.exists || query.data.entries.length === 0) return "empty";
  return "ready";
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build && node --test dist/web/tests/taskWorkspace.test.js`
Expected: PASS, 5 passed

- [ ] **Step 7: Write the component**

Create `web/src/components/task-board/TaskDrawerWorkspace.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTaskWorkspaceFiles, readTaskWorkspaceFile } from "../../api";
import type {
  TaskWorkspaceFileResponse,
  TaskWorkspaceFilesResponse,
} from "../../types";
import {
  WorkspaceFileList,
  WorkspacePathBreadcrumb,
} from "../workspace/WorkspaceFileList";
import { WorkspaceFilePreview } from "../workspace/WorkspaceFilePreview";
import { languageForFile } from "../CodeView";
import { ICON, NavBack } from "../icons";
import { Button } from "@/components/ui/button";
import { taskWorkspaceState } from "./taskWorkspaceState";

/** The directory this task's rounds share, browsed inside the task drawer.
 *
 *  Live reads only: the workspace exists on the computer that ran the task, so
 *  an offline computer renders as an explained empty state rather than an
 *  error. The artifact list above stays the durable record either way.
 *
 *  A routine lists its occurrence directories; the routine itself never runs. */
export function TaskDrawerWorkspace({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const selectedName = selectedPath ? selectedPath.split("/").at(-1) || selectedPath : "";

  const fileQuery = useQuery({
    queryKey: ["workspace-files", `task:${taskId}`, path, 0],
    retry: false,
    queryFn: ({ signal }): Promise<TaskWorkspaceFilesResponse> =>
      listTaskWorkspaceFiles({ taskId, path }, signal),
  });
  const contentQuery = useQuery({
    queryKey: ["workspace-file", `task:${taskId}`, selectedPath, 0],
    enabled: Boolean(selectedPath),
    retry: false,
    queryFn: ({ signal }): Promise<TaskWorkspaceFileResponse> =>
      readTaskWorkspaceFile({ taskId, path: selectedPath }, signal),
  });

  function openDirectory(next: string): void {
    setPath(next);
    setSelectedPath("");
  }

  const state = taskWorkspaceState({
    isLoading: fileQuery.isLoading,
    error: fileQuery.error,
    data: fileQuery.data,
  });

  return (
    <section className="task-drawer-artifacts" aria-label={t("backlog.workspace")}>
      <h3 className="task-drawer-artifacts-title">{t("backlog.workspace")}</h3>
      {state === "loading" ? (
        <p className="task-drawer-artifacts-empty" role="status" aria-live="polite">
          {t("backlog.workspace_loading")}
        </p>
      ) : state === "unavailable" ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.workspace_unavailable")}</p>
      ) : state === "failed" ? (
        <p className="task-drawer-artifacts-empty" role="alert">
          {t("backlog.workspace_error")}
        </p>
      ) : state === "empty" ? (
        <p className="task-drawer-artifacts-empty">{t("backlog.workspace_empty")}</p>
      ) : selectedPath ? (
        <div className="thread-space-files">
          <div className="thread-space-files-bar">
            <Button
              variant="ghost"
              type="button"
              className="thread-space-back"
              onClick={() => setSelectedPath("")}
            >
              <NavBack size={ICON.sm} />
              <span>{selectedName}</span>
            </Button>
            <span className="workspace-preview-file-type code">{languageForFile(selectedName)}</span>
          </div>
          <div className="thread-space-files-body">
            <WorkspaceFilePreview
              name={selectedName}
              data={contentQuery.data}
              isLoading={contentQuery.isLoading}
              error={contentQuery.isError ? contentQuery.error : null}
            />
          </div>
        </div>
      ) : (
        <div className="thread-space-files">
          <div className="thread-space-files-bar">
            <WorkspacePathBreadcrumb path={path} onNavigate={openDirectory} />
          </div>
          <div className="thread-space-files-body">
            <WorkspaceFileList
              data={fileQuery.data}
              error={fileQuery.error}
              isLoading={fileQuery.isLoading}
              path={path}
              selectedPath={selectedPath}
              onOpenDirectory={openDirectory}
              onSelectFile={(entry) => setSelectedPath(entry.path)}
              onRetry={() => void fileQuery.refetch()}
            />
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Render it in the drawer**

In `web/src/components/task-board/TaskDrawer.tsx`, add the import beside the others:

```tsx
import { TaskDrawerWorkspace } from "./TaskDrawerWorkspace";
```

and place the section immediately after `<TaskDrawerArtifacts taskId={form.id} />`:

```tsx
            {/* Files produced sit next to files indexed: the artifact list is
                the durable record, the workspace is what is there right now. */}
            <TaskDrawerWorkspace taskId={form.id} />
```

- [ ] **Step 9: Add the copy**

In `web/src/i18n/locales/en/translation.json`, in the `backlog` object beside `artifacts`:

```json
    "workspace": "Workspace",
    "workspace_loading": "Loading workspace…",
    "workspace_empty": "Nothing in this task's workspace yet.",
    "workspace_unavailable": "The computer that ran this task is offline, so its workspace cannot be read right now.",
    "workspace_error": "Could not load the workspace.",
```

Add the same five keys to `web/src/i18n/locales/zh-CN/translation.json`:

```json
    "workspace": "工作区",
    "workspace_loading": "正在加载工作区…",
    "workspace_empty": "此任务的工作区暂无内容。",
    "workspace_unavailable": "运行此任务的电脑已离线，暂时无法读取其工作区。",
    "workspace_error": "无法加载工作区。",
```

and to `web/src/i18n/locales/zh-TW/translation.json`:

```json
    "workspace": "工作區",
    "workspace_loading": "正在載入工作區…",
    "workspace_empty": "此任務的工作區尚無內容。",
    "workspace_unavailable": "執行此任務的電腦已離線，暫時無法讀取其工作區。",
    "workspace_error": "無法載入工作區。",
```

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS, TypeScript and Python suites both green.

- [ ] **Step 11: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/src/components/task-board/TaskDrawerWorkspace.tsx web/src/components/task-board/taskWorkspaceState.ts web/src/components/task-board/TaskDrawer.tsx web/src/i18n/locales web/tests/taskWorkspace.test.ts
git commit -m "feat: browse a task's workspace from the task drawer"
```

---

### Task 8: Document the invariant

The CLAUDE.md key-invariants list is where this codebase records rules that are easy to break from a distance. A derived-not-stored path with a capability fallback is exactly that kind of rule.

**Files:**
- Modify: `CLAUDE.md` — key invariants section, after the agent-home workspace bullet

- [ ] **Step 1: Add the invariant**

```markdown
- **A task's workspace is derived, not stored.** A backlog task's rounds share `tasks/<taskId>/` under the node root, and a routine occurrence nests at `tasks/<sourceRoutineId>/<taskId>/` so a routine's runs are isolated but browsable together. `backend/relay/services/task_workspace.py` is the one seam that resolves it — never rebuild the path at a call site. A task dispatched into a project keeps the project workspace; the project always wins. The layout is chosen at dispatch against the already-chosen node, so a daemon without the `task-workspaces` capability degrades to the per-thread directory instead of failing the run (a project *is* its workspace, so its gate stays fatal). Because rounds now share a directory, the daemon's `workspaceRunGate` must key on the task workspace or concurrent rounds overwrite each other.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the task workspace invariant"
```

---

## Follow-on, not in this plan

`task_rounds.continuation_session_id` forces a continuation round back into the original thread solely because a thread workspace belongs to its session. Once a task owns its workspace that constraint is gone and a continuation round could start a fresh thread while still seeing prior work. Worth doing; it changes round semantics, so it belongs in its own change.
