from relay.collaboration.models import MessageIntent
from relay.collaboration.service import (
    CollaborationConductor,
    _request_fingerprint,
    _scoped_idempotency_key,
    create_round_manifest,
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
        "version": 1,
    }
    assert manifest["strategy"] == "room"
    assert manifest["completionPolicy"] == "synthesize"


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
