from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request

from ..daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend


@dataclass(frozen=True)
class AppContext:
    session_store: Any
    task_store: Any
    daemon_store: Any
    chat_store: Any
    registry: DaemonNodeRegistry
    backend: ServerDaemonNodeBackend
    auth_store: Any
    managed_node_store: Any
    employee_agent_store: Any
    agent_placement_store: Any


def app_context(request: Request) -> AppContext:
    return AppContext(
        session_store=request.app.state.session_store,
        task_store=request.app.state.task_store,
        daemon_store=request.app.state.daemon_store,
        chat_store=request.app.state.chat_store,
        registry=request.app.state.registry,
        backend=request.app.state.backend,
        auth_store=request.app.state.auth_store,
        managed_node_store=request.app.state.managed_node_store,
        employee_agent_store=request.app.state.employee_agent_store,
        agent_placement_store=request.app.state.agent_placement_store,
    )


AppContextDep = Annotated[AppContext, Depends(app_context)]
