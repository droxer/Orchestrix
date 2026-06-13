from __future__ import annotations

import mimetypes
import os
import shlex
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from loguru import logger

from .auth import (
    USER_COOKIE_NAME,
    auth_store_from_env,
    require_admin_session,
    require_user_session,
    user_session_cookie_attrs,
    user_session_token_from_request,
)
from .controller import SessionController
from .environment import load_backend_env
from .daemon import (
    DaemonNodeRegistry,
    ServerDaemonNodeBackend,
    provisioned_sandbox_record,
    public_sandbox_record,
    sandbox_ui_auth_error,
    sandbox_ui_token_matches,
    workspace_paths_match,
)
from .models import AGENT_NAMES, DaemonNodeRegistration, SandboxRunRequest
from .storage_config import database_url_from_env, use_postgres_storage
from .stores import (
    DEFAULT_RELAY_DATA_DIR,
    DatabaseDaemonStore,
    DatabaseSessionStore,
    DatabaseTaskStore,
    LocalDaemonStore,
    LocalSessionStore,
    LocalTaskStore,
    task_priority,
    task_status,
    valid_agent,
)

load_backend_env()

CONTROL_PANEL_VERSION = os.environ.get("RELAY_CONTROL_PANEL_VERSION") or "python"
WEB_UI_PATH = "/web"


def create_app(root_dir: str | Path = DEFAULT_RELAY_DATA_DIR) -> FastAPI:
    root_dir = Path(root_dir)
    logger.info("Relay backend starting", root_dir=str(root_dir))
    session_store = session_store_from_env(root_dir)
    task_store = task_store_from_env(root_dir)
    daemon_store = daemon_store_from_env(root_dir)
    registry = DaemonNodeRegistry(session_store, daemon_store)
    backend = ServerDaemonNodeBackend(registry)
    auth_store = auth_store_from_env(root_dir)
    app = FastAPI(title="Relay backend", version="0.1.0")
    app.state.session_store = session_store
    app.state.task_store = task_store
    app.state.registry = registry
    app.state.backend = backend
    app.state.auth_store = auth_store

    @app.get("/")
    async def root() -> dict[str, Any]:
        return {
            "name": "Relay backend",
            "ui": True,
            "uiPath": "/cp",
            "webUiPath": WEB_UI_PATH,
            "endpoints": [
                "GET /tasks",
                "POST /tasks",
                "GET /sessions",
                "POST /sessions",
                "GET /sandboxes",
                "POST /sandboxes",
                "GET /daemon-nodes",
                "POST /daemon-nodes/register",
                "GET /daemon-nodes/:sandboxId/commands",
                "POST /daemon-nodes/:sandboxId/events",
            ],
        }

    @app.get("/cp", response_class=HTMLResponse)
    async def control_panel() -> str:
        return daemon_control_panel_html()

    @app.get("/cp/version")
    async def control_panel_version(request: Request) -> dict[str, str]:
        require_admin_session(request, auth_store)
        return {"version": CONTROL_PANEL_VERSION}

    @app.get("/auth/status")
    async def auth_status() -> dict[str, Any]:
        return {"requiresBootstrap": not auth_store.has_users()}

    @app.get("/auth/me")
    async def auth_me(request: Request) -> dict[str, Any]:
        user = require_user_session(request, auth_store)
        return {"authenticated": True, "user": auth_store._public_user(user)}

    @app.post("/auth/bootstrap")
    async def auth_bootstrap(request: Request, response: Response) -> dict[str, Any]:
        body = await json_body(request)
        try:
            user = auth_store.bootstrap_with_token(
                string_field(body, "token"),
                string_field(body, "username"),
                string_field(body, "password"),
            )
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        session = auth_store.create_session(user["id"])
        attrs = user_session_cookie_attrs(max_age_seconds=auth_store.session_ttl_seconds, secure=request.url.scheme == "https")
        response.set_cookie(value=session["token"], **attrs)
        return {"user": user}

    @app.post("/auth/login")
    async def auth_login(request: Request, response: Response) -> dict[str, Any]:
        body = await json_body(request)
        user = auth_store.authenticate(string_field(body, "username"), string_field(body, "password"))
        if not user:
            raise HTTPException(401, "Invalid username or password.")
        session = auth_store.create_session(user["id"])
        attrs = user_session_cookie_attrs(max_age_seconds=auth_store.session_ttl_seconds, secure=request.url.scheme == "https")
        response.set_cookie(value=session["token"], **attrs)
        return {"user": auth_store._public_user(user)}

    @app.post("/auth/logout")
    async def auth_logout(request: Request, response: Response) -> dict[str, bool]:
        token = user_session_token_from_request(request)
        if token:
            auth_store.delete_session(token)
        response.delete_cookie(
            key=USER_COOKIE_NAME,
            path="/",
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return {"ok": True}

    @app.get("/cp/users")
    async def list_users(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        return {"users": auth_store.list_users()}

    @app.post("/cp/users", status_code=201)
    async def create_user(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        body = await json_body(request)
        try:
            user = auth_store.create_user(
                string_field(body, "username"),
                string_field(body, "password"),
                role=string_field(body, "role") or "user",
                email=string_field(body, "email") or None,
                employee_id=string_field(body, "employeeId") or None,
                department_id=string_field(body, "departmentId") or None,
                department_name=string_field(body, "departmentName") or None,
            )
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"user": user}

    @app.get("/cp/departments")
    async def list_departments(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        if hasattr(auth_store, "list_departments"):
            return {"departments": auth_store.list_departments()}
        return {"departments": []}

    @app.post("/cp/departments", status_code=201)
    async def create_department(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        if not hasattr(auth_store, "ensure_department"):
            raise HTTPException(400, "Department storage is only available with database auth storage.")
        body = await json_body(request)
        department_id = string_field(body, "id") or string_field(body, "departmentId")
        name = string_field(body, "name") or department_id
        if not department_id:
            raise HTTPException(400, "departmentId is required.")
        try:
            department = auth_store.ensure_department(
                department_id,
                name=name,
                parent_department_id=string_field(body, "parentDepartmentId") or None,
            )
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"department": department}

    @app.get("/cp/employees")
    async def list_employees(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        if hasattr(auth_store, "list_employees"):
            return {"employees": auth_store.list_employees()}
        employees = []
        seen = set()
        for user in auth_store.list_users():
            employee_id = user.get("employeeId")
            if not employee_id or employee_id in seen:
                continue
            seen.add(employee_id)
            employees.append({
                "id": employee_id,
                "displayName": user.get("username") or employee_id,
                "email": user.get("email"),
                "createdAt": user.get("createdAt"),
                "updatedAt": user.get("createdAt"),
            })
        return {"employees": employees}

    @app.get("/cp/daemon-nodes")
    async def control_panel_nodes(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        return {"nodes": registry.control_panel_nodes()}

    @app.post("/cp/daemon-nodes", status_code=201)
    async def create_control_panel_daemon_node(request: Request) -> dict[str, Any]:
        require_admin_session(request, auth_store)
        body = await json_body(request)
        employee_id = string_field(body, "employeeId")
        if not employee_id:
            raise HTTPException(400, "employeeId is required.")
        if hasattr(auth_store, "ensure_employee"):
            auth_store.ensure_employee(employee_id)
        node = backend.provision_daemon_node({
            "employeeId": employee_id,
            "workspacePath": string_field(body, "workspacePath") or None,
        })
        public_node = next((item for item in registry.control_panel_nodes() if item["id"] == node["id"]), public_sandbox_record(node))
        response = {
            "node": public_node,
            "daemonEnv": daemon_start_env(request, node),
        }
        if node.get("nodeToken"):
            response["nodeToken"] = node["nodeToken"]
            response["daemonCommand"] = daemon_start_command(request, node)
        return response

    @app.get("/web")
    @app.get("/web/{asset_path:path}")
    async def web_asset(asset_path: str = "") -> Response:
        return web_ui_asset_response(asset_path)

    @app.get("/tasks")
    async def list_tasks(request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        return {"tasks": [task for task in task_store.list_tasks() if actor_can_access_record(actor, task)]}

    @app.post("/tasks", status_code=201)
    async def create_task(request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        body = await json_body(request)
        title = string_field(body, "title") or string_field(body, "taskGoal")
        if not title:
            raise HTTPException(400, "title is required.")
        owner = owner_employee_id_for_create(actor, body)
        task = task_store.create_task({
            "title": title,
            "description": string_field(body, "description"),
            "priority": task_priority(body.get("priority")) or "normal",
            "ownerEmployeeId": owner,
        })
        logger.info("Task created", task_id=task["id"], title=title, owner=owner)
        agent = valid_agent(body.get("assignedAgent"))
        if agent:
            task = task_store.assign_task(task["id"], agent)
            logger.info("Task assigned", task_id=task["id"], agent=agent)
        if body.get("createSession") is True or isinstance(body.get("assignments"), list):
            workspace_path = string_field(body, "workspacePath") or "/workspace"
            controller = SessionController(session_store, task_store=task_store, task_id=task["id"], workspace_path=workspace_path, owner_employee_id=owner)
            session = controller.create_session(f"{task['title']}\n\n{task['description']}" if task.get("description") else task["title"], participants_for_assignments(body.get("assignments"), agent), True)
            logger.info("Session created from task", task_id=task["id"], session_id=session["id"], workspace_path=workspace_path)
            assignments = assignment_list(body.get("assignments"))
            if assignments:
                controller.assign_session(session["id"], assignments)
            task = task_store.link_session(task["id"], session["id"])
        return task

    @app.get("/tasks/{task_id}")
    async def get_task(task_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        return get_task_for_actor(task_store, task_id, actor)

    @app.patch("/tasks/{task_id}")
    async def update_task(task_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        get_task_for_actor(task_store, task_id, actor)
        body = await json_body(request)
        title = string_field(body, "title") or None
        description = body.get("description") if isinstance(body.get("description"), str) else None
        priority = task_priority(body.get("priority"))
        status = task_status(body.get("status"))
        if not title and description is None and not priority and not status:
            raise HTTPException(400, "PATCH requires title, description, priority, or status.")
        return task_store.update_task(task_id, {"title": title, "description": description, "priority": priority, "status": status})

    @app.post("/tasks/{task_id}/assign")
    async def assign_task(task_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        get_task_for_actor(task_store, task_id, actor)
        body = await json_body(request)
        agent = valid_agent(body.get("agent"))
        if not agent:
            raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
        return task_store.assign_task(task_id, agent)

    @app.post("/tasks/{task_id}/pickup")
    async def pickup_task(task_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        body = await json_body(request)
        current = get_task_for_actor(task_store, task_id, actor)
        agent = valid_agent(body.get("agent")) or current.get("assignedAgent")
        if not agent:
            raise HTTPException(400, f"agent must be one of: {', '.join(AGENT_NAMES)}.")
        task = current if current.get("assignedAgent") == agent else task_store.assign_task(task_id, agent)
        workspace_path = string_field(body, "workspacePath") or "/workspace"
        controller = SessionController(session_store, task_store=task_store, task_id=task["id"], workspace_path=workspace_path, owner_employee_id=current.get("ownerEmployeeId") or actor["employeeId"])
        session = controller.create_session(f"{task['title']}\n\n{task['description']}" if task.get("description") else task["title"], ["human", agent], True)
        mode = "review" if body.get("mode") == "review" or (agent == "codex" and body.get("mode") != "implement") else "implement"
        controller.assign_session(session["id"], [{"agent": agent, "mode": mode}])
        task = task_store.record_activity(task["id"], f"{agent} picked up the task.", {"agent": agent, "sessionId": session["id"]})
        logger.info("Task picked up", task_id=task_id, session_id=session["id"], agent=agent, mode=mode)
        return {"task": task, "session": session_store.get_session(session["id"])}

    @app.get("/tasks/{task_id}/events")
    async def task_events(task_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        return {"events": get_task_for_actor(task_store, task_id, actor)["events"]}

    @app.get("/sessions")
    async def list_sessions(request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        return {"sessions": [session for session in session_store.list_sessions() if actor_can_access_record(actor, session)]}

    @app.post("/sessions", status_code=201)
    async def create_session(request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        body = await json_body(request)
        task_goal = string_field(body, "taskGoal")
        if not task_goal:
            raise HTTPException(400, "taskGoal is required.")
        assignments = assignment_list(body.get("assignments"))
        workspace_path = string_field(body, "workspacePath") or "/workspace"
        task_id = body.get("taskId") if isinstance(body.get("taskId"), str) else None
        task = get_task_for_actor(task_store, task_id, actor) if task_id else None
        owner = owner_employee_id_for_create(actor, body)
        if task and task.get("ownerEmployeeId"):
            requested_owner = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
            if actor["isAdmin"] and not requested_owner:
                owner = task["ownerEmployeeId"]
            elif owner != task["ownerEmployeeId"]:
                raise HTTPException(403, "Session owner must match the linked task owner.")
        controller = SessionController(session_store, task_store=task_store, task_id=task_id, workspace_path=workspace_path, owner_employee_id=owner)
        session = controller.create_session(task_goal, list(dict.fromkeys(["human", *(assignment["agent"] for assignment in assignments)])), True)
        if assignments:
            controller.assign_session(session["id"], assignments)
        logger.info("Session created", session_id=session["id"], workspace_path=workspace_path, owner=owner)
        return session_store.get_session(session["id"])

    @app.get("/sessions/{session_id}")
    async def get_session(session_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        return get_session_for_actor(session_store, session_id, actor)

    @app.post("/sessions/{session_id}/assignments")
    async def assign_session(session_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        get_session_for_actor(session_store, session_id, actor)
        body = await json_body(request)
        assignments = assignment_list(body.get("assignments"))
        if not assignments:
            raise HTTPException(400, "assignments must include at least one agent.")
        controller = SessionController(session_store, task_store=task_store, owner_employee_id=actor["employeeId"])
        controller.assign_session(session_id, assignments)
        return session_store.get_session(session_id)

    @app.post("/sessions/{session_id}/decisions")
    async def decision(session_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        get_session_for_actor(session_store, session_id, actor)
        body = await json_body(request)
        kind = body.get("kind")
        if kind not in ("approve", "reject", "cancel", "rerun", "handoff", "mark_done"):
            raise HTTPException(400, "kind must be approve, reject, cancel, rerun, handoff, or mark_done.")
        controller = SessionController(session_store, task_store=task_store, owner_employee_id=actor["employeeId"])
        result = controller.record_decision(session_id, kind, string_field(body, "note") or None, valid_agent(body.get("targetAgent")))
        logger.info("Session decision recorded", session_id=session_id, kind=kind)
        return result

    @app.post("/sessions/{session_id}/handoffs")
    async def handoff(session_id: str, request: Request) -> dict[str, Any]:
        actor = request_actor(request, auth_store)
        get_session_for_actor(session_store, session_id, actor)
        body = await json_body(request)
        target_agent = valid_agent(body.get("targetAgent"))
        if not target_agent:
            raise HTTPException(400, f"targetAgent must be one of: {', '.join(AGENT_NAMES)}.")
        mode = "review" if body.get("mode") == "review" or (target_agent == "codex" and body.get("mode") != "implement") else "implement"
        controller = SessionController(session_store, task_store=task_store, owner_employee_id=actor["employeeId"])
        result = controller.handoff_session(session_id, target_agent, [{"agent": target_agent, "mode": mode, "role": role_name(body.get("role"))}], string_field(body, "note") or None)
        logger.info("Session handoff recorded", session_id=session_id, target_agent=target_agent, mode=mode)
        return result

    @app.get("/sessions/{session_id}/events")
    async def session_events(session_id: str, request: Request) -> Response:
        actor = request_actor(request, auth_store)
        session = get_session_for_actor(session_store, session_id, actor)
        body = "".join(f"event: {event['type']}\ndata: {__import__('json').dumps(event)}\n\n" for event in session["events"])
        body += f"event: heartbeat\ndata: {__import__('json').dumps({'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z'})}\n\n"
        return Response(body, media_type="text/event-stream")

    @app.get("/sessions/{session_id}/artifacts/{artifact_id}")
    async def read_artifact(session_id: str, artifact_id: str, request: Request) -> PlainTextResponse:
        actor = request_actor(request, auth_store)
        get_session_for_actor(session_store, session_id, actor)
        try:
            return PlainTextResponse(session_store.read_artifact(session_id, artifact_id))
        except Exception:
            raise HTTPException(404, "Artifact not found.")

    @app.get("/sandboxes")
    async def sandboxes(request: Request) -> dict[str, Any]:
        token = bearer_token(request)
        allowed = [public_sandbox_record(sandbox) for sandbox in backend.list() if sandbox_ui_token_matches(sandbox, token)]
        if not token or not allowed:
            raise HTTPException(401, "Invalid sandbox token." if token else "Sandbox token is required.")
        return {"sandboxes": allowed}

    @app.post("/sandboxes", status_code=201)
    async def provision_sandbox(request: Request) -> dict[str, Any]:
        body = await json_body(request)
        employee_id = string_field(body, "employeeId")
        if not employee_id:
            raise HTTPException(400, "employeeId is required.")
        try:
            sandbox = backend.provision({
                "employeeId": employee_id,
                "workspacePath": string_field(body, "workspacePath") or None,
                "token": bearer_token(request),
                "nodeToken": string_field(body, "nodeToken") or None,
            })
            logger.info("Sandbox provisioned", sandbox_id=sandbox["id"], employee_id=employee_id)
            return provisioned_sandbox_record(sandbox)
        except PermissionError as error:
            logger.warning("Sandbox provisioning denied", employee_id=employee_id, error=str(error))
            raise HTTPException(401, str(error))

    @app.get("/sandboxes/{sandbox_id}")
    async def get_sandbox(sandbox_id: str, request: Request) -> dict[str, Any]:
        sandbox = backend.get(sandbox_id)
        if not sandbox:
            raise HTTPException(404, "Sandbox not found.")
        auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
        if auth_error:
            raise HTTPException(401, auth_error)
        return public_sandbox_record(sandbox)

    @app.post("/sandboxes/{sandbox_id}/runs", status_code=202)
    async def run_sandbox(sandbox_id: str, request: Request) -> dict[str, Any]:
        sandbox = backend.get(sandbox_id)
        if not sandbox:
            raise HTTPException(404, "Sandbox not found.")
        auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
        if auth_error:
            logger.warning("Sandbox run unauthorized", sandbox_id=sandbox_id, error=auth_error)
            raise HTTPException(401, auth_error)
        body = await json_body(request)
        try:
            parsed = SandboxRunRequest.model_validate(body).relay_dump()
        except Exception:
            raise HTTPException(400, "taskGoal and at least one assignment are required.")
        if not parsed["assignments"]:
            raise HTTPException(400, "taskGoal and at least one assignment are required.")
        logger.info("Sandbox run starting", sandbox_id=sandbox_id, session_id=parsed.get("sessionId"))
        return await backend.run(sandbox_id, parsed)

    @app.post("/sandboxes/{sandbox_id}/runs/{session_id}/cancel", status_code=202)
    async def cancel_sandbox_run(sandbox_id: str, session_id: str, request: Request) -> dict[str, Any]:
        sandbox = backend.get(sandbox_id)
        if not sandbox:
            raise HTTPException(404, "Sandbox not found.")
        auth_error = sandbox_ui_auth_error(sandbox, bearer_token(request))
        if auth_error:
            logger.warning("Sandbox run cancel unauthorized", sandbox_id=sandbox_id, error=auth_error)
            raise HTTPException(401, auth_error)
        body = await json_body(request)
        try:
            result = backend.cancel_run(sandbox_id, session_id, string_field(body, "reason") or "Cancelled by human.")
            logger.info("Sandbox run cancelled", sandbox_id=sandbox_id, session_id=session_id)
            return result
        except Exception as error:
            logger.warning("Sandbox run cancel failed", sandbox_id=sandbox_id, session_id=session_id, error=str(error))
            raise HTTPException(400, str(error))

    @app.get("/daemon-nodes")
    async def list_daemon_nodes(request: Request) -> dict[str, Any]:
        nodes = registry.monitor_nodes_for_token(bearer_token(request))
        if nodes is None:
            raise HTTPException(401, "Invalid sandbox token." if bearer_token(request) else "Sandbox token is required.")
        return {"nodes": nodes}

    @app.post("/daemon-nodes/register")
    async def register_daemon_node(request: Request) -> dict[str, Any]:
        body = await json_body(request)
        if "token" not in body and bearer_token(request):
            body["token"] = bearer_token(request)
        try:
            registration = DaemonNodeRegistration.model_validate(body).relay_dump()
            sandbox = registry.register(registration, bearer_token(request))
            logger.info("Daemon node registered", sandbox_id=sandbox["id"], employee_id=sandbox.get("employeeId"), status=sandbox.get("status"))
            return sandbox
        except PermissionError as error:
            logger.warning("Daemon node registration denied", sandbox_id=body.get("sandboxId"), error=str(error))
            raise HTTPException(401, str(error))
        except Exception as error:
            logger.warning("Daemon node registration failed", sandbox_id=body.get("sandboxId"), error=str(error))
            raise HTTPException(400, str(error))

    @app.get("/daemon-nodes/{sandbox_id}/commands")
    async def daemon_commands(sandbox_id: str, request: Request) -> dict[str, Any]:
        try:
            commands = registry.take_commands(sandbox_id, bearer_token(request))
            logger.debug("Daemon node commands polled", sandbox_id=sandbox_id, command_count=len(commands))
            return {"commands": commands}
        except PermissionError as error:
            logger.warning("Daemon node commands unauthorized", sandbox_id=sandbox_id, error=str(error))
            raise HTTPException(401, str(error))
        except KeyError as error:
            raise HTTPException(404, str(error))

    @app.post("/daemon-nodes/{sandbox_id}/events", status_code=202)
    async def daemon_events(sandbox_id: str, request: Request) -> dict[str, bool]:
        try:
            event = daemon_node_event(await json_body(request))
            registry.handle_event(sandbox_id, event, bearer_token(request))
            logger.debug("Daemon node event handled", sandbox_id=sandbox_id, event_type=event["type"], run_id=event["runId"])
            return {"ok": True}
        except PermissionError as error:
            logger.warning("Daemon node event unauthorized", sandbox_id=sandbox_id, error=str(error))
            raise HTTPException(401, str(error))
        except KeyError as error:
            raise HTTPException(404, str(error))
        except Exception as error:
            logger.warning("Daemon node event rejected", sandbox_id=sandbox_id, error=str(error))
            raise HTTPException(400, str(error))

    return app


async def json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    parts = header.split(" ", 1)
    return parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else None


def string_field(value: dict[str, Any], key: str) -> str:
    field = value.get(key)
    return field.strip() if isinstance(field, str) else ""


def backend_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def daemon_start_env(request: Request, node: dict[str, Any]) -> dict[str, str]:
    env = {
        "RELAY_BACKEND_URL": backend_base_url(request),
        "RELAY_SANDBOX_ID": node["id"],
        "RELAY_EMPLOYEE_ID": node["employeeId"],
    }
    if node.get("nodeToken"):
        env["RELAY_DAEMON_NODE_TOKEN"] = node["nodeToken"]
    if node.get("workspacePath"):
        env["RELAY_WORKSPACE"] = node["workspacePath"]
    return env


def daemon_start_command(request: Request, node: dict[str, Any]) -> str:
    parts = [
        "relay-daemon",
        "--backend-url",
        backend_base_url(request),
        "--sandbox-id",
        node["id"],
        "--employee-id",
        node["employeeId"],
        "--token",
        node.get("nodeToken") or "",
    ]
    return " ".join(shlex.quote(part) for part in parts)


def daemon_store_from_env(root_dir: Path) -> Any:
    daemon_store = os.environ.get("RELAY_DAEMON_STORE", "").strip().lower()
    if daemon_store != "database" and not use_postgres_storage():
        return LocalDaemonStore(root_dir)
    setting = "RELAY_DAEMON_STORE=database" if daemon_store == "database" else "RELAY_STORAGE=postgres"
    database_url = database_url_from_env(setting=setting)
    return DatabaseDaemonStore(database_url)


def session_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalSessionStore(root_dir)
    return DatabaseSessionStore(database_url_from_env(), root_dir)


def task_store_from_env(root_dir: Path) -> Any:
    if not use_postgres_storage():
        return LocalTaskStore(root_dir)
    return DatabaseTaskStore(database_url_from_env())


def get_session_or_404(store: Any, session_id: str) -> dict[str, Any]:
    try:
        return store.get_session(session_id)
    except Exception:
        raise HTTPException(404, "Session not found.")


def get_task_or_404(store: Any, task_id: str) -> dict[str, Any]:
    try:
        return store.get_task(task_id)
    except Exception:
        raise HTTPException(404, "Task not found.")


def request_actor(request: Request, auth_store: Any) -> dict[str, Any]:
    user = require_user_session(request, auth_store)
    employee_id = user.get("employeeId") or user.get("username") or user["id"]
    return {
        "user": user,
        "employeeId": employee_id,
        "isAdmin": user.get("role") == "admin",
    }


def owner_employee_id_for_create(actor: dict[str, Any], body: dict[str, Any]) -> str:
    requested = string_field(body, "ownerEmployeeId") or string_field(body, "employeeId")
    if actor["isAdmin"] and requested:
        return requested
    return actor["employeeId"]


def actor_can_access_record(actor: dict[str, Any], record: dict[str, Any]) -> bool:
    if actor["isAdmin"]:
        return True
    return record.get("ownerEmployeeId") == actor["employeeId"]


def get_session_for_actor(store: Any, session_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    session = get_session_or_404(store, session_id)
    if not actor_can_access_record(actor, session):
        raise HTTPException(403, "Session access denied.")
    return session


def get_task_for_actor(store: Any, task_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    task = get_task_or_404(store, task_id)
    if not actor_can_access_record(actor, task):
        raise HTTPException(403, "Task access denied.")
    return task


def assignment_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        agent = valid_agent(item.get("agent"))
        if not agent:
            continue
        result.append({
            "agent": agent,
            "mode": "review" if item.get("mode") == "review" else "implement",
            **({"role": item["role"]} if role_name(item.get("role")) else {}),
        })
    return result


def participants_for_assignments(assignments: Any, assigned_agent: str | None) -> list[str]:
    agents = [assignment["agent"] for assignment in assignment_list(assignments)]
    if assigned_agent:
        agents.append(assigned_agent)
    return list(dict.fromkeys(["human", *agents]))


def role_name(value: Any) -> str | None:
    return value if value in ("implementer", "reviewer", "planner", "tester", "fixer") else None


def authorized_sandbox_for_token(registry: DaemonNodeRegistry, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return next((sandbox for sandbox in registry.list_ready() if sandbox_ui_token_matches(sandbox, token)), None)


def session_belongs_to_sandbox(session: dict[str, Any], sandbox: dict[str, Any]) -> bool:
    return not sandbox.get("workspacePath") or workspace_paths_match(session.get("workspacePath"), sandbox.get("workspacePath"))


def daemon_node_event(value: dict[str, Any]) -> dict[str, Any]:
    event_type = string_field(value, "type")
    command_id = string_field(value, "commandId")
    session_id = string_field(value, "sessionId")
    run_id = string_field(value, "runId")
    agent = valid_agent(value.get("agent"))
    if not command_id or not session_id or not run_id or not agent:
        raise ValueError("daemon node event requires commandId, sessionId, runId, and agent.")
    if event_type == "run.output":
        if value.get("stream") not in ("stdout", "stderr") or not isinstance(value.get("sequence"), (int, float)) or not isinstance(value.get("text"), str):
            raise ValueError("invalid daemon node run.output event.")
        return {"type": event_type, "commandId": command_id, "sessionId": session_id, "runId": run_id, "agent": agent, "stream": value["stream"], "text": value["text"], "sequence": int(value["sequence"])}
    mode = "review" if value.get("mode") == "review" else "implement"
    if event_type == "run.completed":
        if not isinstance(value.get("exitCode"), (int, float)):
            raise ValueError("daemon node run.completed exitCode must be a finite number.")
        verdict = value.get("codexVerdict", "")
        if verdict not in ("approved", "rejected", "failed", ""):
            raise ValueError(f"invalid codexVerdict {verdict}.")
        return {"type": event_type, "commandId": command_id, "sessionId": session_id, "runId": run_id, "agent": agent, "mode": mode, "exitCode": int(value["exitCode"]), "agentLog": string_field(value, "agentLog"), "codexVerdict": verdict, "codexFeedback": string_field(value, "codexFeedback")}
    if event_type == "run.failed":
        return {"type": event_type, "commandId": command_id, "sessionId": session_id, "runId": run_id, "agent": agent, "mode": mode, "error": string_field(value, "error") or "Daemon node command failed.", **({"exitCode": int(value["exitCode"])} if isinstance(value.get("exitCode"), (int, float)) else {})}
    if event_type == "run.cancelled":
        return {"type": event_type, "commandId": command_id, "sessionId": session_id, "runId": run_id, "agent": agent, "mode": mode, "reason": string_field(value, "reason") or "Cancelled by human."}
    raise ValueError(f"unknown daemon node event type {event_type}.")


def daemon_control_panel_html() -> str:
    return """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Relay Control Panel</title></head>
<body><main><h1>Relay Control Panel</h1><p>Python backend is running.</p></main></body>
</html>
"""


def web_ui_asset_response(asset_path: str) -> Response:
    candidates = [
        os.environ.get("RELAY_WEB_UI_DIST_DIR"),
        str(Path.cwd() / "web" / "out"),
        str(Path(__file__).resolve().parents[1] / "web" / "out"),
    ]
    dist = next((Path(path) for path in candidates if path and Path(path).is_dir()), None)
    if not dist:
        return HTMLResponse("Relay web UI has not been built. Run `npm run build -w web`.\n", status_code=404)
    requested = asset_path or "index.html"
    asset = (dist / requested).resolve()
    if not str(asset).startswith(str(dist.resolve())) or not asset.exists() or not asset.is_file():
        asset = dist / "index.html"
    if not asset.exists():
        return JSONResponse({"error": "Web UI asset not found."}, status_code=404)
    content_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
    return Response(asset.read_bytes(), media_type=content_type)
