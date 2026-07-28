from __future__ import annotations

import argparse
import json
import os

import uvicorn
from loguru import logger

from .app import create_app
from .core.environment import load_backend_env
from .core.logging_config import setup_logging
from .core.storage_config import database_url_from_env
from .persistence.session_import import migrate_local_sessions
from .persistence.session_store import DatabaseSessionStore

load_backend_env()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="relay", description="Relay Python backend")
    parser.add_argument(
        "command",
        nargs="?",
        default="relay",
        choices=["relay", "serve", "migrate-local-sessions"],
    )
    parser.add_argument("--host", default=os.environ.get("BACKEND_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("BACKEND_PORT", "8790"))
    )
    parser.add_argument("--data-dir", default=os.environ.get("RELAY_DATA_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    setup_logging()
    if args.command == "migrate-local-sessions":
        if not args.data_dir:
            parser.error("migrate-local-sessions requires --data-dir")
        store = DatabaseSessionStore(
            database_url_from_env(setting="migrate-local-sessions")
        )
        store.verify_schema()
        report = migrate_local_sessions(args.data_dir, store, dry_run=args.dry_run)
        print(json.dumps(report, indent=2))
        if report["failures"]:
            raise SystemExit(1)
        return
    app = create_app(args.data_dir) if args.data_dir else create_app()
    auth_store = app.state.auth_store
    admin_token = os.environ.get("RELAY_ADMIN_TOKEN", "").strip()
    if not auth_store.has_users():
        if admin_token:
            logger.info(
                "No users yet. Use /api/v1/auth/bootstrap with RELAY_ADMIN_TOKEN to create the first admin."
            )
        else:
            logger.warning(
                "No users and RELAY_ADMIN_TOKEN is not set. Login will be unavailable until a user is bootstrapped."
            )
    logger.info("Relay backend listening on http://{}:{}", args.host, args.port)
    logger.info("Relay backend control panel: http://{}:{}/admin", args.host, args.port)
    logger.info("Relay web UI: http://{}:{}/", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_config=None)
