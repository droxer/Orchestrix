# Employee Computer Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee (non-admin user) see the computer(s) assigned to them from the sidebar, and rename or manage which agent executors run on their own computer(s).

**Architecture:** A new `/computer` route + sidebar nav item, backed by a new employee-scoped `PATCH /daemon-nodes/{id}/disabled-agents` backend endpoint (rename already works for employees today). The new page reuses the existing admin `NodeCard`/`ManageExecutorsDrawer` components, generalized so the destructive/sensitive admin-only actions (reveal credentials, delete) simply don't render when their handlers aren't passed.

**Tech Stack:** FastAPI (backend/relay), Next.js + React + TypeScript (web), `node:test` for TS unit tests, `pytest` for backend tests.

## Global Constraints

- No new daemon capability, no `workspace.write` — this feature does not touch file browsing/editing at all (explicitly out of scope, see the design doc).
- The `/admin/*` surface and its behavior must not change — admin call sites keep working exactly as before.
- Every route-keyed `Record<Exclude<AppRoute, "main">, string>` map (`WORK_PATHS`, `WORK_ROUTE_SKIP_IDS`, `WORK_ROUTE_LABEL_KEYS`) must get a `computer` entry — TypeScript will not compile otherwise.
- i18n keys must be added to all three locales: `web/src/i18n/locales/{en,zh-CN,zh-TW}/translation.json`.
- Follow existing patterns exactly where they exist (e.g. the actor-scoped rename endpoint's permission shape, the `onDelete?`-optional pattern already used on `NodeCard`/`NodeRow`/`NodeActions`).

Reference: design doc at `docs/superpowers/specs/2026-08-01-employee-computer-sidebar-design.md`.

---

## Task 1: Backend — actor-scoped disabled-agents endpoint

**Files:**
- Modify: `backend/relay/api/daemon_node_routes.py` (add new handler after `update_daemon_node`, i.e. after line 158)
- Test: `backend/tests/api/test_daemon_api.py` (add new tests after `test_employee_can_create_own_device_enrollment`)

**Interfaces:**
- Produces: `PATCH /api/v1/daemon-nodes/{sandbox_id}/disabled-agents` — body `{"disabledAgents": string[]}`, returns `{"node": {...}}` (200), 404 if node missing, 403 if actor doesn't own the node and isn't admin, 400 if `disabledAgents` isn't a list of strings or contains an unknown agent name.
- Consumes: `ctx.registry.get`, `ctx.registry.set_disabled_agents`, `ctx.registry.monitor_nodes` (all pre-existing on `DaemonNodeRegistry`), `request_actor`, `actor_can_access_sandbox`, `json_body` (all already imported in this file), `present_computer`, `public_sandbox_record` (already imported).

- [ ] **Step 1: Write the failing tests**

Open `backend/tests/api/test_daemon_api.py` and add these four tests directly after `test_employee_can_create_own_device_enrollment` (which ends around line 2034, right before `def test_control_panel_creates_unassigned_pending_daemon_node`):

```python
def test_employee_can_manage_own_computer_executors(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={"employeeId": "alice", "username": "alice", "password": "userpass"},
            ).status_code
            == 201
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        enrolled = client.post(
            "/api/v1/daemon-node-enrollments/local",
            json={"workspacePath": "/Users/alice/project", "sandboxMode": "boxlite"},
        )
        assert enrolled.status_code == 201
        node_id = enrolled.json()["node"]["id"]

        response = client.patch(
            f"/api/v1/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": ["codex"]},
        )

        assert response.status_code == 200
        assert response.json()["node"]["disabledAgents"] == ["codex"]


def test_employee_cannot_manage_another_employees_computer_executors(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        for employee_id in ("alice", "bob"):
            assert (
                client.post(
                    "/api/v1/admin/employees",
                    json={"employeeId": employee_id, "username": employee_id, "password": "userpass"},
                ).status_code
                == 201
            )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        enrolled = client.post(
            "/api/v1/daemon-node-enrollments/local",
            json={"workspacePath": "/Users/alice/project", "sandboxMode": "boxlite"},
        )
        assert enrolled.status_code == 201
        node_id = enrolled.json()["node"]["id"]
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "bob", "password": "userpass"}
            ).status_code
            == 200
        )

        response = client.patch(
            f"/api/v1/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": ["codex"]},
        )

        assert response.status_code == 403


def test_admin_can_manage_any_computers_executors(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={"employeeId": "alice", "username": "alice", "password": "userpass"},
            ).status_code
            == 201
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        enrolled = client.post(
            "/api/v1/daemon-node-enrollments/local",
            json={"workspacePath": "/Users/alice/project", "sandboxMode": "boxlite"},
        )
        assert enrolled.status_code == 201
        node_id = enrolled.json()["node"]["id"]
        assert client.post("/api/v1/auth/logout").status_code == 200
        _login_admin(client)

        response = client.patch(
            f"/api/v1/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": ["pi"]},
        )

        assert response.status_code == 200
        assert response.json()["node"]["disabledAgents"] == ["pi"]


def test_disabled_agents_endpoint_rejects_invalid_payload(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        client = TestClient(create_app(root))
        _bootstrap_admin(client)
        _login_admin(client)
        assert (
            client.post(
                "/api/v1/admin/employees",
                json={"employeeId": "alice", "username": "alice", "password": "userpass"},
            ).status_code
            == 201
        )
        assert client.post("/api/v1/auth/logout").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/login", json={"username": "alice", "password": "userpass"}
            ).status_code
            == 200
        )
        enrolled = client.post(
            "/api/v1/daemon-node-enrollments/local",
            json={"workspacePath": "/Users/alice/project", "sandboxMode": "boxlite"},
        )
        assert enrolled.status_code == 201
        node_id = enrolled.json()["node"]["id"]

        response = client.patch(
            f"/api/v1/daemon-nodes/{node_id}/disabled-agents",
            json={"disabledAgents": "codex"},
        )

        assert response.status_code == 400
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py -k "computer_executors or disabled_agents_endpoint" -v`
Expected: FAIL — all four with 404 (the route doesn't exist yet, FastAPI returns 404 for unmatched routes).

- [ ] **Step 3: Implement the endpoint**

In `backend/relay/api/daemon_node_routes.py`, insert this new handler immediately after `update_daemon_node` (after the closing `}` return at line 158, before the blank lines leading into `create_local_device_enrollment`):

```python
@router.patch("/daemon-nodes/{sandbox_id}/disabled-agents")
async def update_daemon_node_disabled_agents(
    sandbox_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    node = ctx.registry.get(sandbox_id)
    if not node:
        raise HTTPException(404, "Daemon node not found.")
    if not actor_can_access_sandbox(actor, node):
        raise HTTPException(403, "Daemon node access denied.")
    body = await json_body(request)
    raw = body.get("disabledAgents")
    if not isinstance(raw, list) or not all(isinstance(name, str) for name in raw):
        raise HTTPException(400, "disabledAgents must be an array of agent names.")
    try:
        updated = ctx.registry.set_disabled_agents(sandbox_id, raw)
    except KeyError as error:
        raise HTTPException(404, "Daemon node not found.") from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    monitor_node = next(
        (node for node in ctx.registry.monitor_nodes() if node["id"] == sandbox_id),
        public_sandbox_record(updated),
    )
    return {"node": present_computer(ctx, monitor_node)}
```

No new imports are needed — `request_actor`, `actor_can_access_sandbox`, `json_body`, `present_computer`, and `public_sandbox_record` are already imported at the top of this file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_daemon_api.py -k "computer_executors or disabled_agents_endpoint" -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/relay/api/daemon_node_routes.py backend/tests/api/test_daemon_api.py
git commit -m "feat(backend): let employees manage executors on their own computer"
```

---

## Task 2: Frontend — API client function for the new endpoint

**Files:**
- Modify: `web/src/api.ts` (add function after `updateComputerDisplayName`, i.e. after line 149)

**Interfaces:**
- Consumes: `AgentName`, `DaemonNodeMonitorRecord` types (already imported in this file); `apiJson` helper (already defined in this file).
- Produces: `updateDaemonNodeDisabledAgents(nodeId: string, disabledAgents: AgentName[]): Promise<{ node: DaemonNodeMonitorRecord }>` — used by Task 5 and Task 8.

- [ ] **Step 1: Add the function**

In `web/src/api.ts`, insert immediately after `updateComputerDisplayName` (after the closing `}` on line 149, before `listEmployeeAgents`):

```typescript
export function updateDaemonNodeDisabledAgents(
  nodeId: string,
  disabledAgents: AgentName[],
): Promise<{ node: DaemonNodeMonitorRecord }> {
  return apiJson<{ node: DaemonNodeMonitorRecord }>(
    `/daemon-nodes/${encodeURIComponent(nodeId)}/disabled-agents`,
    { method: "PATCH", body: { disabledAgents } },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no new errors (this function isn't called yet, so it's just checked for its own correctness — `AgentName` and `DaemonNodeMonitorRecord` are already imported in this file).

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(web): add employee-scoped API client for managing computer executors"
```

---

## Task 3: Frontend — `nodesAssignedToEmployee` lib helper

**Files:**
- Create: `web/src/lib/computerNodes.ts`
- Test: `web/tests/computerNodes.test.ts`

**Interfaces:**
- Consumes: `DaemonNodeMonitorRecord` type from `web/src/types.ts`.
- Produces: `nodesAssignedToEmployee(nodes: DaemonNodeMonitorRecord[], employeeId: string | undefined): DaemonNodeMonitorRecord[]` — used by Task 8 (`ComputerPage.tsx`).

- [ ] **Step 1: Write the failing test**

Create `web/tests/computerNodes.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodesAssignedToEmployee } from "../src/lib/computerNodes.js";
import type { DaemonNodeMonitorRecord } from "../src/types.js";

function node(overrides: Partial<DaemonNodeMonitorRecord> & { id: string }): DaemonNodeMonitorRecord {
  return {
    status: "ready",
    agents: { claude: "unknown", pi: "unknown", codex: "unknown", kimi: "unknown" },
    online: true,
    stale: false,
    queuedCommandCount: 0,
    activeRuns: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("nodesAssignedToEmployee", () => {
  it("returns only nodes owned by the given employee", () => {
    const nodes = [
      node({ id: "sbx_alice_1", employeeId: "alice" }),
      node({ id: "sbx_bob", employeeId: "bob" }),
      node({ id: "sbx_alice_2", employeeId: "alice" }),
    ];

    assert.deepEqual(
      nodesAssignedToEmployee(nodes, "alice").map((n) => n.id),
      ["sbx_alice_1", "sbx_alice_2"],
    );
  });

  it("returns an empty array when no employeeId is given", () => {
    const nodes = [node({ id: "sbx_alice", employeeId: "alice" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, undefined), []);
  });

  it("returns an empty array when the employee has no assigned nodes", () => {
    const nodes = [node({ id: "sbx_alice", employeeId: "alice" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, "carol"), []);
  });

  it("ignores nodes with no employeeId at all", () => {
    const nodes = [node({ id: "sbx_unassigned" })];
    assert.deepEqual(nodesAssignedToEmployee(nodes, "alice"), []);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./node_modules/.bin/tsc -p packages/tsconfig.json
node --test dist/web/tests/computerNodes.test.js
```
Expected: the `tsc` step FAILS with "Cannot find module '../src/lib/computerNodes.js'" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/computerNodes.ts`:

```typescript
import type { DaemonNodeMonitorRecord } from "../types.js";

/** Nodes assigned to one employee — what an employee sees on their own computer page. */
export function nodesAssignedToEmployee(
  nodes: DaemonNodeMonitorRecord[],
  employeeId: string | undefined,
): DaemonNodeMonitorRecord[] {
  if (!employeeId) return [];
  return nodes.filter((node) => node.employeeId === employeeId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
./node_modules/.bin/tsc -p packages/tsconfig.json
node --test dist/web/tests/computerNodes.test.js
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/computerNodes.ts web/tests/computerNodes.test.ts
git commit -m "feat(web): add nodesAssignedToEmployee helper"
```

---

## Task 4: Frontend — make `onReveal` optional on the shared node card UI

**Files:**
- Modify: `web/src/components/admin/NodeActions.tsx`
- Modify: `web/src/components/admin/NodeCard.tsx`
- Modify: `web/src/components/admin/NodeRow.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NodeActionsProps.onReveal`, `NodeCardProps.onReveal`, `NodeRowProps.onReveal` all become `(node: ControlPanelDaemonNodeRecord) => void | undefined` (optional) instead of required. `NodeCard`/`NodeRow`/`NodeActions` no longer require an `onReveal` prop — used by Task 8 (`ComputerPage.tsx` renders `NodeCard` without passing `onReveal`, so the reveal-credentials button doesn't appear).

This mirrors the `onDelete?` pattern already on all three components — same shape, same reasoning: the button only renders when its handler is passed.

- [ ] **Step 1: Widen `NodeActions.tsx`**

In `web/src/components/admin/NodeActions.tsx`, change the prop type:

```typescript
interface NodeActionsProps {
  node: ControlPanelDaemonNodeRecord;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  deletePending: boolean;
  onDeleteRequest: () => void;
  t: TFunction;
}
```

And change the reveal-credentials button's guard condition from `{node.managedNodeId ? null : (` to also require `onReveal`:

```tsx
      {node.managedNodeId || !onReveal ? null : (
        <Button
          variant="ghost"
          type="button"
          className="icon-button icon-button--sm icon-button--tinted adm-node-card-icon-btn adm-node-action--credentials"
          onClick={() => onReveal(node)}
          aria-label={t("admin.v2.reveal_credentials_for", { id: node.id })}
          title={t("admin.v2.reveal_credentials")}
        >
          <ActionKey size={14} aria-hidden="true" />
        </Button>
      )}
```

- [ ] **Step 2: Widen `NodeCard.tsx`**

In `web/src/components/admin/NodeCard.tsx`, change the prop type (the rest of the file — `onReveal={onReveal}` passthrough to `NodeActions` — needs no change since it's already just forwarding the value):

```typescript
interface NodeCardProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens?: StoredNodeTokenMap;
  colocated?: boolean;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}
```

- [ ] **Step 3: Widen `NodeRow.tsx`**

In `web/src/components/admin/NodeRow.tsx`, change the prop type (same reasoning — `onReveal` passthrough to `NodeActions` needs no change):

```typescript
interface NodeRowProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  onReveal?: (node: ControlPanelDaemonNodeRecord) => void;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDelete?: (node: ControlPanelDaemonNodeRecord) => Promise<void>;
  t: TFunction;
}
```

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors. The admin call sites in `web/src/components/admin/NodesView.tsx` still pass `onReveal={onRevealCredentials}` explicitly, so their behavior is unchanged — widening a required prop to optional never breaks an existing caller that already supplies it.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/admin/NodeActions.tsx web/src/components/admin/NodeCard.tsx web/src/components/admin/NodeRow.tsx
git commit -m "refactor(web): make onReveal optional on shared node card UI"
```

---

## Task 5: Frontend — make `ManageExecutorsDrawer` save-endpoint-agnostic

**Files:**
- Modify: `web/src/components/admin/ManageExecutorsDrawer.tsx`
- Modify: `web/src/components/AdminPage.tsx`

**Interfaces:**
- Consumes: `updateDaemonNodeDisabledAgents` from Task 2 (used by Task 8, not this task).
- Produces: `ManageExecutorsDrawerProps.onSave: (nodeId: string, disabledAgents: AgentName[]) => Promise<{ node: ControlPanelDaemonNodeRecord }>` — the drawer no longer imports `updateControlPanelDaemonNodeDisabledAgents` directly. Used by Task 8 (`ComputerPage.tsx` passes `updateDaemonNodeDisabledAgents`).

- [ ] **Step 1: Thread `onSave` through the drawer**

In `web/src/components/admin/ManageExecutorsDrawer.tsx`:

Remove the now-unused import (line 5):
```typescript
import { updateControlPanelDaemonNodeDisabledAgents } from "../../api";
```

Add `onSave` to the props interface:

```typescript
interface ManageExecutorsDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ControlPanelDaemonNodeRecord | null;
  onUpdated: (node: ControlPanelDaemonNodeRecord) => void;
  onSave: (nodeId: string, disabledAgents: AgentName[]) => Promise<{ node: ControlPanelDaemonNodeRecord }>;
}
```

Add `onSave` to the destructured function parameters:

```typescript
export function ManageExecutorsDrawer({ open, onClose, node, onUpdated, onSave }: ManageExecutorsDrawerProps) {
```

In `handleSave`, replace the direct API call:

```typescript
      let updatedNode = node;
      if (!disabledSetsEqual(disabled, initialDisabled)) {
        const result = await onSave(
          node.id,
          normalizeDisabledAgentsPayload(disabled),
        );
        updatedNode = result.node;
      }
```

- [ ] **Step 2: Wire the admin call site**

In `web/src/components/AdminPage.tsx`, find the `<ManageExecutorsDrawer ... />` element (around line 542) and add the `onSave` prop:

```tsx
      <ManageExecutorsDrawer
        open={manageExecutorsNodeId !== null}
        onClose={() => setManageExecutorsNodeId(null)}
        node={manageExecutorsNode}
        onUpdated={handleNodeUpdated}
        onSave={updateControlPanelDaemonNodeDisabledAgents}
      />
```

`updateControlPanelDaemonNodeDisabledAgents` is already imported in this file (used to be imported only by the drawer — it's a different function than the one the drawer used to call directly; verify the import still exists in `AdminPage.tsx`'s import block. It does not currently exist there, so add it): update the `../api` import line (around line 11) to include it:

```typescript
import { deleteControlPanelDaemonNode, deleteControlPanelEmployee, deleteManagedNode, getAuthStatus, getMe, listManagedNodes, permanentlyDeleteManagedNode, recoverManagedNode, unassignControlPanelDaemonNode, updateComputerDisplayName, updateControlPanelDaemonNodeDisabledAgents, updateManagedNodeDisplayName } from "../api";
```

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Run the existing manage-executors unit tests to confirm no regression**

Run:
```bash
./node_modules/.bin/tsc -p packages/tsconfig.json
node --test dist/web/tests/manageExecutors.test.js
```
Expected: PASS — this file tests the pure helpers (`disabledSetsEqual`, `newlyDisabledReadyAgents`, etc.) which this task does not touch, so it must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/admin/ManageExecutorsDrawer.tsx web/src/components/AdminPage.tsx
git commit -m "refactor(web): make ManageExecutorsDrawer save-endpoint-agnostic"
```

---

## Task 6: Frontend — add the `computer` route

**Files:**
- Modify: `web/src/lib/viewTypes.ts`
- Modify: `web/src/lib/appRoute.ts`
- Test: `web/tests/appRoute.test.ts`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `AppRoute` now includes `"computer"`; `hrefForRoute("computer")` returns `"/computer"`; `parseAppPath("/computer")` returns `{ route: "computer", ... }`. Used by Task 7 (sidebar nav button) and Task 8 (`ComputerPage.tsx` route branch).

- [ ] **Step 1: Write the failing test**

In `web/tests/appRoute.test.ts`, add `"/computer": "computer"` to the `routes` map inside the `it("parses every canonical collection and detail path", ...)` test (around line 19-26):

```typescript
    const routes = {
      "/backlog": "backlog",
      "/routines": "routine",
      "/agents": "agents",
      "/teams": "teams",
      "/channels": "channels",
      "/admin": "admin",
      "/computer": "computer",
    } as const;
```

Also add a line to the `it("formats clean paths with encoded entity ids", ...)` test (around line 33-38), right after the `hrefForRoute("routine")` assertion:

```typescript
    assert.equal(hrefForRoute("computer"), "/computer");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./node_modules/.bin/tsc -p packages/tsconfig.json
node --test dist/web/tests/appRoute.test.js
```
Expected: FAIL — TypeScript compile error, `"computer"` is not assignable to `AppRoute`.

- [ ] **Step 3: Add `"computer"` to the `AppRoute` union**

In `web/src/lib/viewTypes.ts`:

```typescript
export type MobileView = "threads" | "chat";
export type AppRoute = "main" | "backlog" | "routine" | "agents" | "teams" | "channels" | "admin" | "computer";
```

- [ ] **Step 4: Add the path mapping**

In `web/src/lib/appRoute.ts`, add `computer: "/computer"` to `WORK_PATHS` (lines 3-10):

```typescript
const WORK_PATHS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "/backlog",
  routine: "/routines",
  agents: "/agents",
  teams: "/teams",
  channels: "/channels",
  admin: "/admin",
  computer: "/computer",
};
```

- [ ] **Step 5: Fill in the other two route-keyed maps (TypeScript will otherwise fail to compile)**

In `web/src/components/AppShell.tsx`, add `computer: "nav.computer"` to `WORK_ROUTE_LABEL_KEYS` (lines 14-21):

```typescript
const WORK_ROUTE_LABEL_KEYS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "nav.backlog",
  routine: "nav.routine",
  agents: "nav.agents",
  teams: "nav.teams",
  channels: "nav.channels",
  admin: "nav.admin",
  computer: "nav.computer",
};
```

In `web/src/App.tsx`, add `computer: "computer-panel"` to `WORK_ROUTE_SKIP_IDS` (lines 67-74):

```typescript
const WORK_ROUTE_SKIP_IDS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "backlog-panel",
  routine: "routine-panel",
  agents: "agents-panel",
  teams: "teams-panel",
  channels: "channels-panel",
  admin: "admin-panel",
  computer: "computer-panel",
};
```

- [ ] **Step 6: Add the `nav.computer` translation key (referenced by `WORK_ROUTE_LABEL_KEYS` above, needed for the app to render without a missing-key warning)**

In `web/src/i18n/locales/en/translation.json`, inside the `"nav": { ... }` object, add `"computer"` right after `"threads"` (line 52):

```json
    "threads": "Threads",
    "computer": "My Computer",
```

In `web/src/i18n/locales/zh-CN/translation.json`, same position:

```json
    "threads": "对话",
    "computer": "我的电脑",
```

In `web/src/i18n/locales/zh-TW/translation.json`, same position:

```json
    "threads": "對話",
    "computer": "我的電腦",
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
./node_modules/.bin/tsc -p packages/tsconfig.json
node --test dist/web/tests/appRoute.test.js
```
Expected: PASS.

- [ ] **Step 8: Typecheck the whole web app**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors — `AppRoute` now has a 9th member, and every map that's keyed by it has a `computer` entry.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/viewTypes.ts web/src/lib/appRoute.ts web/tests/appRoute.test.ts web/src/components/AppShell.tsx web/src/App.tsx web/src/i18n/locales/en/translation.json web/src/i18n/locales/zh-CN/translation.json web/src/i18n/locales/zh-TW/translation.json
git commit -m "feat(web): add the computer route"
```

---

## Task 7: Frontend — sidebar nav button

**Files:**
- Modify: `web/src/components/icons.tsx`
- Modify: `web/src/components/SideNav.tsx`

**Interfaces:**
- Consumes: `AppRoute` including `"computer"` (Task 6).
- Produces: `NavComputer` icon export; a nav button in the sidebar, visible to every authenticated user (not gated by `isAdmin`), that navigates to the `computer` route.

- [ ] **Step 1: Add the icon**

In `web/src/components/icons.tsx`, add this export right after `NavNewThread` (line 116) — `Server` is already imported at the top of this file (used by `AdminNode` at line 205):

```typescript
export const NavComputer = withStandardStroke(Server, "NavComputer");
```

- [ ] **Step 2: Add the nav button**

In `web/src/components/SideNav.tsx`:

Add `NavComputer` to the icon import list (line 4-8):

```typescript
import {
  NavAdmin, NavAgents, NavBacklog, NavChannels, NavComputer, NavLogout, NavMore, NavPreferences, NavThreads,
  NavTeams,
  NavRoutine, NavSidebarCollapse, NavSidebarExpand,
} from "./icons";
```

In the first `sidenav-group` (the one containing only the Threads button, lines 218-234), add a second `<a>` right after the Threads button and before the closing `</div>`:

```tsx
          <a
            className={`sidenav-btn ${route === "computer" ? "active" : ""}`}
            data-nav="computer"
            href={hrefForRoute("computer")}
            aria-label={t("nav.computer")}
            aria-current={route === "computer" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "computer")}
            onMouseEnter={(e) => showNavTooltip(t("nav.computer"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.computer"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavComputer size={18} aria-hidden="true" />
            <span className="sidenav-label sr-only">{t("nav.computer")}</span>
          </a>
```

Note: `SideNav` receives `hrefForRoute` as a prop (see the function signature at the top of the file) — use that prop, not the module from `lib/appRoute.ts` directly, matching how the Threads button above it calls `hrefForRoute("main")`.

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/icons.tsx web/src/components/SideNav.tsx
git commit -m "feat(web): add My Computer sidebar nav button"
```

---

## Task 8: Frontend — `ComputerPage` and final wiring

**Files:**
- Create: `web/src/components/ComputerPage.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `nodesAssignedToEmployee` (Task 3), `NodeCard` with optional `onReveal` (Task 4), `ManageExecutorsDrawer` with `onSave` (Task 5), `updateComputerDisplayName` (existing), `updateDaemonNodeDisabledAgents` (Task 2), `computer` route (Task 6).
- Produces: `ComputerPage({ nodes: DaemonNodeMonitorRecord[], currentUser: CurrentUser })` — the employee's own-computer view.

- [ ] **Step 1: Create the page component**

Create `web/src/components/ComputerPage.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateComputerDisplayName, updateDaemonNodeDisabledAgents } from "../api";
import type { ControlPanelDaemonNodeRecord, CurrentUser, DaemonNodeMonitorRecord } from "../types";
import { nodesAssignedToEmployee } from "../lib/computerNodes";
import { useMutationError } from "../hooks/useMutationError";
import { useDialogs } from "./ui/DialogProvider";
import { NodeCard } from "./admin/NodeCard";
import { ManageExecutorsDrawer } from "./admin/ManageExecutorsDrawer";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { AdminNode } from "./icons";

export function ComputerPage({
  nodes,
  currentUser,
}: {
  nodes: DaemonNodeMonitorRecord[];
  currentUser: CurrentUser;
}) {
  const { t } = useTranslation();
  const { prompt } = useDialogs();
  const { reportMutationError } = useMutationError();
  const [overrides, setOverrides] = useState<Record<string, ControlPanelDaemonNodeRecord>>({});
  const [manageExecutorsNodeId, setManageExecutorsNodeId] = useState<string | null>(null);

  const myNodes = useMemo<ControlPanelDaemonNodeRecord[]>(
    () =>
      nodesAssignedToEmployee(nodes, currentUser.employeeId).map(
        (node): ControlPanelDaemonNodeRecord => overrides[node.id] ?? node,
      ),
    [nodes, currentUser.employeeId, overrides],
  );
  const manageExecutorsNode = myNodes.find((node) => node.id === manageExecutorsNodeId) ?? null;

  function handleNodeUpdated(updated: ControlPanelDaemonNodeRecord) {
    setOverrides((prev) => ({ ...prev, [updated.id]: updated }));
  }

  async function handleRenameNode(node: ControlPanelDaemonNodeRecord) {
    const current = node.displayName?.trim() && node.displayName !== node.id
      ? node.displayName.trim()
      : "";
    const result = await prompt({
      title: t("thread.rename_computer"),
      message: t("thread.rename_computer_message", { id: node.id }),
      defaultValue: current,
      placeholder: t("thread.computer_name_placeholder"),
      confirmLabel: t("thread.rename"),
    });
    if (result === null) return;
    const displayName = result.trim();
    if (displayName === current) return;
    try {
      const updated = await updateComputerDisplayName(node.id, displayName || null);
      handleNodeUpdated({ ...node, ...updated.node });
    } catch (error) {
      reportMutationError("Failed to rename computer", error, t("errors.rename_computer"));
    }
  }

  return (
    <section id="computer-panel" className="computer-page" aria-label={t("computer.title")} tabIndex={-1}>
      <PageHeader
        kicker={t("nav.workspace")}
        title={t("computer.title")}
        count={t("computer.count", { count: myNodes.length })}
        titleVariant="display"
        layout="stacked"
      />
      {myNodes.length === 0 ? (
        <RelayEmptyState
          title={t("computer.empty_title")}
          body={t("computer.empty_body")}
          illustration={<AdminNode size={40} aria-hidden="true" />}
        />
      ) : (
        <div className="adm-fleet-grid">
          {myNodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onRename={(target) => void handleRenameNode(target)}
              onManageExecutors={(target) => setManageExecutorsNodeId(target.id)}
              t={t}
            />
          ))}
        </div>
      )}
      <ManageExecutorsDrawer
        open={manageExecutorsNodeId !== null}
        onClose={() => setManageExecutorsNodeId(null)}
        node={manageExecutorsNode}
        onUpdated={handleNodeUpdated}
        onSave={updateDaemonNodeDisabledAgents}
      />
    </section>
  );
}
```

- [ ] **Step 2: Add the i18n content keys**

In `web/src/i18n/locales/en/translation.json`, insert a new top-level `"computer"` namespace right after the `"teams"` object closes (after line 373, before `"routine": {` on line 374):

```json
  "computer": {
    "title": "My Computer",
    "count_one": "{{count}} computer",
    "count_other": "{{count}} computers",
    "empty_title": "No computer assigned yet",
    "empty_body": "Ask an admin to assign a computer to you."
  },
```

In `web/src/i18n/locales/zh-CN/translation.json`, same position:

```json
  "computer": {
    "title": "我的电脑",
    "count_one": "{{count}} 台电脑",
    "count_other": "{{count}} 台电脑",
    "empty_title": "尚未分配电脑",
    "empty_body": "请联系管理员为你分配一台电脑。"
  },
```

In `web/src/i18n/locales/zh-TW/translation.json`, same position:

```json
  "computer": {
    "title": "我的電腦",
    "count_one": "{{count}} 台電腦",
    "count_other": "{{count}} 台電腦",
    "empty_title": "尚未分配電腦",
    "empty_body": "請聯繫管理員為你分配一台電腦。"
  },
```

- [ ] **Step 3: Wire the route into `App.tsx`**

In `web/src/App.tsx`, add the lazy import next to the other page imports (after line 65):

```typescript
const ComputerPage = lazy(() => import("./components/ComputerPage").then((m) => ({ default: m.ComputerPage })));
```

In the route switch (around line 1017-1027), add a `computer` branch between the `agents` branch and the final `ThreadsView` fallback:

```tsx
        ) : route === "agents" ? (
          <AgentsPage
            currentUser={user}
            isRefreshing={isRefreshing}
            onRefresh={() => refresh()}
            workspaceAgent={workspaceAgent}
            isDetailRoute={agentWorkspaceId !== null}
            onOpenWorkspace={openAgentWorkspace}
            onOpenThread={openThread}
          />
        ) : route === "computer" ? (
          <ComputerPage
            nodes={visibleNodes}
            currentUser={user}
          />
        ) : (
          <ThreadsView
```

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Build the web app**

Run: `npm run build -w web`
Expected: build succeeds (this is the first full check that touches every edited component file — `NodeActions`, `NodeCard`, `NodeRow`, `ManageExecutorsDrawer`, `AdminPage`, `ComputerPage`, `App`, `AppShell`, `SideNav`, `icons` — since `packages/tsconfig.json` excludes `web/src/components/**` and can't catch component-level type errors on its own).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ComputerPage.tsx web/src/App.tsx web/src/i18n/locales/en/translation.json web/src/i18n/locales/zh-CN/translation.json web/src/i18n/locales/zh-TW/translation.json
git commit -m "feat(web): add My Computer page for employees"
```

---

## Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full TypeScript test suite**

Run: `npm run test:ts`
Expected: PASS (includes the new `computerNodes.test.js` and the updated `appRoute.test.js`, plus every other existing TS test — full regression check).

- [ ] **Step 2: Run the full backend test suite**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests`
Expected: PASS (includes the 4 new tests from Task 1 plus every existing backend test — full regression check).

- [ ] **Step 3: Manual smoke test**

Start the backend (`make backend`) and the web dev server (`make web`), log in as a non-admin employee who has a computer assigned (or create one via the admin UI first), and confirm:
- "My Computer" appears in the sidebar for that employee.
- Clicking it navigates to `/computer` and shows the assigned computer as a card.
- The card has Rename and Manage Executors actions but no reveal-credentials or delete actions.
- Renaming and toggling an executor both work and persist (reflected after the next 3s poll or immediately via the local override).
- Logging in as an employee with no assigned computer shows the empty state.
- Logging in as admin still shows every node in `/admin`, unaffected.

- [ ] **Step 4: Update CLAUDE.md if needed**

If the manual smoke test surfaces any behavior worth documenting as a project invariant (it shouldn't, given this plan strictly reuses existing patterns), add a note to `CLAUDE.md`. Otherwise, skip this step — no invariant changed.
