# Backend Migrations

Alembic migrations for the Python backend storage live here.

Set `RELAY_DATABASE_URL` in `backend/.env` before running migrations:

```bash
make backend-migrate
```

You can also override the database URL for one run:

```bash
make backend-migrate DATABASE_URL=postgresql+psycopg://relay:relay@localhost:5432/relay
```
