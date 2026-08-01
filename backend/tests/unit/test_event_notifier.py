from __future__ import annotations

import asyncio

from relay.services.event_notifier import KeyedEventNotifier


def test_keyed_event_notifier_wakes_only_matching_waiters() -> None:
    async def scenario() -> None:
        notifier = KeyedEventNotifier()
        session_version = notifier.version("session:one")
        other_version = notifier.version("session:two")

        session_waiter = asyncio.create_task(
            notifier.wait("session:one", session_version, timeout=0.2)
        )
        other_waiter = asyncio.create_task(
            notifier.wait("session:two", other_version, timeout=0.02)
        )
        await asyncio.sleep(0)

        notifier.publish("session:one")

        assert await session_waiter is True
        assert await other_waiter is False

    asyncio.run(scenario())


def test_keyed_event_notifier_closes_waiters_without_leaking() -> None:
    async def scenario() -> None:
        notifier = KeyedEventNotifier()
        waiter = asyncio.create_task(
            notifier.wait("node:one", notifier.version("node:one"), timeout=10)
        )
        await asyncio.sleep(0)

        notifier.close()

        assert await waiter is False
        assert notifier.waiter_count == 0

    asyncio.run(scenario())
