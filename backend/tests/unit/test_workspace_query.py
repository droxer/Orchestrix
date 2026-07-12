import asyncio

from relay.services.workspace_query import WorkspaceQueryBroker


def test_workspace_query_delivers_only_to_its_registered_node():
    async def scenario():
        broker = WorkspaceQueryBroker()
        future = broker.register("cmd_1", "node_a")
        assert broker.resolve("cmd_1", "node_b", {}) is False
        assert broker.resolve("cmd_1", "node_a", {"type": "workspace.listing"}) is True
        assert await future == {"type": "workspace.listing"}
        broker.discard("cmd_1")
        assert broker.resolve("cmd_1", "node_a", {}) is False

    asyncio.run(scenario())
