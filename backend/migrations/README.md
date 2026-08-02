# Backend Migrations

This is the canonical guide for Relay's Alembic migrations and legacy session
import. Migration files live in this directory.

## Apply migrations

Set `RELAY_DATABASE_URL` in `backend/.env`, then run:

```bash
make backend-migrate
```

Override the database URL for one run when needed:

```bash
make backend-migrate DATABASE_URL=postgresql+psycopg://relay:relay@localhost:5432/relay
```

To invoke Alembic directly:

```bash
RELAY_DATABASE_URL=postgresql+psycopg://relay:relay@localhost:5432/relay \
  UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev \
  alembic -c backend/alembic.ini upgrade head
```

`RELAY_DATABASE_URL` takes precedence over `DATABASE_URL`; both override the
placeholder URL in `backend/alembic.ini`. Shell values take precedence over
`backend/.env`.

Sessions, session events, retained artifact content, token usage, tasks, task
events, and thread-task links always require the database. Set
`RELAY_STORAGE=postgres` to store the remaining operational records there too.
The legacy `RELAY_AUTH_STORE=database` and `RELAY_DAEMON_STORE=database`
switches remain available for targeted compatibility.

## Import legacy session files

Stop the backend and back up PostgreSQL and `.relay`. Validate the legacy event
logs before writing rows:

```bash
RELAY_DATABASE_URL=postgresql+psycopg://relay:relay@localhost:5432/relay \
  uv run --project backend relay migrate-local-sessions \
  --data-dir .relay --dry-run
```

Remove `--dry-run` to import. The command is idempotent when the database has
the same ordered event history and fails on divergent session IDs. It never
edits or deletes the source directory; keep that directory read-only through
the rollback window.
