# Use a stable Ubuntu base
FROM ubuntu:24.04

# Prevent interactive prompts during apt installations
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    nodejs \
    npm \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install agent CLIs
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# UID/GID are aligned to the host workspace owner at runtime (orchestrator boot).
RUN useradd -m -s /bin/bash agent

COPY devbox/claude-settings.json /home/agent/.claude/settings.json
RUN mkdir -p /home/agent/.codex && chown -R agent:agent /home/agent
COPY devbox/codex-config.toml /home/agent/.codex/config.toml
RUN chown agent:agent /home/agent/.codex/config.toml

# Set the default working directory that BoxLite will use
WORKDIR /workspace