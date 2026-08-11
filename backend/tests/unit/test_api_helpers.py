from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from relay.api.helpers import assignment_list, json_body


def test_json_body_translates_client_disconnect_to_http_error() -> None:
    async def receive() -> dict[str, str]:
        return {"type": "http.disconnect"}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/daemon-node-registrations",
            "headers": [],
        },
        receive,
    )

    with pytest.raises(HTTPException) as raised:
        asyncio.run(json_body(request))

    assert raised.value.status_code == 400
    assert raised.value.detail == "Client disconnected while reading request body."


def test_assignment_list_preserves_and_bounds_per_assignment_briefs() -> None:
    [assignment] = assignment_list(
        [
            {
                "agent": "codex",
                "brief": f"  {'x' * 4100}  ",
            }
        ]
    )

    assert assignment["brief"] == "x" * 4000
