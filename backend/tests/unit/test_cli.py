from __future__ import annotations

from types import SimpleNamespace

from relay import cli


def test_cli_never_logs_bootstrap_token_and_uses_trusted_proxy_list(
    monkeypatch, tmp_path
) -> None:
    secret = "bootstrap-secret-that-must-not-be-logged"
    messages: list[str] = []
    uvicorn_options: dict[str, object] = {}
    app = SimpleNamespace(
        state=SimpleNamespace(auth_store=SimpleNamespace(has_users=lambda: False))
    )

    monkeypatch.setenv("RELAY_ADMIN_TOKEN", secret)
    monkeypatch.setenv("RELAY_TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("RELAY_FORWARDED_ALLOW_IPS", "10.0.0.0/8")
    monkeypatch.setattr(cli, "create_app", lambda _root: app)
    monkeypatch.setattr(cli, "setup_logging", lambda: None)
    monkeypatch.setattr(
        cli.logger,
        "info",
        lambda message, *args, **kwargs: messages.append(message.format(*args)),
    )
    monkeypatch.setattr(
        cli.uvicorn,
        "run",
        lambda _app, **kwargs: uvicorn_options.update(kwargs),
    )

    cli.main(["serve", "--data-dir", str(tmp_path)])

    assert secret not in "\n".join(messages)
    assert uvicorn_options["proxy_headers"] is True
    assert uvicorn_options["forwarded_allow_ips"] == "10.0.0.0/8"
