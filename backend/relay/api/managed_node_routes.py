from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from ..security.auth import require_admin_session
from ..services.node_agents import remove_node_agents
from .deps import AppContextDep
from .helpers import json_body

router = APIRouter()


def _admin_error(error: Exception) -> HTTPException:
    if isinstance(error, KeyError):
        return HTTPException(404, "Managed node or provisioning attempt not found.")
    if isinstance(error, ValueError):
        return HTTPException(409, str(error))
    return HTTPException(500, "Managed-node operation failed.")


@router.post("/cp/managed-nodes", status_code=202)
async def create_managed_node(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        return {"node": ctx.managed_node_store.create_node(await json_body(request))}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.get("/cp/managed-nodes")
async def list_managed_nodes(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    # Deleting resources remain visible to the reconciler until provider
    # cleanup has converged.
    return {"nodes": ctx.managed_node_store.list_nodes(include_deleted=True)}


@router.get("/cp/managed-nodes/{node_id}")
async def get_managed_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    node = ctx.managed_node_store.get_node(node_id)
    if not node:
        raise HTTPException(404, "Managed node not found.")
    return {"node": node}


@router.patch("/cp/managed-nodes/{node_id}")
async def update_managed_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        patch = await json_body(request)
        node = ctx.managed_node_store.update_node(node_id, patch)
        if patch.get("desiredState") in ("stopped", "deleted"):
            _fence_active_runtime(ctx, node)
        return {"node": node}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.delete("/cp/managed-nodes/{node_id}", status_code=202)
async def delete_managed_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        node = ctx.managed_node_store.update_node(
            node_id, {"desiredState": "deleted"}
        )
        _fence_active_runtime(ctx, node)
        daemon_node_id = node.get("activeDaemonNodeId")
        removed_agents = remove_node_agents(ctx, daemon_node_id) if daemon_node_id else []
        return {"node": node, "removedAgents": removed_agents}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.get("/cp/managed-nodes/{node_id}/attempts")
async def list_managed_node_attempts(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    if not ctx.managed_node_store.get_node(node_id):
        raise HTTPException(404, "Managed node not found.")
    return {"attempts": ctx.managed_node_store.list_attempts(node_id)}


@router.post("/cp/managed-nodes/{node_id}/attempts", status_code=201)
async def create_managed_node_attempt(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        attempt, enrollment_credential = ctx.managed_node_store.create_attempt(node_id)
        return {"attempt": attempt, "enrollmentCredential": enrollment_credential}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.patch("/cp/managed-nodes/{node_id}/attempts/{attempt_id}")
async def update_managed_node_attempt(node_id: str, attempt_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        attempt = ctx.managed_node_store.update_attempt(attempt_id, await json_body(request))
        if attempt["managedNodeId"] != node_id:
            raise KeyError(attempt_id)
        return {"attempt": attempt}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.post("/cp/managed-nodes/{node_id}/retry", status_code=201)
async def retry_managed_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        active = ctx.managed_node_store.active_attempt(node_id)
        if active:
            ctx.managed_node_store.update_attempt(active["id"], {"status": "cancelled", "errorCode": "admin_retry"})
        attempt, enrollment_credential = ctx.managed_node_store.create_attempt(node_id)
        return {"attempt": attempt, "enrollmentCredential": enrollment_credential}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.post("/cp/managed-nodes/{node_id}/drain", status_code=202)
async def drain_managed_node(node_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    require_admin_session(request, ctx.auth_store)
    try:
        node = ctx.managed_node_store.update_node(node_id, {"desiredState": "stopped"})
        _fence_active_runtime(ctx, node)
        return {"node": node}
    except (KeyError, ValueError) as error:
        raise _admin_error(error) from error


@router.delete("/cp/managed-nodes/{node_id}/runtime", status_code=204)
async def retire_managed_node_runtime(
    node_id: str, request: Request, ctx: AppContextDep
) -> Response:
    require_admin_session(request, ctx.auth_store)
    node = ctx.managed_node_store.get_node(node_id)
    if not node:
        raise HTTPException(404, "Managed node not found.")
    daemon_node_id = node.get("activeDaemonNodeId")
    if daemon_node_id and ctx.registry.get(daemon_node_id):
        try:
            ctx.registry.delete(daemon_node_id)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
    return Response(status_code=204)


def _fence_active_runtime(ctx: Any, node: dict[str, Any]) -> None:
    daemon_node_id = node.get("activeDaemonNodeId")
    if daemon_node_id and ctx.registry.get(daemon_node_id):
        ctx.registry.fence_managed_node(daemon_node_id)


@router.post("/daemon-enroll", status_code=201)
async def enroll_managed_daemon(request: Request, ctx: AppContextDep) -> dict[str, Any]:
    authorization = request.headers.get("authorization") or ""
    scheme, _, credential = authorization.partition(" ")
    if scheme.lower() != "enrollment" or not credential:
        raise HTTPException(401, "Enrollment credential is required.")
    body = await json_body(request)
    try:
        managed_node, attempt = ctx.managed_node_store.consume_enrollment_grant(credential)
        daemon_node, runtime_token = ctx.registry.enroll_managed_node(managed_node, attempt, body)
        ctx.managed_node_store.complete_enrollment(managed_node["id"], attempt["id"], daemon_node["id"])
        return {
            "sandboxId": daemon_node["id"],
            "token": runtime_token,
            **({"employeeId": daemon_node["employeeId"]} if daemon_node.get("employeeId") else {}),
            "sandboxMode": daemon_node.get("sandboxMode") or "boxlite",
        }
    except PermissionError as error:
        raise HTTPException(401, str(error)) from error
    except (KeyError, ValueError) as error:
        raise HTTPException(409, str(error)) from error
