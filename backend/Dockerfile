# Relay control plane image (Railway, or any container host).
#
# This builds the backend only. It deliberately contains no agent CLIs and no
# BoxLite: the backend never executes agents — it queues work for daemons, which
# run on machines that own a sandbox. See docs/deployment.md.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/relay-venv \
    PATH="/opt/relay-venv/bin:$PATH"

WORKDIR /app

# Resolve dependencies before copying sources so a code-only change reuses the
# cached dependency layer. `--extra dev` is included because Alembic (used by
# the release migration step) is a dev dependency.
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project backend --extra dev --frozen --no-install-project

COPY backend/ ./backend/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project backend --extra dev --frozen

# Bind every interface: the platform routes to the container's published port,
# which arrives as $PORT and is read by relay.core.deploy_config.
ENV HOST=0.0.0.0 \
    RELAY_STORAGE=postgres \
    RELAY_AUTH_STORE=database \
    RELAY_DAEMON_STORE=database \
    RELAY_CHAT_STORE=database \
    RELAY_DATA_DIR=/data

# Operational state that is not in Postgres (profile images, managed-node
# records) lives here. Mount a volume at /data to keep it across deploys.
RUN mkdir -p /data

EXPOSE 8790

CMD ["relay"]
