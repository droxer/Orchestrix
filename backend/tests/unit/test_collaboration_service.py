from relay.collaboration.service import create_round_manifest


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
