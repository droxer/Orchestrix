# Employee computer sidebar

## Problem

Employees (non-admin users, `role: "user"`) have no way to see or manage the computer(s) (daemon nodes) assigned to them. That view exists today only inside `/admin`, gated by `require_admin_session`. An employee should be able to see their own assigned computer(s) from the sidebar and take a small set of safe, non-destructive actions on them.

## Scope

**In scope:**
- A new sidebar nav item and route showing the computer(s) assigned to the current employee.
- Two actions on those computers: rename, and manage executors (enable/disable which agent CLIs run there).
- One new backend endpoint (manage-executors is currently admin-only).

**Out of scope:**
- Revealing credentials/tokens (admin-only, unchanged).
- Deleting a computer (admin-only, unchanged).
- A file browser or file editor for the computer's workspace. No `workspace.write` daemon capability exists anywhere in the codebase today (only read: `workspace.list`/`workspace.read`); adding write is a separate, much larger effort and was explicitly ruled out for this change.
- Any change to `/admin/*` behavior — the admin nodes surface is untouched.

## Existing infrastructure this reuses

- `GET /daemon-nodes` (non-admin, in `daemon_node_routes.py`) already scopes results via `actor_can_access_sandbox`: non-admins only see nodes where `node.employeeId == actor.employeeId`. Admins see all (unchanged, matches today's admin behavior).
- `PATCH /daemon-nodes/{sandbox_id}` (rename) is **already actor-scoped** end to end (`rename_computer_for_actor` in `services/computer_names.py` checks `node.employeeId == actor.employeeId` for non-admins, and already handles both managed (BoxLite) and unmanaged nodes). The web client function `updateComputerDisplayName` already calls this. Nothing to change here — just needs a UI that calls it.
- `web/src/App.tsx` already computes `visibleNodes` (merged local + remote nodes) and passes it to `BacklogPage`/`RoutinesPage` today. The new page reuses this same prop — no new polling/fetch hook.
- `DaemonNodeMonitorRecord` (the type `GET /daemon-nodes` returns) already omits all token/credential fields at the type level (`Omit<SandboxRecord, "token" | "tokenHash" | "uiTokenHash" | "nodeTokenHash" | "nodeToken">`), so there's no risk of leaking secrets through this read path.

## What's missing and needs to be built

Only "manage executors" (toggle `disabledAgents`) is admin-only today, with no actor-scoped equivalent.

## Design

### Backend

Add one endpoint to `backend/relay/api/daemon_node_routes.py`, placed next to the existing `update_daemon_node` (rename) handler and following its exact permission shape:

```
PATCH /daemon-nodes/{sandbox_id}/disabled-agents
Body: { "disabledAgents": AgentName[] }
```

Logic:
1. `actor = request_actor(request, ctx.auth_store)` (any authenticated user).
2. Look up the node via `ctx.registry.get(sandbox_id)`; 404 if missing.
3. If `not actor["isAdmin"] and node.get("employeeId") != actor["employeeId"]`: 403.
4. Validate `disabledAgents` is a list of strings (same validation as the admin handler).
5. Call `ctx.registry.set_disabled_agents(sandbox_id, raw)` — the same registry method the admin endpoint already uses. No registry or daemon changes.
6. Return `{"node": present_computer(ctx, updated)}`.

The existing admin endpoint (`PATCH /admin/daemon-nodes/{node_id}/disabled-agents`) is untouched.

### Frontend

**API client (`web/src/api.ts`)**
- New `updateDaemonNodeDisabledAgents(nodeId, disabledAgents)` calling the new endpoint, mirroring the existing `updateComputerDisplayName`. Sits alongside the existing admin-only `updateControlPanelDaemonNodeDisabledAgents` — both remain, callers choose based on context.

**Generalize the shared node card UI** (`web/src/components/admin/{NodeActions,NodeCard,NodeRow}.tsx`)
- Widen `onReveal` and `onManageExecutors` from required to optional props, following the pattern `onDelete` already uses (button renders only when the handler is passed). Admin call sites in `NodesView.tsx` pass all handlers today and are unaffected.

**Make `ManageExecutorsDrawer.tsx` save-endpoint-agnostic**
- Replace its direct call to `updateControlPanelDaemonNodeDisabledAgents` with an `onSave: (nodeId: string, disabledAgents: AgentName[]) => Promise<{ node: ControlPanelDaemonNodeRecord }>` prop.
- `AdminPage.tsx` passes `updateControlPanelDaemonNodeDisabledAgents` (unchanged behavior).
- The new `ComputerPage.tsx` passes `updateDaemonNodeDisabledAgents`.
- All other drawer behavior (unsaved-changes guard, "you're about to disable a ready agent" confirmation) is reused unchanged.

**New `ComputerPage.tsx`**
- Props: `{ nodes: DaemonNodeMonitorRecord[], currentUser: CurrentUser }` (same shape/source as `BacklogPage`/`RoutinesPage` — `nodes={visibleNodes}` from `App.tsx`).
- Filters to `nodes.filter(n => n.employeeId === currentUser.employeeId)`.
- Renders a `PageHeader` + grid of `NodeCard`s (same visual identity as the admin fleet grid), passing only `onRename` and `onManageExecutors` — `onReveal`/`onDelete` omitted, so those buttons don't render. `storedTokens`/`colocated` (only meaningful for the local-node-adoption credential badges on the admin surface) are left at their existing defaults (`{}`/`false`).
- Rename reuses the same `prompt()`-dialog flow as `AdminPage.handleRenameNode` (via `useDialogs()`), calling the existing `updateComputerDisplayName`.
- Empty state ("No computer assigned yet") uses the existing `RelayEmptyState` component, matching other empty states in the app.

**Routing/nav wiring**
- `web/src/lib/viewTypes.ts`: add `"computer"` to the `AppRoute` union.
- `web/src/lib/appRoute.ts`: add `computer: "/computer"` to `WORK_PATHS` — this alone wires URL parsing (`parseAppPath`), `hrefForRoute`, and back/forward history, since both are driven off the same map.
- `web/src/App.tsx`: add `computer: "computer-panel"` to `WORK_ROUTE_SKIP_IDS`; add the `route === "computer"` branch to the route switch, lazy-loading `ComputerPage` like the other pages; pass `nodes={visibleNodes}` and `currentUser={user}`.
- `web/src/components/AppShell.tsx`: add `computer: "nav.computer"` to `WORK_ROUTE_LABEL_KEYS` (mobile top-bar title).
- `web/src/components/SideNav.tsx`: add a new nav button in the primary nav group (same group as Threads — visible to every authenticated user, not gated by `isAdmin`), using a new `NavComputer` icon.
- `web/src/components/icons.tsx`: add `export const NavComputer = withStandardStroke(Server, "NavComputer");` (reusing the same glyph as the existing admin `AdminNode` icon for visual consistency, under a `Nav*`-prefixed alias matching the sidebar's other icons).

TypeScript enforces completeness here: `WORK_PATHS`, `WORK_ROUTE_SKIP_IDS`, and `WORK_ROUTE_LABEL_KEYS` are all typed `Record<Exclude<AppRoute, "main">, string>`, so adding `"computer"` to `AppRoute` causes a compile error at each map until it's filled in — nothing can be silently missed.

**i18n**
New keys in `en`, `zh-CN`, `zh-TW` `translation.json`: `nav.computer`, `computer.page_title`, `computer.empty_title`, `computer.empty_body`. Everything else (rename dialog copy, manage-executors drawer copy) is reused as-is from the admin surface.

### Visibility

The nav item and route are visible to **every** authenticated user, admins included — an admin can also have a computer assigned to them personally, and gating this by role adds complexity for no real benefit (admins already have the full `/admin` surface for everything else).

### Error handling

- 403 from the new endpoint (node not owned by actor) surfaces through the same `reportMutationError` pattern already used for rename failures on `AdminPage`.
- 404 (node deleted concurrently) surfaces the same way.
- No new error classes; reuses existing toast/error-reporting plumbing.

### Testing

- Backend: `backend/tests/` — a test for the new `PATCH /daemon-nodes/{sandbox_id}/disabled-agents` covering: owner can toggle, non-owner gets 403, admin can toggle any node, invalid payload gets 400. Model these on the existing rename-endpoint tests for the same route file.
- Frontend: `web/tests/` — unit test for the `ComputerPage` node-filtering logic (only own nodes shown), and a test that `ManageExecutorsDrawer` calls whichever `onSave` it's given (covers both the admin and employee wiring with one component test).
