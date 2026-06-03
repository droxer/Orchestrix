# Pi requires Node.js >=22.19.0.
FROM node:22.19-bookworm-slim

# Prevent interactive prompts during apt installations
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    bash \
    ca-certificates \
    coreutils \
    curl \
    findutils \
    grep \
    git \
    passwd \
    && rm -rf /var/lib/apt/lists/*

# Install agent CLIs
RUN npm install -g @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent

# UID/GID are aligned to the host workspace owner at runtime (orchestrator boot).
RUN useradd -m -s /bin/bash agent

COPY devbox/claude-settings.json /home/agent/.claude/settings.json
RUN mkdir -p /home/agent/.codex && chown -R agent:agent /home/agent
COPY devbox/codex-config.toml /home/agent/.codex/config.toml
RUN chown agent:agent /home/agent/.codex/config.toml

# Set the default working directory that BoxLite will use
WORKDIR /workspace
