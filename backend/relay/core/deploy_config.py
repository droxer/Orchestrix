"""Configuration seams for running the backend behind a managed platform.

Relay's default posture is single-origin: the backend serves both the JSON API
and the exported web UI, so browser sessions are same-origin and the session
cookie needs no special handling. A split deployment (web UI on Vercel, backend
on Railway) breaks that assumption in three places, and each one is read from
the environment here rather than scattered across route modules:

* the browser origin is no longer the backend origin, so cross-origin requests
  need CORS with credentials;
* a cross-site cookie needs ``SameSite=None; Secure``, while a sibling-subdomain
  cookie stays ``Lax`` and only needs a ``Domain``;
* TLS terminates at the platform edge, so the app sees ``http`` and must be told
  the public scheme is ``https`` before it marks cookies ``Secure``.

Every setting defaults to the single-origin behavior, so a self-hosted install
that sets none of these keeps working exactly as before.
"""

from __future__ import annotations

import os
import re

SameSite = str

_VALID_SAMESITE = ("lax", "strict", "none")


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _flag(name: str, *, default: bool = False) -> bool:
    value = _env(name).lower()
    if not value:
        return default
    return value not in ("0", "false", "no", "off")


def cors_allow_origins() -> list[str]:
    """Exact browser origins allowed to call the API with credentials.

    Comma-separated. ``*`` is rejected: credentialed CORS forbids a wildcard
    origin, and silently dropping credentials would break login in a way that
    only shows up in the browser.
    """
    raw = _env("RELAY_CORS_ALLOW_ORIGINS")
    if not raw:
        return []
    origins = [origin.strip().rstrip("/") for origin in raw.split(",")]
    origins = [origin for origin in origins if origin]
    if "*" in origins:
        raise RuntimeError(
            "RELAY_CORS_ALLOW_ORIGINS cannot be '*': credentialed requests "
            "require exact origins. List each origin, or use "
            "RELAY_CORS_ALLOW_ORIGIN_REGEX for preview deployments."
        )
    return origins


def cors_allow_origin_regex() -> str | None:
    """Origin pattern for ephemeral preview deployments (Vercel preview URLs).

    Anchored on both ends so a pattern like ``https://relay-.*\\.vercel\\.app``
    cannot be satisfied by a suffix match from an attacker-controlled host.
    """
    pattern = _env("RELAY_CORS_ALLOW_ORIGIN_REGEX")
    if not pattern:
        return None
    try:
        re.compile(pattern)
    except re.error as error:
        raise RuntimeError(
            f"RELAY_CORS_ALLOW_ORIGIN_REGEX is not a valid regular expression: {error}"
        ) from error
    return f"^(?:{pattern})$"


def cors_enabled() -> bool:
    return bool(cors_allow_origins() or cors_allow_origin_regex())


def session_cookie_domain() -> str | None:
    """Cookie ``Domain``, e.g. ``.example.com`` to share across subdomains.

    Unset means a host-only cookie, which is what a single-origin install wants.
    """
    return _env("RELAY_SESSION_COOKIE_DOMAIN") or None


def session_cookie_samesite() -> SameSite:
    value = _env("RELAY_SESSION_COOKIE_SAMESITE").lower() or "lax"
    if value not in _VALID_SAMESITE:
        raise RuntimeError(
            "RELAY_SESSION_COOKIE_SAMESITE must be one of: lax, strict, none."
        )
    return value


def force_secure_cookies() -> bool:
    """Mark session cookies ``Secure`` regardless of the request scheme.

    Uvicorn's ``--proxy-headers`` already recovers ``https`` from
    ``X-Forwarded-Proto`` on platforms that send it. This is the explicit
    override for the rest, and it is implied by ``SameSite=None`` because
    browsers reject a cross-site cookie that is not ``Secure``.
    """
    return _flag("RELAY_FORCE_SECURE_COOKIES") or session_cookie_samesite() == "none"


def cookie_is_secure(request_scheme: str) -> bool:
    return force_secure_cookies() or request_scheme == "https"


def bind_host(default: str = "127.0.0.1") -> str:
    """Interface to listen on.

    Container platforms route to the container's published port, so the server
    must bind every interface there — ``HOST`` is the conventional name for
    that. The default stays loopback so a local ``make backend`` is not exposed
    to the network.
    """
    return _env("BACKEND_HOST") or _env("HOST") or default


def bind_port(default: int = 8790) -> int:
    """Port to listen on.

    ``PORT`` is injected by Railway (and most PaaS providers) and wins over the
    Relay-specific name only when the Relay-specific name is absent.
    """
    for name in ("BACKEND_PORT", "PORT"):
        value = _env(name)
        if value:
            try:
                return int(value)
            except ValueError as error:
                raise RuntimeError(f"{name} must be an integer, got {value!r}.") from error
    return default


def trust_proxy_headers() -> bool:
    """Honor ``X-Forwarded-Proto``/``X-Forwarded-For`` from the platform edge.

    Enabled by default: Relay is deployed behind a load balancer far more often
    than it is exposed directly, and without it every request looks like plain
    ``http`` from ``127.0.0.1``. Set ``RELAY_TRUST_PROXY_HEADERS=0`` when the
    server is directly reachable, where a client could forge these headers.
    """
    return _flag("RELAY_TRUST_PROXY_HEADERS", default=True)
