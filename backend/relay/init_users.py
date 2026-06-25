from __future__ import annotations

import argparse
import os
import sys

from .core.environment import load_backend_env
from .persistence.stores import DEFAULT_RELAY_DATA_DIR
from .security.auth import auth_store_from_env


def main(argv: list[str] | None = None) -> int:
    load_backend_env()
    parser = argparse.ArgumentParser(prog="python -m relay.init_users", description="Create an initial Relay user.")
    parser.add_argument("--data-dir", default=os.environ.get("RELAY_DATA_DIR") or str(DEFAULT_RELAY_DATA_DIR))
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="admin")
    parser.add_argument("--role", choices=["admin", "user"], default="admin")
    parser.add_argument("--email", default=None)
    parser.add_argument("--employee-id", default=None)
    parser.add_argument("--department-id", default="administration")
    parser.add_argument("--department-name", default="Administration")
    parser.add_argument("--only-if-empty", action="store_true", help="Skip creation when any user already exists.")
    args = parser.parse_args(argv)

    store = auth_store_from_env(args.data_dir)
    if args.only_if_empty and store.has_users():
        print("Users already exist; skipped.")
        return 0

    try:
        user = store.create_user(
            args.username,
            args.password,
            role=args.role,
            email=args.email,
            employee_id=args.employee_id or args.username,
            department_id=args.department_id,
            department_name=args.department_name,
        )
    except ValueError as error:
        print(f"Failed to create user: {error}", file=sys.stderr)
        return 1

    print(f"Created {user['role']} user {user['username']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
