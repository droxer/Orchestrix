from types import SimpleNamespace

from relay.collaboration.models import MessageIntent
from relay.collaboration.service import (
    CollaborationConductor,
    _request_fingerprint,
    _scoped_idempotency_key,
    create_round_manifest,
)


def test_addressed_agent_placement_follows_replacement_runtime_on_same_computer() -> (
    None
):
    placement = {
        "id": "placement_1",
        "agentId": "agent_1",
        "daemonNodeId": "runtime_old",
        "computerId": "device:alice:machine-1",
        "desiredState": "active",
    }
    ctx = SimpleNamespace(
        agent_placement_store=SimpleNamespace(
            list_placements=lambda **_kwargs: [placement]
        ),
        agent_store=SimpleNamespace(
            get_agent=lambda _agent_id: {"displayName": "Builder"}
        ),
    )
    conductor = CollaborationConductor(ctx)

    conductor._assert_addressed_agents_on_node(
        [{"agentId": "agent_1"}],
        [],
        "runtime_new",
        [
            {
                "id": "runtime_new",
                "employeeId": "alice",
                "workspaceId": "machine-1",
            }
        ],
    )


def test_round_manifest_names_its_versioned_protocol_contract() -> None:
    manifest = create_round_manifest(
        source="message",
        purpose="discuss",
        address={"kind": "room"},
        assignments=[
            {
                "assignmentId": "assignment_1",
                "agentId": "agent_1",
                "mode": "ask",
                "phase": "discussion",
            }
        ],
        team_snapshot=None,
        collaboration_id="col_1",
        round_id="round_1",
    )

    assert manifest["contract"] == {
        "name": "relay.collaboration.round",
        "version": 2,
    }
    assert manifest["strategy"] == "room"
    assert manifest["completionPolicy"] == "synthesize"
    assert manifest["workGraph"] == {
        "contract": {
            "name": "relay.collaboration.work-graph",
            "version": 1,
        },
        "items": [
            {
                "workItemId": "assignment_1",
                "assignmentId": "assignment_1",
                "ownerAgentId": "agent_1",
                "delegationAuthority": "conductor",
                "kind": "discussion",
                "objective": "Contribute to the team's discussion.",
                "dependsOnWorkItemIds": [],
                "required": True,
            }
        ],
        "completion": {
            "kind": "synthesize",
            "resultOwnerWorkItemId": "assignment_1",
        },
        "delegationPolicy": {
            "authority": "conductor",
            "policy": "sequential-role-delegation-v1",
        },
    }


def test_round_manifest_makes_delegated_subtasks_and_review_dependencies_explicit() -> (
    None
):
    manifest = create_round_manifest(
        source="task",
        purpose="accomplish",
        address={"kind": "room"},
        assignments=[
            {
                "assignmentId": "coordinate",
                "agentId": "lead",
                "mode": "action",
                "phase": "execution",
                "coordinator": True,
                "brief": "Coordinate the delivery.",
            },
            {
                "assignmentId": "implement",
                "agentId": "builder",
                "mode": "action",
                "phase": "execution",
                "role": "implementer",
                "brief": "Implement the change.",
            },
            {
                "assignmentId": "review",
                "agentId": "reviewer",
                "mode": "review",
                "phase": "review",
                "role": "reviewer",
                "brief": "Review the completed change.",
            },
        ],
        team_snapshot={
            "teamId": "team_1",
            "teamRevision": "revision_1",
            "memberAgentIds": ["lead", "builder", "reviewer"],
            "leadAgentId": "lead",
        },
        collaboration_id="col_1",
        round_id="round_1",
    )

    assert manifest["workGraph"]["items"] == [
        {
            "workItemId": "coordinate",
            "assignmentId": "coordinate",
            "ownerAgentId": "lead",
            "delegationAuthority": "conductor",
            "kind": "coordination",
            "objective": "Coordinate the delivery.",
            "dependsOnWorkItemIds": [],
            "required": True,
        },
        {
            "workItemId": "implement",
            "assignmentId": "implement",
            "ownerAgentId": "builder",
            "delegationAuthority": "conductor",
            "kind": "implementation",
            "objective": (
                "Implement the change. Own delegated work item 2 of 3; "
                "use predecessor results and do not duplicate another item."
            ),
            "dependsOnWorkItemIds": ["coordinate"],
            "required": True,
        },
        {
            "workItemId": "review",
            "assignmentId": "review",
            "ownerAgentId": "reviewer",
            "delegationAuthority": "conductor",
            "kind": "review",
            "objective": (
                "Review the completed change. Own delegated work item 3 of 3; "
                "use predecessor results and do not duplicate another item."
            ),
            "dependsOnWorkItemIds": ["coordinate", "implement"],
            "required": True,
        },
    ]
    assert manifest["workGraph"]["completion"] == {
        "kind": "all_required",
        "resultOwnerWorkItemId": "review",
    }


def test_work_graph_keeps_legacy_executor_only_assignments_compatible() -> None:
    manifest = create_round_manifest(
        source="legacy",
        purpose="accomplish",
        address={"kind": "members", "agentIds": []},
        assignments=[
            {
                "assignmentId": "legacy_assignment",
                "agent": "codex",
                "executorKind": "codex",
                "mode": "action",
            }
        ],
        team_snapshot=None,
    )

    assert manifest["workGraph"]["items"][0]["ownerAgentId"] == (
        "legacy-executor:codex"
    )


def test_addressed_lead_discussion_remains_a_discussion_work_item() -> None:
    manifest = create_round_manifest(
        source="message",
        purpose="discuss",
        address={"kind": "members", "agentIds": ["lead"]},
        assignments=[
            {
                "assignmentId": "lead_discussion",
                "agentId": "lead",
                "mode": "ask",
                "phase": "discussion",
                "coordinator": True,
            }
        ],
        team_snapshot={
            "teamId": "team_1",
            "memberAgentIds": ["lead"],
            "leadAgentId": "lead",
        },
    )

    assert manifest["workGraph"]["items"][0]["kind"] == "discussion"


def test_independent_discussion_scope_does_not_claim_predecessors() -> None:
    manifest = create_round_manifest(
        source="message",
        purpose="discuss",
        address={"kind": "room"},
        assignments=[
            {
                "assignmentId": "opinion_1",
                "agentId": "agent_1",
                "mode": "ask",
            },
            {
                "assignmentId": "opinion_2",
                "agentId": "agent_2",
                "mode": "ask",
            },
        ],
        team_snapshot=None,
    )

    second = manifest["workGraph"]["items"][1]
    assert second["dependsOnWorkItemIds"] == []
    assert "independently eligible" in second["objective"]
    assert "predecessor results" not in second["objective"]


def test_assignment_phase_is_derived_instead_of_trusting_legacy_input() -> None:
    [assignment] = CollaborationConductor._compile_assignments(
        [
            {
                "agentId": "lead",
                "mode": "action",
                "role": "reviewer",
                "phase": "review",
            }
        ],
        "team_1",
        {"lead"},
        {
            "teamId": "team_1",
            "memberAgentIds": ["lead"],
            "leadAgentId": "lead",
        },
    )

    assert assignment["phase"] == "execution"


def test_message_id_is_the_default_idempotency_key() -> None:
    prepared = CollaborationConductor._prepare(
        MessageIntent(
            thread_id="thread_1",
            text="continue",
            user_message_id="message_1",
        )
    )

    assert prepared.idempotency_key == "message_1"


def test_idempotency_scope_separates_actors_and_threads() -> None:
    assert _scoped_idempotency_key("alice", "thread_1", "retry_1") != (
        _scoped_idempotency_key("bob", "thread_1", "retry_1")
    )
    assert _scoped_idempotency_key("alice", "thread_1", "retry_1") != (
        _scoped_idempotency_key("alice", "thread_2", "retry_1")
    )


def test_request_fingerprint_rejects_reusing_a_key_for_different_intent() -> None:
    first = CollaborationConductor._prepare(
        MessageIntent(
            thread_id="thread_1",
            text="first request",
            idempotency_key="retry_1",
        )
    )
    second = CollaborationConductor._prepare(
        MessageIntent(
            thread_id="thread_1",
            text="different request",
            idempotency_key="retry_1",
        )
    )

    assert _request_fingerprint(first) != _request_fingerprint(second)
