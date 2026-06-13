from __future__ import annotations

import argparse
import os

import uvicorn
from loguru import logger

from .environment import load_backend_env
from .logging_config import setup_logging
from .app import create_app

load_backend_env()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="relay", description="Relay Python backend")
    parser.add_argument("command", nargs="?", default="relay", choices=["relay", "serve"])
    parser.add_argument("--host", default=os.environ.get("BACKEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("BACKEND_PORT", "8790")))
    parser.add_argument("--data-dir", default=os.environ.get("RELAY_DATA_DIR"))
    args = parser.parse_args(argv)
    setup_logging()
    app = create_app(args.data_dir) if args.data_dir else create_app()
    auth_store = app.state.auth_store
    admin_token = os.environ.get("RELAY_ADMIN_TOKEN", "").strip()
    if not auth_store.has_users():
        if admin_token:
            logger.info("No users yet. Use /auth/bootstrap with RELAY_ADMIN_TOKEN to create the first admin.")
        else:
            logger.warning("No users and RELAY_ADMIN_TOKEN is not set. Login will be unavailable until a user is bootstrapped.")
    logger.info("Relay backend listening on http://{}:{}", args.host, args.port)
    logger.info("Relay backend control panel: http://{}:{}/cp", args.host, args.port)
    logger.info("Relay web UI: http://{}:{}/web", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_config=None)
