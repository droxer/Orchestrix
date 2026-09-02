from relay.services.task_workspace import (
    resolve_task_workspace,
    task_workspace_subpath,
)

TASK_CAPABLE_NODE = {"capabilities": ["thread-workspaces", "task-workspaces"]}
OLD_NODE = {"capabilities": ["thread-workspaces"]}


def test_backlog_task_gets_its_own_directory():
    assert task_workspace_subpath({"id": "tsk_one"}) == "tasks/tsk_one"


def test_routine_occurrence_nests_under_its_routine():
    occurrence = {"id": "tsk_run", "sourceRoutineId": "tsk_routine"}
    assert task_workspace_subpath(occurrence) == "tasks/tsk_routine/tsk_run"


def test_blank_source_routine_id_is_treated_as_absent():
    assert task_workspace_subpath({"id": "tsk_one", "sourceRoutineId": ""}) == "tasks/tsk_one"


def test_capable_node_resolves_to_the_task_layout():
    assert resolve_task_workspace({"id": "tsk_one"}, node=TASK_CAPABLE_NODE) == (
        "task",
        "tasks/tsk_one",
    )


def test_project_wins_over_the_task_workspace():
    snapshot = {"projectId": "prj_one", "workspaceSubpath": "projects/prj_one"}
    assert resolve_task_workspace(
        {"id": "tsk_one"}, node=TASK_CAPABLE_NODE, project_snapshot=snapshot
    ) == ("project", "projects/prj_one")


def test_node_without_the_capability_falls_back_to_thread():
    assert resolve_task_workspace({"id": "tsk_one"}, node=OLD_NODE) == ("thread", None)


def test_missing_node_falls_back_to_thread():
    assert resolve_task_workspace({"id": "tsk_one"}, node=None) == ("thread", None)
