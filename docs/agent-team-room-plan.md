# Agent Team Room (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a thread's team decide who answers it, so a message sent to a team thread runs every member instead of one agent, with a way to address a single member.

**Architecture:** Team fan-out today exists only in task dispatch. This plan extracts the team-resolution seam so both task dispatch and thread continuation share it, then teaches `POST /agent-runs` to expand a team thread whose request carries no `assignments`. The registry run loop is untouched: a room turn is the same sequential pipeline, built from the thread instead of from a task. The web sends no `assignments` when addressing the room and one when addressing a member.

**Tech Stack:** Python 3.12 / FastAPI (backend), TypeScript / Next.js (web), pytest, `node --test`.

**Spec:** `docs/agent-team-room-design.md`, Part 1. Part 2 (deliberate → divide → implement) is a separate plan.

## Global Constraints

- Python ≥ 3.12, Node ≥ 22.19.
- **The backend never executes agents.** All execution flows through daemon commands. Do not add in-process execution.
- **Immutability.** Session/task/assignment mutations return new objects; never mutate a dict in place.
- **Event log is authoritative.** Never write snapshot fields directly outside the store's replay.
- Backend tests: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest <path> -v`
- Web/TS tests: `npm run build && node --test dist/web/tests/<name>.test.js`
- Type annotations on all Python function signatures; `from __future__ import annotations` at the top of new modules.
- Commit after every task. Conventional commit prefixes: `feat`, `fix`, `refactor`, `test`, `docs`.

---

### Task 1: Extract the team-resolution seam

`_task_team_agents` is welded to task dicts. Split it so a thread can resolve a team with the same validation and ordering.

**Files:**
- Modify: `backend/relay/services/team_dispatch.py:97-134`
- Test: `backend/tests/unit/test_team_dispatch.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `team_agents(team_id: str, employee_id: str, *, team_store: Any, agent_store: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]` — returns `(team, agents)` with the lead first; raises `TeamDispatchError`.
  - `team_member_assignments(agents: list[dict[str, Any]], *, mode: str = "action") -> list[dict[str, Any]]` — each item is `{"agentId": str, "agent": str, "mode": str, "role"?: str}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_team_dispatch.py`:

```python
from __future__ import annotations

from typing import Any

import pytest

from relay.services.team_dispatch import (
    TeamDispatchError,
    team_agents,
    team_member_assignments,
)


class FakeTeamStore:
    def __init__(self, team: dict[str, Any] | None) -> None:
        self._team = team

    def get_team(self, team_id: str) -> dict[str, Any] | None:
        if self._team and self._team["id"] == team_id:
            return self._team
        return None


class FakeAgentStore:
    def __init__(self, agents: list[dict[str, Any]]) -> None:
        self._agents = {agent["id"]: agent for agent in agents}

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        return self._agents.get(agent_id)


def _agent(agent_id: str, executor: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": agent_id,
        "executorKind": executor,
        "displayName": agent_id.title(),
        "enabled": True,
        "version": 1,
        **overrides,
    }


def _team(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "team_1",
        "ownerEmployeeId": "alice",
        "leadAgentId": "lead",
        "memberAgentIds": ["support", "lead"],
        "enabled": True,
        **overrides,
    }


def test_team_agents_returns_the_lead_first() -> None:
    team, agents = team_agents(
        "team_1",
        "alice",
        team_store=FakeTeamStore(_team()),
        agent_store=FakeAgentStore([_agent("lead", "codex"), _agent("support", "claude")]),
    )

    assert team["id"] == "team_1"
    assert [agent["id"] for agent in agents] == ["lead", "support"]


@pytest.mark.parametrize(
    ("team", "agents", "code"),
    [
        (None, [], "team_not_found"),
        (_team(deletedAt="2026-01-01T00:00:00Z"), [], "team_not_found"),
        (_team(enabled=False), [], "team_disabled"),
        (_team(ownerEmployeeId="bob"), [], "team_forbidden"),
        (_team(leadAgentId="stranger"), [], "team_invalid"),
    ],
)
def test_team_agents_refuses_an_unusable_team(
    team: dict[str, Any] | None, agents: list[dict[str, Any]], code: str
) -> None:
    with pytest.raises(TeamDispatchError) as error:
        team_agents(
            "team_1",
            "alice",
            team_store=FakeTeamStore(team),
            agent_store=FakeAgentStore(agents or [_agent("lead", "codex"), _agent("support", "claude")]),
        )

    assert error.value.code == code
    assert error.value.permanent is True


def test_team_member_assignments_sends_a_reviewer_to_review() -> None:
    agents = [_agent("lead", "codex"), _agent("support", "claude", defaultRole="reviewer")]

    assert team_member_assignments(agents, mode="action") == [
        {"agentId": "lead", "agent": "codex", "mode": "action"},
        {"agentId": "support", "agent": "claude", "mode": "review", "role": "reviewer"},
    ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_team_dispatch.py -v`
Expected: FAIL — `ImportError: cannot import name 'team_agents'`

- [ ] **Step 3: Extract the helpers**

In `backend/relay/services/team_dispatch.py`, replace the body of `_task_team_agents` (lines 97-122) with a wrapper and add the two public helpers above it:

```python
def team_agents(
    team_id: str,
    employee_id: str,
    *,
    team_store: Any,
    agent_store: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Resolve a team to its ordered, dispatchable members. Lead first.

    The single validation point for "can this team run work right now",
    shared by task dispatch and by thread continuation.
    """
    team = team_store.get_team(team_id) if team_store and team_id else None
    if not team or team.get("deletedAt"):
        raise TeamDispatchError("team_not_found", permanent=True)
    if not team.get("enabled", True):
        raise TeamDispatchError("team_disabled", permanent=True)
    if team.get("ownerEmployeeId") != employee_id:
        raise TeamDispatchError("team_forbidden", permanent=True)
    members = list(team.get("memberAgentIds") or [])
    lead = team.get("leadAgentId")
    if not isinstance(lead, str) or lead not in members:
        raise TeamDispatchError("team_invalid", permanent=True)
    ordered_member_ids = [lead, *(member for member in members if member != lead)]
    agents = [agent_store.get_agent(member) for member in ordered_member_ids]
    if any(not agent or agent.get("deletedAt") for agent in agents):
        raise TeamDispatchError("team_invalid", permanent=True)
    if any(not agent.get("enabled", True) for agent in agents):
        raise TeamDispatchError("team_disabled", permanent=True)
    return team, agents


def team_member_assignments(
    agents: list[dict[str, Any]], *, mode: str = "action"
) -> list[dict[str, Any]]:
    return [_team_member_assignment(agent, mode=mode) for agent in agents]


def _task_team_agents(
    task: dict[str, Any],
    *,
    team_store: Any,
    agent_store: Any,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return team_agents(
        task.get("assignedTeamId") or "",
        task_execution_employee_id(task),
        team_store=team_store,
        agent_store=agent_store,
    )
```

- [ ] **Step 4: Run the new test and the existing team suites**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_team_dispatch.py backend/tests/api/test_team_routes.py -v`
Expected: PASS — all new tests pass and every existing team-routes test still passes, proving the extraction changed no behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/relay/services/team_dispatch.py backend/tests/unit/test_team_dispatch.py
git commit -m "refactor: share one team-resolution seam between tasks and threads"
```

---

### Task 2: A team thread answers with the whole room

`POST /agent-runs` requires `assignments` and never reads `session.teamId`. Make its absence mean "this thread's participants".

**Files:**
- Modify: `backend/relay/api/agent_routes.py:254-335`
- Test: `backend/tests/api/test_team_routes.py` (append)

**Interfaces:**
- Consumes: `team_agents`, `team_member_assignments` from Task 1.
- Produces: `POST /agent-runs` accepts a body with no `assignments` when `sessionId` names a team thread; the request body may carry a top-level `"mode"` (`action` | `ask` | `review`, default `action`) applied to every member.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_team_routes.py`. It reuses the fixtures already in that file (`_bootstrap`, `_employee`, `_agent`):

```python
def test_message_to_a_team_thread_runs_every_member_lead_first(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex", "claude"],
                "capabilities": ["thread-workspaces"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        for agent in (lead, support):
            assert (
                client.post(
                    f"/api/v1/admin/agents/{agent['id']}/placements",
                    json={"daemonNodeId": "node_alice"},
                ).status_code
                == 201
            )
        team = client.post(
            "/api/v1/admin/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Ship with the team",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        session_id = started.json()["session"]["id"]
        first = app.state.registry.take_commands("node_alice", "node_token")[0]
        app.state.registry.handle_event(
            "node_alice",
            {
                "type": "run.completed",
                "commandId": first["id"],
                "sessionId": session_id,
                "runId": first["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "lead result",
            },
            "node_token",
        )
        second = app.state.registry.take_commands("node_alice", "node_token")[0]
        app.state.registry.handle_event(
            "node_alice",
            {
                "type": "run.completed",
                "commandId": second["id"],
                "sessionId": session_id,
                "runId": second["runId"],
                "agent": "claude",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "support result",
            },
            "node_token",
        )

        answered = client.post(
            "/api/v1/agent-runs",
            json={"taskGoal": "one more pass please", "sessionId": session_id},
        )

        assert answered.status_code == 202
        [room_command] = app.state.registry.take_commands("node_alice", "node_token")
        assert room_command["logicalAgentId"] == lead["id"]
        request = app.state.registry.daemon_store.active_run_request_for_session_any_node(
            session_id
        )
        assert [item["agentId"] for item in request["assignments"]] == [
            lead["id"],
            support["id"],
        ]


def test_message_to_a_team_thread_reports_a_disabled_team(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex", "claude"],
                "capabilities": ["thread-workspaces"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        assert (
            client.post(
                f"/api/v1/admin/agents/{lead['id']}/placements",
                json={"daemonNodeId": "node_alice"},
            ).status_code
            == 201
        )
        team = client.post(
            "/api/v1/admin/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Ship with the team",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        session_id = started.json()["session"]["id"]
        command = app.state.registry.take_commands("node_alice", "node_token")[0]
        app.state.registry.handle_event(
            "node_alice",
            {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": session_id,
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "done",
            },
            "node_token",
        )
        client.patch(f"/api/v1/admin/teams/{team['id']}", json={"enabled": False})

        answered = client.post(
            "/api/v1/agent-runs",
            json={"taskGoal": "another pass", "sessionId": session_id},
        )

        assert answered.status_code == 409
        assert answered.json()["detail"]["code"] == "team_disabled"


def test_agent_runs_still_requires_an_assignment_for_a_solo_thread(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")

        refused = client.post("/api/v1/agent-runs", json={"taskGoal": "do something"})

        assert refused.status_code == 400
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_team_routes.py -k "team_thread or solo_thread" -v`
Expected: FAIL — the first two get `400 taskGoal and at least one assignment are required.`

- [ ] **Step 3: Teach `/agent-runs` to read the thread**

In `backend/relay/api/agent_routes.py`, add to the imports at the top of the file:

```python
from ..services.team_dispatch import (
    TeamDispatchError,
    team_agents,
    team_member_assignments,
)
```

Replace the guard at lines 258-261:

```python
    task_goal = string_field(body, "taskGoal") or string_field(body, "task_goal")
    raw_assignments = body.get("assignments")
    if not task_goal or not isinstance(raw_assignments, list) or not raw_assignments:
        raise HTTPException(400, "taskGoal and at least one assignment are required.")
```

with:

```python
    task_goal = string_field(body, "taskGoal") or string_field(body, "task_goal")
    if not task_goal:
        raise HTTPException(400, "taskGoal is required.")
    raw_assignments = body.get("assignments")
    if raw_assignments is not None and not isinstance(raw_assignments, list):
        raise HTTPException(400, "assignments must be a list.")
```

Then, immediately after the `session` lookup completes (after line 274, before the `requested_node_id` block), insert the expansion:

```python
    team_id = session.get("teamId") if session else None
    team_member_ids: set[str] = set()
    if team_id:
        team_employee_id = (
            (session.get("ownerEmployeeId") or actor["employeeId"])
            if actor["isAdmin"]
            else actor["employeeId"]
        )
        try:
            _team, members = team_agents(
                team_id,
                team_employee_id,
                team_store=ctx.team_store,
                agent_store=ctx.agent_store,
            )
        except TeamDispatchError as error:
            raise HTTPException(
                409, {"code": error.code, "message": str(error)}
            ) from error
        team_member_ids = {agent["id"] for agent in members}
        if not raw_assignments:
            raw_assignments = team_member_assignments(
                members, mode=agent_task_mode(body.get("mode"))
            )
    if not raw_assignments:
        raise HTTPException(400, "At least one assignment is required.")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_team_routes.py backend/tests/api/test_agent_api.py -v`
Expected: PASS — new tests pass and no existing `/agent-runs` test regresses.

- [ ] **Step 5: Commit**

```bash
git add backend/relay/api/agent_routes.py backend/tests/api/test_team_routes.py
git commit -m "feat: answer a team thread with the whole room"
```

---

### Task 3: Narrowing may only name a member

Without this, a client can inject a non-member agent into a team thread and the participant set stops meaning anything. This intentionally also blocks handing a team thread off to an outside agent.

**Files:**
- Modify: `backend/relay/api/agent_routes.py` (the assignment-parsing loop, currently lines 315-335, after Task 2's insertion)
- Test: `backend/tests/api/test_team_routes.py` (append)

**Interfaces:**
- Consumes: `team_member_ids` computed in Task 2.
- Produces: `POST /agent-runs` returns 409 `{"code": "agent_forbidden"}` when an explicit assignment names a non-member on a team thread.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_team_routes.py`:

```python
def test_a_team_thread_refuses_an_assignment_outside_the_room(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex", "claude"],
                "capabilities": ["thread-workspaces"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        outsider = _agent(client, "alice", "Outsider", "claude")
        for agent in (lead, outsider):
            assert (
                client.post(
                    f"/api/v1/admin/agents/{agent['id']}/placements",
                    json={"daemonNodeId": "node_alice"},
                ).status_code
                == 201
            )
        team = client.post(
            "/api/v1/admin/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Ship with the team",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        session_id = started.json()["session"]["id"]
        command = app.state.registry.take_commands("node_alice", "node_token")[0]
        app.state.registry.handle_event(
            "node_alice",
            {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": session_id,
                "runId": command["runId"],
                "agent": "codex",
                "mode": "action",
                "exitCode": 0,
                "agentLog": "done",
            },
            "node_token",
        )

        refused = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "you handle it",
                "sessionId": session_id,
                "assignments": [{"agentId": outsider["id"], "mode": "action"}],
            },
        )

        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "agent_forbidden"


def test_a_team_thread_accepts_an_assignment_naming_one_member(monkeypatch) -> None:
    monkeypatch.setenv("RELAY_ADMIN_TOKEN", "admin_token")
    with TemporaryDirectory() as root:
        app = create_app(root)
        client = TestClient(app)
        _bootstrap(client)
        _employee(client, "alice")
        app.state.registry.register(
            {
                "sandboxId": "node_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["codex", "claude"],
                "capabilities": ["thread-workspaces"],
                "status": "ready",
            }
        )
        lead = _agent(client, "alice", "Lead", "codex")
        support = _agent(client, "alice", "Support", "claude")
        for agent in (lead, support):
            assert (
                client.post(
                    f"/api/v1/admin/agents/{agent['id']}/placements",
                    json={"daemonNodeId": "node_alice"},
                ).status_code
                == 201
            )
        team = client.post(
            "/api/v1/admin/teams",
            json={
                "ownerEmployeeId": "alice",
                "name": "Delivery",
                "leadAgentId": lead["id"],
                "memberAgentIds": [lead["id"], support["id"]],
            },
        ).json()["team"]
        task = client.post(
            "/api/v1/tasks",
            json={
                "title": "Ship with the team",
                "ownerEmployeeId": "alice",
                "assigneeEmployeeId": "alice",
                "assignedTeamId": team["id"],
            },
        ).json()
        started = client.post(f"/api/v1/tasks/{task['id']}/runs", json={})
        session_id = started.json()["session"]["id"]
        for executor in ("codex", "claude"):
            command = app.state.registry.take_commands("node_alice", "node_token")[0]
            app.state.registry.handle_event(
                "node_alice",
                {
                    "type": "run.completed",
                    "commandId": command["id"],
                    "sessionId": session_id,
                    "runId": command["runId"],
                    "agent": executor,
                    "mode": "action",
                    "exitCode": 0,
                    "agentLog": "done",
                },
                "node_token",
            )

        answered = client.post(
            "/api/v1/agent-runs",
            json={
                "taskGoal": "just you, Support",
                "sessionId": session_id,
                "assignments": [{"agentId": support["id"], "mode": "action"}],
            },
        )

        assert answered.status_code == 202
        request = app.state.registry.daemon_store.active_run_request_for_session_any_node(
            session_id
        )
        assert [item["agentId"] for item in request["assignments"]] == [support["id"]]
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_team_routes.py -k "outside_the_room or naming_one_member" -v`
Expected: the "outside the room" test FAILS with `202` instead of `409`; the "one member" test already passes.

- [ ] **Step 3: Reject non-members**

In `backend/relay/api/agent_routes.py`, inside the `for item in raw_assignments:` loop, after the `agentId` presence check and before `assignments.append(...)`, add:

```python
        if team_member_ids and item["agentId"] not in team_member_ids:
            raise HTTPException(
                409,
                {
                    "code": "agent_forbidden",
                    "message": "This thread belongs to a team; only its members can answer it.",
                },
            )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/api/test_team_routes.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/relay/api/agent_routes.py backend/tests/api/test_team_routes.py
git commit -m "feat: keep a team thread answerable only by its members"
```

---

### Task 4: Let the web omit assignments

**Files:**
- Modify: `web/src/types.ts:515-524`, `web/src/api.ts:846-858`
- Test: `web/tests/api.test.ts` (append)

**Interfaces:**
- Consumes: the backend contract from Task 2.
- Produces: `AgentRunInput.assignments` is optional; `runLogicalAgents` omits the key entirely when it is absent, and sends `mode` when provided.

- [ ] **Step 1: Write the failing test**

Append to `web/tests/api.test.ts`, following the fetch-stubbing pattern already used in that file:

```ts
describe("agent run payloads", () => {
  it("omits assignments when the message is addressed to the room", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ id: "ses_1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await runLogicalAgents({ taskGoal: "one more pass", sessionId: "ses_1", mode: "action" });
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, {
      taskGoal: "one more pass",
      sessionId: "ses_1",
      mode: "action",
    });
  });
});
```

Add `runLogicalAgents` to the existing import from `../src/api.js` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/web/tests/api.test.js`
Expected: FAIL — the body contains `"assignments": undefined` or a type error on the missing `assignments` property.

- [ ] **Step 3: Make assignments optional**

In `web/src/types.ts`, change the `AgentRunInput` member and add `mode`:

```ts
export interface AgentRunInput {
  taskGoal: string;
  /** Computer selected as the immutable runtime for a new thread. */
  daemonNodeId?: string;
  /** Absent means "this thread's participants" — the whole team for a team thread. */
  assignments?: Array<{
    agentId: string;
    mode: AgentTaskMode;
    role?: AgentRole;
  }>;
  /** Mode applied to every member when addressing the room. */
  mode?: AgentTaskMode;
  sessionId?: string;
  userMessageId?: string;
```

In `web/src/api.ts`, change `runLogicalAgents`:

```ts
export function runLogicalAgents(input: AgentRunInput): Promise<RelaySession> {
  return apiJson<RelaySession>("/agent-runs", {
    method: "POST",
    body: {
      taskGoal: input.taskGoal,
      ...(input.daemonNodeId ? { daemonNodeId: input.daemonNodeId } : {}),
      ...(input.assignments ? { assignments: input.assignments } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      sessionId: input.sessionId,
      ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
      ...(input.decision ? { decision: input.decision } : {}),
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/web/tests/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/tests/api.test.ts
git commit -m "feat(web): let an agent run address a thread's whole room"
```

---

### Task 5: Resolve a leading mention

A separate pure function rather than a change to `routeComposerMessage`: solo threads keep treating `@name` as ordinary text (there is an existing test asserting exactly that), and the room's addressing rule stays independently testable.

**Files:**
- Modify: `web/src/lib/messageRouting.ts`
- Test: `web/tests/messageRouting.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveLeadingMention(raw: string, members: Array<{ id: string; displayName: string }>): { agentId: string } | null`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/messageRouting.test.ts`, and add `resolveLeadingMention` to the existing import:

```ts
const members = [
  { id: "agent_lead", displayName: "Lead" },
  { id: "agent_support", displayName: "Support Bot" },
  { id: "agent_dup_a", displayName: "Twin" },
  { id: "agent_dup_b", displayName: "Twin" },
];

describe("leading mention resolution", () => {
  it("addresses the named member when the mention leads", () => {
    assert.deepEqual(resolveLeadingMention("@Lead check the migration", members), {
      agentId: "agent_lead",
    });
  });

  it("prefers the longest matching name", () => {
    assert.deepEqual(resolveLeadingMention("@Support Bot ping", members), {
      agentId: "agent_support",
    });
  });

  it("ignores case", () => {
    assert.deepEqual(resolveLeadingMention("@lead hello", members), {
      agentId: "agent_lead",
    });
  });

  it("does not narrow when the mention is not leading", () => {
    assert.equal(resolveLeadingMention("tell @Lead I said hi", members), null);
  });

  it("does not narrow on an unknown name", () => {
    assert.equal(resolveLeadingMention("@Nobody hello", members), null);
  });

  it("does not narrow on an ambiguous name", () => {
    assert.equal(resolveLeadingMention("@Twin hello", members), null);
  });

  it("does not narrow without a mention", () => {
    assert.equal(resolveLeadingMention("hello everyone", members), null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/web/tests/messageRouting.test.js`
Expected: FAIL — `resolveLeadingMention is not a function`

- [ ] **Step 3: Implement the resolver**

Append to `web/src/lib/messageRouting.ts`:

```ts
/**
 * Resolve a leading `@Name` to one room member.
 *
 * Only a leading mention addresses the turn: "tell @Alice I said hi" is a
 * message to the room that happens to name her. The mention is never stripped
 * from the message — being addressed by name is context the agent should see.
 */
export function resolveLeadingMention(
  raw: string,
  members: Array<{ id: string; displayName: string }>,
): { agentId: string } | null {
  const text = raw.trimStart();
  if (!text.startsWith("@")) return null;
  const candidate = text.slice(1).toLowerCase();
  // Longest name first, so "Support Bot" wins over a hypothetical "Support".
  const byLength = [...members].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );
  const named = byLength.filter((member) => {
    const name = member.displayName.toLowerCase();
    return candidate === name || candidate.startsWith(`${name} `);
  });
  if (named.length === 0) return null;
  const best = named[0];
  const ambiguous = named.some(
    (member) =>
      member.id !== best.id
      && member.displayName.length === best.displayName.length,
  );
  return ambiguous ? null : { agentId: best.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/web/tests/messageRouting.test.js`
Expected: PASS — including the two pre-existing `routeComposerMessage` tests, which must stay green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/messageRouting.ts web/tests/messageRouting.test.ts
git commit -m "feat(web): resolve a leading mention to one room member"
```

---

### Task 6: Send to the room from the composer

**Files:**
- Modify: `web/src/App.tsx:690-768` (the `sendMessage` body)
- Test: `web/tests/threads.test.ts` (append)

**Interfaces:**
- Consumes: `resolveLeadingMention` (Task 5), the optional `assignments` / `mode` fields (Task 4).
- Produces: `teamRunInput(args: { taskGoal: string; sessionId: string; teamMembers: Array<{ id: string; displayName: string }>; mode: AgentTaskMode; userMessageId: string }): AgentRunInput` in `web/src/lib/messageRouting.ts` — the pure decision "room or one member", so `sendMessage` stays thin and the behavior is testable without React.

- [ ] **Step 1: Write the failing test**

Append to `web/tests/threads.test.ts`, importing `teamRunInput` from `../src/lib/messageRouting.js`:

```ts
describe("team thread run input", () => {
  const teamMembers = [
    { id: "agent_lead", displayName: "Lead" },
    { id: "agent_support", displayName: "Support" },
  ];

  it("addresses the room when no member is mentioned", () => {
    const input = teamRunInput({
      taskGoal: "one more pass",
      sessionId: "ses_1",
      teamMembers,
      mode: "action",
      userMessageId: "evt_1",
    });

    assert.equal(input.assignments, undefined);
    assert.equal(input.mode, "action");
    assert.equal(input.sessionId, "ses_1");
    assert.equal(input.userMessageId, "evt_1");
  });

  it("narrows to the mentioned member", () => {
    const input = teamRunInput({
      taskGoal: "@Support take this",
      sessionId: "ses_1",
      teamMembers,
      mode: "action",
      userMessageId: "evt_1",
    });

    assert.deepEqual(input.assignments, [{ agentId: "agent_support", mode: "action" }]);
    assert.equal(input.mode, undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/web/tests/threads.test.js`
Expected: FAIL — `teamRunInput is not a function`

- [ ] **Step 3: Implement the helper and wire the composer**

Append to `web/src/lib/messageRouting.ts`:

```ts
import type { AgentRunInput, AgentTaskMode } from "../types.js";

/** Build the run for a message typed into a team thread: the room, or one member. */
export function teamRunInput({ taskGoal, sessionId, teamMembers, mode, userMessageId }: {
  taskGoal: string;
  sessionId: string;
  teamMembers: Array<{ id: string; displayName: string }>;
  mode: AgentTaskMode;
  userMessageId: string;
}): AgentRunInput {
  const mentioned = resolveLeadingMention(taskGoal, teamMembers);
  return {
    taskGoal,
    sessionId,
    userMessageId,
    ...(mentioned
      ? { assignments: [{ agentId: mentioned.agentId, mode }] }
      : { mode }),
  };
}
```

In `web/src/App.tsx`, import `teamRunInput` alongside the existing `routeComposerMessage` import, and in `sendMessage` replace the mutation call at lines 745-751 with a branch on the thread's team:

```ts
      const teamMembers = sessionId && activeSession?.teamId
        ? selectableLogicalAgents
            .filter((agent) => isEmployeeAgentRoutable(agent))
            .map((agent) => ({ id: agent.id, displayName: agent.displayName }))
        : [];
      const done = await runLogicalAgentsMutation.mutateAsync(
        sessionId && activeSession?.teamId
          ? teamRunInput({
              taskGoal: goal,
              sessionId,
              teamMembers,
              mode: composerMode,
              userMessageId,
            })
          : {
              taskGoal: goal,
              ...(selectedThreadNodeId ? { daemonNodeId: selectedThreadNodeId } : {}),
              assignments: [{ agentId: routedLogicalAgent.id, mode: composerMode }],
              sessionId,
              ...(sessionId ? { userMessageId } : {}),
            },
      );
```

Mention resolution runs against the employee's routable agents; the backend re-checks membership (Task 3), so a mention naming a non-member is refused with `agent_forbidden` rather than silently widening the room.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && node --test dist/web/tests/threads.test.js dist/web/tests/messageRouting.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — TypeScript and Python suites both green.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/lib/messageRouting.ts web/tests/threads.test.ts
git commit -m "feat(web): send a team thread message to the whole room"
```

---

### Task 7: Keep the repair turn out of chat rooms

`_send_back_for_repair` tells the lead *"You are the lead on this task: fix the cause so X can run again"*. In a task-less chat room that sentence is false and the instruction is incoherent. Scope repair to task pipelines.

**Files:**
- Modify: `backend/relay/daemon_registry/registry.py:2582-2589`
- Test: `backend/tests/unit/test_daemon_registry.py:3170-3310`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new callable surface. Behavior change only: a run request without `taskId` never re-enqueues the lead for repair.

- [ ] **Step 1: Give the pipeline fixture a task store**

The three existing repair tests dispatch without a `taskId`, so they currently exercise the path this task removes. They are testing *task pipeline* behavior, so they need a real task. `_round_result_registry` cannot be reused — its node advertises only `codex`, and these tests need `codex` and `claude`.

In `backend/tests/unit/test_daemon_registry.py`, change `_pipeline_registry` (line 3170) to build a task store:

```python
def _pipeline_registry(root: str) -> tuple[Any, Any, Any]:
    session_store = LocalSessionStore(root)
    daemon_store = LocalDaemonStore(root)
    registry = DaemonNodeRegistry(
        session_store, daemon_store, task_store=LocalTaskStore(root)
    )
```

Leave the rest of the fixture, including its return tuple, unchanged. `LocalTaskStore` is already imported at line 27. Tests reach the store through `registry.task_store`.

- [ ] **Step 2: Write the failing test**

Append to `backend/tests/unit/test_daemon_registry.py`:

```python
def test_a_task_less_room_does_not_send_the_lead_back_to_repair() -> None:
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store, _daemon_store, registry = _pipeline_registry(root)
            backend = ServerDaemonNodeBackend(registry)
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "what do you two think?",
                    "assignments": [
                        {"agent": "codex", "mode": "action"},
                        {"agent": "claude", "mode": "action"},
                    ],
                },
            )
            [lead] = registry.take_commands("sbx_alice", "node_token")
            _finish_run(registry, lead, 0)
            [member] = registry.take_commands("sbx_alice", "node_token")

            _finish_run(registry, member, 3)

            # No task, so there is nothing for a lead to "fix on this task".
            assert registry.take_commands("sbx_alice", "node_token") == []
            assert session_store.get_session(session["id"])["status"] == "failed"

    asyncio.run(run_flow())
```

- [ ] **Step 3: Run it to verify it fails**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py::test_a_task_less_room_does_not_send_the_lead_back_to_repair -v`
Expected: FAIL — a repair command is issued, so `take_commands` returns one command instead of `[]`.

- [ ] **Step 4: Gate the repair on a task**

In `backend/relay/daemon_registry/registry.py`, in `_send_back_for_repair`, replace the early-return condition (line 2588):

```python
        if index == 0 or len(assignments) < 2 or repairs >= DAEMON_RUN_MAX_REPAIRS:
            return False
```

with:

```python
        # A repair turn instructs the lead to fix the task the failing member
        # was working on. Without a task that instruction is false, so a
        # task-less room fails the round instead of inventing a lead's duty.
        if (
            not run_request.get("taskId")
            or index == 0
            or len(assignments) < 2
            or repairs >= DAEMON_RUN_MAX_REPAIRS
        ):
            return False
```

- [ ] **Step 5: Give the three existing repair tests a task**

In each of `test_lead_repairs_a_failed_teammate_and_the_pipeline_resumes`, `test_repair_budget_is_spent_once_and_then_the_run_fails`, and `test_a_failing_lead_is_not_sent_back_to_repair_itself`, create a task before dispatching and pass its id. For the first test the dispatch becomes:

```python
            session_store, _daemon_store, registry = _pipeline_registry(root)
            backend = ServerDaemonNodeBackend(registry)
            task = registry.task_store.create_task({"title": "Ship it"})
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "ship it",
                    "assignments": [
                        {"agent": "codex", "mode": "action"},
                        {"agent": "claude", "mode": "action"},
                    ],
                    "taskId": task["id"],
                },
            )
```

For the second test:

```python
            session_store, _daemon_store, registry = _pipeline_registry(root)
            backend = ServerDaemonNodeBackend(registry)
            task = registry.task_store.create_task({"title": "Ship it"})
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "ship it",
                    "assignments": [
                        {"agent": "codex", "mode": "action"},
                        {"agent": "claude", "mode": "action"},
                    ],
                    "taskId": task["id"],
                },
            )
```

For the third test:

```python
            session_store, _daemon_store, registry = _pipeline_registry(root)
            backend = ServerDaemonNodeBackend(registry)
            task = registry.task_store.create_task({"title": "Ship it"})
            session = await backend.run(
                "sbx_alice",
                {
                    "taskGoal": "ship it",
                    "assignments": [
                        {"agent": "codex", "mode": "action"},
                        {"agent": "claude", "mode": "action"},
                    ],
                    "taskId": task["id"],
                },
            )
```

Leave every assertion in all three tests unchanged — the repair behavior they describe must survive intact for task pipelines.

- [ ] **Step 6: Run the whole registry suite**

Run: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py -v`
Expected: PASS — the new test passes, all three reworked repair tests pass, and no other registry test regresses.

- [ ] **Step 7: Commit**

```bash
git add backend/relay/daemon_registry/registry.py backend/tests/unit/test_daemon_registry.py
git commit -m "fix: stop offering a repair turn to a task-less room"
```

---

## Deferred to a follow-up plan

- The composer footer's `Team` entry (`web/src/components/composer/AgentSelect.tsx`). Mention is the addressing mechanism in this plan; the footer entry is discoverability, and it needs its own i18n keys across `en`, `zh-CN`, and `zh-TW`.
- Everything in Part 2 of the spec: discussion ordering (lead last), the plan file, approval, and the per-assignment brief.
