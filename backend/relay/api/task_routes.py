from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from ..persistence.stores import (
    task_priority,
    task_routine_cadence,
    task_routine_type,
    task_status,
    valid_agent,
)
from ..services.task_dispatch import (
    implicit_group_assignments_for_task,
    start_task_on_ready_node,
)
from ..services.task_dispatch import (
    start_routine_occurrence_on_ready_node as dispatch_routine_occurrence,
)
from ..services.team_dispatch import (
    TeamDispatchError,
    task_thread_assignments,
    task_thread_ownership,
)
from ..sessions import SessionController
from ..tasks import (
    materialize_legacy_agent_assignment,
    materialize_legacy_task_assignment,
    next_routine_date,
    task_goal_text,
)
from .deps import AppContextDep
from .helpers import (
    actor_can_access_record,
    agent_task_mode,
    artifact_index_item,
    assignee_employee_id_for_task,
    assignment_list,
    get_task_for_actor,
    json_body,
    owner_employee_id_for_create,
    participants_for_assignments,
    request_actor,
    string_field,
    workspace_artifact_key,
    workspace_artifacts,
)

router = APIRouter()


def logical_agent_for_assignment(
    ctx: AppContextDep,
    actor: dict[str, Any],
    agent_id: str | None,
    *,
    expected_employee_id: str | None = None,
) -> dict[str, Any] | None:
    if not agent_id:
        return None
    agent = ctx.agent_store.get_agent(agent_id)
    if not agent or agent.get("deletedAt"):
        raise HTTPException(404, "Logical agent not found.")
    allowed_employee_id = expected_employee_id or actor["employeeId"]
    if agent.get("supervisorEmployeeId") != allowed_employee_id:
        raise HTTPException(403, "Logical agent is not available to the task assignee.")
    if (
        not actor["isAdmin"]
        and agent.get("supervisorEmployeeId") != actor["employeeId"]
    ):
        raise HTTPException(403, "Logical agent access denied.")
    return agent


def team_for_assignment(
    ctx: AppContextDep,
    actor: dict[str, Any],
    team_id: str | None,
    *,
    expected_employee_id: str,
) -> dict[str, Any] | None:
    if not team_id:
        return None
    team = ctx.team_store.get_team(team_id)
    if not team or team.get("deletedAt"):
        raise HTTPException(404, "Team not found.")
    if team.get("ownerEmployeeId") != expected_employee_id:
        raise HTTPException(403, "Team is not available to the task assignee.")
    if not actor["isAdmin"] and team.get("ownerEmployeeId") != actor["employeeId"]:
        raise HTTPException(403, "Team access denied.")
    return team


def date_field(body: dict[str, Any], key: str) -> str | None:
    if key not in body:
        return None
    raw = body.get(key)
    if raw in (None, ""):
        return ""
    if not isinstance(raw, str):
        raise HTTPException(400, f"{key} must be a YYYY-MM-DD date.")
    value = raw.strip()
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"{key} must be a YYYY-MM-DD date.")
    return value


def bool_field(body: dict[str, Any], key: str) -> bool | None:
    if key not in body:
        return None
    raw = body.get(key)
    if isinstance(raw, bool):
        return raw
    raise HTTPException(400, f"{key} must be a boolean.")


def routine_fields(
    body: dict[str, Any], *, current: dict[str, Any] | None = None
) -> dict[str, Any]:
    has_routine_input = any(
        key in body
        for key in (
            "isRoutine",
            "routineType",
            "routineCadence",
            "routineNextRunDate",
            "routineEnabled",
        )
    )
    if not has_routine_input:
        return {}
    is_routine = bool_field(body, "isRoutine")
    enabled = bool_field(body, "routineEnabled")
    routine_type = (
        task_routine_type(body.get("routineType")) if "routineType" in body else None
    )
    cadence = (
        task_routine_cadence(body.get("routineCadence"))
        if "routineCadence" in body
        else None
    )
    if "routineType" in body and body.get("routineType") and not routine_type:
        raise HTTPException(400, "routineType must be one of: task, job.")
    if "routineCadence" in body and body.get("routineCadence") and not cadence:
        raise HTTPException(
            400, "routineCadence must be one of: daily, weekly, monthly, custom."
        )
    has_next_run_input = "routineNextRunDate" in body
    next_run = date_field(body, "routineNextRunDate") if has_next_run_input else None
    next_is_routine = bool(
        is_routine
        if is_routine is not None
        else current.get("isRoutine")
        if current
        else True
    )
    next_enabled = (
        enabled
        if enabled is not None
        else (
            bool((current or {}).get("routineEnabled")) if current else next_is_routine
        )
    )
    resolved_cadence = cadence or (current or {}).get("routineCadence") or "weekly"
    cadence_changed = bool(
        current and cadence and cadence != current.get("routineCadence")
    )
    reenabled = bool(current and enabled is True and not current.get("routineEnabled"))
    if (
        next_is_routine
        and resolved_cadence != "custom"
        and (
            (current is None and not has_next_run_input) or cadence_changed or reenabled
        )
    ):
        today = date.today()
        calculated_next_run = next_routine_date(today, resolved_cadence, today)
        next_run = calculated_next_run.isoformat() if calculated_next_run else None
    effective_next_run = (
        next_run
        if has_next_run_input or next_run is not None
        else (current or {}).get("routineNextRunDate")
    )
    if (
        next_is_routine
        and next_enabled
        and resolved_cadence == "custom"
        and not effective_next_run
    ):
        raise HTTPException(400, "An enabled custom routine requires a next-run date.")
    return {
        "isRoutine": is_routine if is_routine is not None else next_is_routine,
        "routineType": routine_type or (current or {}).get("routineType") or "task",
        "routineCadence": resolved_cadence,
        "routineNextRunDate": next_run,
        "routineEnabled": next_enabled,
    }


async def start_routine_occurrence_on_ready_node(
    ctx: AppContextDep,
    routine: dict[str, Any],
    actor: dict[str, Any],
    *,
    agent: str | None,
    mode: str = "action",
    assignments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    return await dispatch_routine_occurrence(
        ctx,
        routine,
        actor,
        agent=agent,
        mode=mode,
        assignments=assignments,
        run_date=date.today(),
    )


def complete_linked_task_sessions(
    ctx: AppContextDep, task: dict[str, Any], outcome: str
) -> None:
    controller = SessionController(ctx.session_store)
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = ctx.session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue
        except Exception:
            logger.warning(
                "Unexpected error reading linked session",
                session_id=session_id,
                exc_info=True,
            )
            continue
        if session.get("status") in ("completed", "failed", "cancelled"):
            continue
        controller.complete_session(session_id, outcome)


@router.get("/tasks")
async def list_tasks(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {
        "tasks": [
            task
            for task in ctx.task_store.list_tasks()
            if actor_can_access_record(actor, task)
        ]
    }


@router.post("/tasks", status_code=201)
async def create_task(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    title = string_field(body, "title") or string_field(body, "taskGoal")
    if not title:
        raise HTTPException(400, "title is required.")
    owner = owner_employee_id_for_create(actor, body)
    assignee = assignee_employee_id_for_task(actor, body, owner)
    assigned_agent_id = string_field(body, "assignedAgentId") or None
    assigned_team_id = string_field(body, "assignedTeamId") or None
    if assigned_agent_id and assigned_team_id:
        raise HTTPException(400, "task_agent_and_team_conflict")
    if "assignedAgent" in body:
        raise HTTPException(400, "assignedAgent is read-only; use assignedAgentId.")
    logical_agent = logical_agent_for_assignment(
        ctx, actor, assigned_agent_id, expected_employee_id=assignee
    )
    if logical_agent:
        assignee = logical_agent["supervisorEmployeeId"]
    team_for_assignment(
        ctx,
        actor,
        assigned_team_id,
        expected_employee_id=assignee,
    )
    agent = logical_agent["executorKind"] if logical_agent else None
    status = task_status(body.get("status"))
    if "status" in body and not status:
        raise HTTPException(400, "status is not a recognized task status.")
    if status == "assigned" and not (assigned_agent_id or assigned_team_id):
        raise HTTPException(400, "assigned status requires an agent or team.")
    routine = routine_fields(body)
    if (
        routine.get("isRoutine")
        and not (assigned_agent_id or assigned_team_id)
        and "routineEnabled" not in body
    ):
        routine["routineEnabled"] = False
    if routine.get("routineEnabled") and not (assigned_agent_id or assigned_team_id):
        raise HTTPException(400, "An enabled routine requires an agent or team.")
    creates_thread = body.get("createSession") is True or isinstance(
        body.get("assignments"), list
    )
    if creates_thread and assigned_team_id:
        try:
            task_thread_ownership(
                {
                    "ownerEmployeeId": owner,
                    "assigneeEmployeeId": assignee,
                    "assignedTeamId": assigned_team_id,
                },
                team_store=ctx.team_store,
                agent_store=ctx.agent_store,
            )
        except TeamDispatchError as error:
            raise HTTPException(409, error.code) from error
    task = ctx.task_store.create_task(
        {
            "title": title,
            "description": string_field(body, "description"),
            "priority": task_priority(body.get("priority")) or "normal",
            "ownerEmployeeId": owner,
            "assigneeEmployeeId": assignee,
            "dueDate": date_field(body, "dueDate"),
            "status": status,
            **(
                {"assignedAgent": agent, "assignedAgentId": assigned_agent_id}
                if agent and assigned_agent_id
                else {}
            ),
            **({"assignedTeamId": assigned_team_id} if assigned_team_id else {}),
            **routine,
        }
    )
    logger.info("Task created", task_id=task["id"], title=title, owner=owner)
    if agent:
        logger.info(
            "Task assigned", task_id=task["id"], agent=agent, agent_id=assigned_agent_id
        )
    if creates_thread:
        workspace_path = string_field(body, "workspacePath") or "/workspace"
        try:
            thread_ownership = task_thread_ownership(
                task, team_store=ctx.team_store, agent_store=ctx.agent_store
            )
        except TeamDispatchError as error:
            raise HTTPException(409, error.code) from error
        assignments = task_thread_assignments(
            task,
            assignment_list(body.get("assignments")),
            team_store=ctx.team_store,
            agent_store=ctx.agent_store,
        )
        controller = SessionController(
            ctx.session_store,
            task_store=ctx.task_store,
            task_id=task["id"],
            workspace_path=workspace_path,
            **thread_ownership,
        )
        session = controller.create_session(
            task_goal_text(task),
            participants_for_assignments(assignments, None),
            True,
        )
        logger.info(
            "Session created from task",
            task_id=task["id"],
            session_id=session["id"],
            workspace_path=workspace_path,
        )
        if assignments:
            controller.assign_session(session["id"], assignments)
        task = ctx.task_store.link_session(task["id"], session["id"])
    return task


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return get_task_for_actor(ctx.task_store, task_id, actor)


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    title = string_field(body, "title") or None
    description = (
        body.get("description") if isinstance(body.get("description"), str) else None
    )
    priority = task_priority(body.get("priority"))
    status = task_status(body.get("status"))
    if "status" in body and not status:
        raise HTTPException(400, "status is not a recognized task status.")
    due_date = date_field(body, "dueDate")
    routine = routine_fields(body, current=current)
    assignee = (
        assignee_employee_id_for_task(actor, body, current.get("assigneeEmployeeId"))
        if "assigneeEmployeeId" in body or "assignee_employee_id" in body
        else None
    )
    agent = valid_agent(body.get("assignedAgent")) if "assignedAgent" in body else None
    assigned_agent_id = (
        string_field(body, "assignedAgentId") if "assignedAgentId" in body else None
    )
    assigned_team_id = (
        string_field(body, "assignedTeamId") if "assignedTeamId" in body else None
    )
    if assigned_agent_id and assigned_team_id:
        raise HTTPException(400, "task_agent_and_team_conflict")
    if "assignedAgent" in body:
        raise HTTPException(400, "assignedAgent is read-only; use assignedAgentId.")
    assignee_changed = bool(assignee and assignee != current.get("assigneeEmployeeId"))
    if (
        assignee_changed
        and (current.get("assignedAgentId") or current.get("assignedTeamId"))
        and "assignedAgentId" not in body
        and "assignedTeamId" not in body
    ):
        raise HTTPException(
            400,
            "Changing the assignee requires an assignment for the new employee, or an explicit empty assignment.",
        )
    if (
        assignee_changed
        and current.get("ownerEmployeeId") == current.get("assigneeEmployeeId")
        and assignee != current.get("ownerEmployeeId")
    ):
        raise HTTPException(
            403,
            "An employee-owned task cannot be reassigned to another employee.",
        )
    logical_agent = None
    if not (
        assigned_agent_id
        and assigned_agent_id == current.get("assignedAgentId")
        and not assignee_changed
    ):
        logical_agent = logical_agent_for_assignment(
            ctx,
            actor,
            assigned_agent_id,
            expected_employee_id=assignee
            or current.get("assigneeEmployeeId")
            or current.get("ownerEmployeeId"),
        )
    if logical_agent:
        if agent and agent != logical_agent["executorKind"]:
            raise HTTPException(
                400, "assignedAgent does not match assignedAgentId executor kind."
            )
        agent = logical_agent["executorKind"]
        assignee = logical_agent["supervisorEmployeeId"]
    expected_team_employee_id = (
        assignee
        or current.get("assigneeEmployeeId")
        or current.get("ownerEmployeeId")
        or actor["employeeId"]
    )
    team = None
    if not (
        assigned_team_id
        and assigned_team_id == current.get("assignedTeamId")
        and not assignee_changed
    ):
        team = team_for_assignment(
            ctx,
            actor,
            assigned_team_id,
            expected_employee_id=expected_team_employee_id,
        )
    if (
        not title
        and description is None
        and not priority
        and not status
        and due_date is None
        and assignee is None
        and not agent
        and "assignedAgentId" not in body
        and "assignedTeamId" not in body
        and not routine
    ):
        raise HTTPException(
            400,
            "PATCH requires title, description, priority, dueDate, assigneeEmployeeId, assignedAgentId, assignedTeamId, or status.",
        )
    next_routine_enabled = routine.get("routineEnabled", current.get("routineEnabled"))
    next_is_routine = routine.get("isRoutine", current.get("isRoutine"))
    next_agent_id = (
        assigned_agent_id
        if "assignedAgentId" in body
        else current.get("assignedAgentId")
    )
    next_team_id = (
        assigned_team_id if "assignedTeamId" in body else current.get("assignedTeamId")
    )
    if "assignedAgentId" in body and assigned_agent_id:
        next_team_id = None
    if "assignedTeamId" in body and assigned_team_id:
        next_agent_id = None
    if next_is_routine and next_routine_enabled and not (next_agent_id or next_team_id):
        raise HTTPException(400, "An enabled routine requires an agent or team.")
    if status == "assigned" and not (next_agent_id or next_team_id):
        raise HTTPException(400, "assigned status requires an agent or team.")
    assignment_change: dict[str, Any] | None = None
    if logical_agent and assigned_agent_id != current.get("assignedAgentId"):
        assignment_change = {"agent": agent, "agentId": assigned_agent_id}
    elif team and assigned_team_id != current.get("assignedTeamId"):
        assignment_change = {"teamId": assigned_team_id}
    elif (
        ("assignedAgentId" in body and not assigned_agent_id)
        or ("assignedTeamId" in body and not assigned_team_id)
    ) and not (next_agent_id or next_team_id):
        assignment_change = {}
    task = ctx.task_store.update_task(
        task_id,
        {
            "title": title,
            "description": description,
            "priority": priority,
            "status": status,
            "dueDate": due_date,
            "assigneeEmployeeId": assignee,
            **routine,
        },
        assignment=assignment_change,
    )
    if status == "done":
        complete_linked_task_sessions(ctx, task, "Task marked done.")
        task = ctx.task_store.get_task(task_id)
    return task


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_task_for_actor(ctx.task_store, task_id, actor)
    task = ctx.task_store.delete_task(task_id)
    logger.info(
        "Task deleted",
        task_id=task_id,
        actor=actor.get("employeeId") or actor.get("username"),
    )
    return task


@router.put("/tasks/{task_id}/assignment")
async def assign_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    assigned_agent_id = (
        string_field(body, "agentId") or string_field(body, "assignedAgentId") or None
    )
    assigned_team_id = (
        string_field(body, "teamId") or string_field(body, "assignedTeamId") or None
    )
    if assigned_agent_id and assigned_team_id:
        raise HTTPException(400, "task_agent_and_team_conflict")
    if assigned_team_id:
        team_for_assignment(
            ctx,
            actor,
            assigned_team_id,
            expected_employee_id=current.get("assigneeEmployeeId")
            or current.get("ownerEmployeeId")
            or actor["employeeId"],
        )
        try:
            task_thread_ownership(
                {**current, "assignedTeamId": assigned_team_id},
                team_store=ctx.team_store,
                agent_store=ctx.agent_store,
            )
        except TeamDispatchError as error:
            raise HTTPException(409, error.code) from error
        return ctx.task_store.update_task(
            task_id,
            {"status": "assigned"},
            assignment={"teamId": assigned_team_id},
        )
    logical_agent = logical_agent_for_assignment(
        ctx,
        actor,
        assigned_agent_id,
        expected_employee_id=current.get("assigneeEmployeeId")
        or current.get("ownerEmployeeId")
        or actor["employeeId"],
    )
    if not logical_agent or not assigned_agent_id:
        raise HTTPException(400, "agentId is required for task assignment.")
    return ctx.task_store.update_task(
        task_id,
        {"status": "assigned"},
        assignment={
            "agent": logical_agent["executorKind"],
            "agentId": assigned_agent_id,
        },
    )


@router.post("/tasks/{task_id}/runs", status_code=202)
async def start_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    body = await json_body(request)
    assignments = assignment_list(body.get("assignments"))
    if body.get("agent") is not None:
        raise HTTPException(400, "agent is read-only; start through assignedAgentId.")
    if assignments and task.get("assignedTeamId"):
        assignments = []
    if assignments and task.get("assignedAgentId"):
        if (
            len(assignments) != 1
            or assignments[0].get("agentId") != task.get("assignedAgentId")
        ):
            raise HTTPException(409, "task_assignment_override")
        if not task.get("assignedAgent"):
            raise HTTPException(409, "task_assignment_invalid")
        assignments = [
            {
                "agentId": task["assignedAgentId"],
                "agent": task["assignedAgent"],
                "mode": assignments[0]["mode"],
            }
        ]
    if (
        not task.get("assignedTeamId")
        and assignments
        and any(not assignment.get("agentId") for assignment in assignments)
    ):
        materialized_assignments = []
        for assignment in assignments:
            if assignment.get("agentId"):
                materialized_assignments.append(assignment)
                continue
            executor_kind = valid_agent(assignment.get("agent"))
            materialized = (
                materialize_legacy_agent_assignment(
                    task,
                    executor_kind,
                    registry=ctx.registry,
                    agent_store=ctx.agent_store,
                    placement_store=ctx.agent_placement_store,
                )
                if executor_kind
                else None
            )
            if not materialized:
                updated = ctx.task_store.record_dispatch_outcome(
                    task_id,
                    "rejected",
                    code="agent_not_found",
                    message="Every start assignment requires an available agent.",
                )
                return {
                    "task": updated,
                    "session": None,
                    "dispatch": {
                        "state": "rejected",
                        "code": "agent_not_found",
                        "message": "Every start assignment requires an available agent.",
                    },
                }
            materialized_assignments.append({**assignment, **materialized})
        assignments = materialized_assignments
    if (
        not assignments
        and task.get("assignedAgent")
        and not task.get("assignedAgentId")
    ):
        task = materialize_legacy_task_assignment(
            task,
            task_store=ctx.task_store,
            registry=ctx.registry,
            agent_store=ctx.agent_store,
            placement_store=ctx.agent_placement_store,
        )
        if not task:
            updated = ctx.task_store.record_dispatch_outcome(
                task_id,
                "queued",
                code="agent_offline",
                message="No compatible runtime is currently available for this legacy task.",
            )
            return {
                "task": updated,
                "session": None,
                "dispatch": {
                    "state": "queued",
                    "code": "agent_offline",
                    "message": "No compatible runtime is currently available for this legacy task.",
                },
            }
    if not assignments and task.get("assignedAgentId") and task.get("assignedAgent"):
        assignments = [
            {
                "agentId": task["assignedAgentId"],
                "agent": task["assignedAgent"],
                "mode": agent_task_mode(body.get("mode")),
            }
        ]
    agent = valid_agent(task.get("assignedAgent"))
    if not agent and assignments:
        agent = assignments[0]["agent"]
    if not agent and not assignments and not task.get("assignedTeamId"):
        assignments = implicit_group_assignments_for_task(ctx, task)
    if assignments:
        agent = assignments[0]["agent"]
    if not agent and not task.get("assignedTeamId"):
        updated = ctx.task_store.record_dispatch_outcome(
            task_id,
            "rejected",
            code="agent_not_found",
            message="Select a named agent before starting this task.",
        )
        return {
            "task": updated,
            "session": None,
            "dispatch": {
                "state": "rejected",
                "code": "agent_not_found",
                "message": "Select a named agent before starting this task.",
            },
        }
    mode = agent_task_mode(body.get("mode"))
    if task.get("isRoutine"):
        if not (task.get("assignedAgentId") or task.get("assignedTeamId")):
            updated = ctx.task_store.record_dispatch_outcome(
                task_id,
                "rejected",
                code="agent_not_found",
                message="A routine requires a named agent before it can start.",
            )
            return {
                "task": updated,
                "session": None,
                "dispatch": {
                    "state": "rejected",
                    "code": "agent_not_found",
                    "message": "A routine requires a named agent before it can start.",
                },
            }
        result = await start_routine_occurrence_on_ready_node(
            ctx, task, actor, agent=agent, mode=mode, assignments=assignments or None
        )
    else:
        result = await start_task_on_ready_node(
            ctx, task, actor, mode=mode, assignments=assignments or None
        )
    if not result or not result.get("session"):
        return (
            result
            if result
            else {
                "task": task,
                "session": None,
                "dispatch": {"state": "rejected", "code": "invalid_state"},
            }
        )
    return result


@router.post("/tasks/{task_id}/pickups", status_code=201)
async def pickup_task(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    current = get_task_for_actor(ctx.task_store, task_id, actor)
    if current.get("assignedTeamId"):
        raise HTTPException(409, "team_task_requires_team_start")
    agent_id = string_field(body, "agentId") or string_field(body, "assignedAgentId")
    logical_agent = logical_agent_for_assignment(
        ctx,
        actor,
        agent_id,
        expected_employee_id=current.get("assigneeEmployeeId")
        or current.get("ownerEmployeeId")
        or actor["employeeId"],
    )
    if not logical_agent or not agent_id:
        raise HTTPException(400, "agentId is required to pick up a task.")
    agent = logical_agent["executorKind"]
    ctx.task_store.update_task(
        task_id, {"assigneeEmployeeId": logical_agent["supervisorEmployeeId"]}
    )
    task = ctx.task_store.set_task_assignment(task_id, agent, agent_id)
    workspace_path = string_field(body, "workspacePath") or "/workspace"
    thread_ownership = task_thread_ownership(
        task, team_store=ctx.team_store, agent_store=ctx.agent_store
    )
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        task_id=task["id"],
        workspace_path=workspace_path,
        **thread_ownership,
    )
    session = controller.create_session(task_goal_text(task), ["human", agent])
    mode = agent_task_mode(body.get("mode"))
    controller.assign_session(
        session["id"], [{"agentId": agent_id, "agent": agent, "mode": mode}]
    )
    task = ctx.task_store.record_activity(
        task["id"],
        f"{agent} picked up the task.",
        {"agent": agent, "sessionId": session["id"]},
    )
    logger.info(
        "Task picked up",
        task_id=task_id,
        session_id=session["id"],
        agent=agent,
        mode=mode,
    )
    return {"task": task, "session": ctx.session_store.get_session(session["id"])}


@router.get("/tasks/{task_id}/events")
async def task_events(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"events": get_task_for_actor(ctx.task_store, task_id, actor)["events"]}


@router.get("/tasks/{task_id}/artifacts")
async def task_artifacts(
    task_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    """Generated files (documents, decks, spreadsheets, …) produced while working the task.

    Aggregates workspace artifacts across the task's linked sessions and dedupes
    to the newest record per workspace file, so a file regenerated in a later
    session surfaces once at its latest state.
    """
    actor = request_actor(request, ctx.auth_store)
    task = get_task_for_actor(ctx.task_store, task_id, actor)
    newest: dict[str, dict[str, Any]] = {}
    for session_id in task.get("linkedSessionIds", []):
        try:
            session = ctx.session_store.get_session(session_id)
        except (KeyError, FileNotFoundError):
            continue  # A linked session may have been deleted; skip it.
        except Exception:
            logger.warning(
                "Unexpected error reading linked session for artifact aggregation",
                session_id=session_id,
                exc_info=True,
            )
            continue
        for artifact in workspace_artifacts(session):
            key = workspace_artifact_key(session, artifact)
            current = newest.get(key)
            if current is None or (artifact.get("createdAt") or "") >= (
                current.get("createdAt") or ""
            ):
                newest[key] = {
                    **artifact_index_item(session, artifact),
                    "taskId": task_id,
                }
    ordered = sorted(
        newest.values(), key=lambda item: item.get("createdAt") or "", reverse=True
    )
    return {"taskId": task_id, "artifacts": ordered}
