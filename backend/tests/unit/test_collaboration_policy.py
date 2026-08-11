from __future__ import annotations

from relay.collaboration.policy import (
    REPAIR_NOTE_STATE_KEY,
    REPAIR_RESUME_INDEX_STATE_KEY,
    advance_after_success,
    assignment_reports_round_result,
    decide_failure,
    validate_round_result,
)


def _request(**overrides):
    return {
        "taskId": "task_1",
        "currentIndex": 1,
        "assignments": [
            {"assignmentId": "a1", "mode": "action", "coordinator": True},
            {"assignmentId": "a2", "mode": "action"},
        ],
        "state": {},
        **overrides,
    }


def test_action_failure_requests_one_explicit_coordinator_repair() -> None:
    decision = decide_failure(
        _request(),
        {},
        outcome="Builder action failed.",
        agent_label="Builder",
        mode="action",
        max_repairs=1,
    )

    assert decision.kind == "repair"
    assert decision.next_index == 0
    assert decision.state[REPAIR_RESUME_INDEX_STATE_KEY] == 1
    assert "Builder" in decision.state[REPAIR_NOTE_STATE_KEY]


def test_taskless_failure_never_invents_coordinator_authority() -> None:
    decision = decide_failure(
        _request(taskId=None),
        {},
        outcome="Builder action failed.",
        agent_label="Builder",
        mode="action",
        max_repairs=1,
    )

    assert decision.kind == "fail"


def test_discussion_failure_keeps_collecting_participants() -> None:
    request = _request(
        currentIndex=0,
        assignments=[
            {"assignmentId": "a1", "mode": "ask"},
            {"assignmentId": "a2", "mode": "ask"},
        ],
    )
    decision = decide_failure(
        request,
        {},
        outcome="Researcher ask failed.",
        agent_label="Researcher",
        mode="ask",
        max_repairs=1,
    )

    assert decision.kind == "continue"
    assert decision.next_index == 1
    assert decision.state["_relay_participant_failures"][0]["assignmentId"] == "a1"


def test_successful_repair_resumes_the_failed_assignment() -> None:
    next_index, state = advance_after_success(
        _request(currentIndex=0),
        {
            REPAIR_RESUME_INDEX_STATE_KEY: 1,
            REPAIR_NOTE_STATE_KEY: "repair it",
        },
    )

    assert next_index == 1
    assert REPAIR_RESUME_INDEX_STATE_KEY not in state
    assert REPAIR_NOTE_STATE_KEY not in state


def test_only_the_last_writable_assignment_reports_the_round_result() -> None:
    assignments = [
        {"mode": "action"},
        {"mode": "ask"},
        {"mode": "review"},
    ]

    assert assignment_reports_round_result(assignments, 0) is False
    assert assignment_reports_round_result(assignments, 1) is False
    assert assignment_reports_round_result(assignments, 2) is True


def test_explicit_review_synthesizer_owns_the_round_result() -> None:
    assignments = [
        {"assignmentId": "reviewer", "mode": "review"},
        {"assignmentId": "lead", "mode": "review", "synthesizer": True},
    ]

    assert assignment_reports_round_result(assignments, 0) is False
    assert assignment_reports_round_result(assignments, 1) is True


def test_round_result_adapter_rejects_unknown_status_and_caps_notes() -> None:
    assert validate_round_result({"roundResult": {"status": "maybe"}}) is None
    assert validate_round_result(
        {"roundResult": {"status": "continue", "note": " x "}}
    ) == {"status": "continue", "note": "x"}
