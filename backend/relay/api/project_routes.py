from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..persistence.project_store import (
    ProjectValidationError,
    ProjectVersionConflict,
)
from ..services.project_catalog import create_project_payload, update_project_payload
from .deps import AppContextDep
from .helpers import json_body, request_actor
from .project_helpers import project_for_owner

router = APIRouter()


def _project_error(error: Exception) -> HTTPException:
    if isinstance(error, ProjectVersionConflict):
        return HTTPException(409, "project_version_conflict")
    code = error.code if isinstance(error, ProjectValidationError) else str(error)
    return HTTPException(409 if code == "project_name_taken" else 400, code)


@router.get("/projects")
async def list_projects(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {
        "projects": ctx.project_store.list_projects(
            actor["employeeId"], include_archived=True
        )
    }


@router.post("/projects", status_code=201)
async def create_project(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    body = await json_body(request)
    try:
        payload = create_project_payload(
            actor["employeeId"],
            body,
            registry=ctx.registry,
            agent_store=ctx.agent_store,
            placement_store=ctx.agent_placement_store,
        )
        project = ctx.project_store.create_project(actor["employeeId"], payload)
    except (ProjectValidationError, ProjectVersionConflict, ValueError) as error:
        raise _project_error(error) from error
    return {"project": project}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    return {"project": project_for_owner(ctx, project_id, actor["employeeId"])}


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    current = project_for_owner(ctx, project_id, actor["employeeId"])
    body = await json_body(request)
    try:
        patch, expected_version = update_project_payload(
            actor["employeeId"],
            current,
            body,
            agent_store=ctx.agent_store,
            placement_store=ctx.agent_placement_store,
        )
        project = ctx.project_store.update_project(
            project_id, patch, expected_version=expected_version
        )
    except KeyError as error:
        raise HTTPException(404, "Project not found.") from error
    except (ProjectValidationError, ProjectVersionConflict, ValueError) as error:
        raise _project_error(error) from error
    return {"project": project}


@router.delete("/projects/{project_id}")
async def archive_project(
    project_id: str, request: Request, ctx: AppContextDep
) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    project_for_owner(ctx, project_id, actor["employeeId"])
    raw_version = request.query_params.get("expectedVersion")
    try:
        expected_version = int(raw_version) if raw_version is not None else None
    except ValueError:
        expected_version = None
    if expected_version is None:
        raise HTTPException(400, "project_expected_version_required")
    try:
        project = ctx.project_store.archive_project(
            project_id, expected_version=expected_version
        )
    except KeyError as error:
        raise HTTPException(404, "Project not found.") from error
    except (ProjectValidationError, ProjectVersionConflict, ValueError) as error:
        raise _project_error(error) from error
    return {"project": project}
