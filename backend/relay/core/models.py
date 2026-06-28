from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


AgentName = Literal["claude", "pi", "codex", "kimi"]
AgentTaskMode = Literal["action", "review", "ask"]
AgentRole = Literal["implementer", "reviewer", "planner", "tester", "fixer"]
SessionStatus = Literal["running", "waiting_for_human", "completed", "failed", "cancelled"]
TaskPriority = Literal["low", "normal", "high"]
TaskStatus = Literal["backlog", "assigned", "running", "waiting_for_human", "review", "done", "blocked"]
TaskRoutineType = Literal["task", "job"]
TaskRoutineCadence = Literal["daily", "weekly", "monthly", "custom"]
SandboxStatus = Literal["provisioning", "ready", "running", "stopped", "failed"]
RunStatus = Literal["running", "completed", "failed", "cancelled"]
CommandStatus = Literal["queued", "dispatched", "completed", "failed", "cancelled"]

AGENT_NAMES: tuple[str, ...] = ("claude", "pi", "codex", "kimi")
AGENT_ROLES: tuple[str, ...] = ("implementer", "reviewer", "planner", "tester", "fixer")
DAEMON_NODE_PROTOCOL_VERSION = 1
DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS = (1,)


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class RelayModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="allow",
        populate_by_name=True,
        validate_by_alias=True,
        validate_by_name=True,
    )

    def relay_dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


class Assignment(RelayModel):
    agent: AgentName
    mode: AgentTaskMode = "action"
    role: AgentRole | None = None


class SandboxRunRequest(RelayModel):
    task_goal: str
    assignments: list[Assignment]
    session_id: str | None = None
    decision: dict[str, Any] | None = None


class DaemonNodeRegistration(RelayModel):
    sandbox_id: str
    employee_id: str | None = None
    token: str
    workspace_path: str | None = None
    protocol_version: int
    supported_agents: list[AgentName] = []
    agent_health: dict[str, dict[str, Any]] | None = None
    max_concurrent_runs: int | None = None
    run_capacity_by_mode: dict[AgentTaskMode, int] | None = None
    status: Literal["ready", "busy", "stopped"] = "ready"


class DaemonNodeRunCommand(RelayModel):
    id: str
    type: Literal["run.start"]
    session_id: str
    run_id: str
    task_goal: str
    agent: AgentName
    mode: AgentTaskMode
    workspace_path: str | None = None
    state: dict[str, Any] | None = None


class DaemonNodeCancelCommand(RelayModel):
    id: str
    type: Literal["run.cancel"]
    command_id: str
    session_id: str
    run_id: str
    agent: AgentName
    mode: AgentTaskMode
    reason: str


DaemonNodeCommand = DaemonNodeRunCommand | DaemonNodeCancelCommand
