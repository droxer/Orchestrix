from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from ..daemon_registry import DaemonNodeRegistry, ServerDaemonNodeBackend
from ..persistence.protocols import (
    AgentPlacementStore,
    AgentStore,
    AuthStore,
    ChatStore,
    DaemonStore,
    ManagedNodeStore,
    ProfileImageStore,
    SessionStore,
    TaskStore,
    TeamStore,
)
from ..services.workspace_query import WorkspaceQueryBroker


@dataclass(frozen=True)
class AppContext:
    session_store: SessionStore
    task_store: TaskStore
    daemon_store: DaemonStore
    chat_store: ChatStore
    registry: DaemonNodeRegistry
    backend: ServerDaemonNodeBackend
    auth_store: AuthStore
    managed_node_store: ManagedNodeStore
    agent_store: AgentStore
    team_store: TeamStore
    agent_placement_store: AgentPlacementStore
    profile_image_store: ProfileImageStore
    workspace_query_broker: WorkspaceQueryBroker


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
        agent_store=request.app.state.agent_store,
        team_store=request.app.state.team_store,
        agent_placement_store=request.app.state.agent_placement_store,
        profile_image_store=request.app.state.profile_image_store,
        workspace_query_broker=request.app.state.workspace_query_broker,
    )


AppContextDep = Annotated[AppContext, Depends(app_context)]
