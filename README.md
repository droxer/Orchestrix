# Orchestrix: Multi-Agent Collaboration Platform

A lightweight, local-first orchestration platform that coordinates multiple autonomous AI agents (like Claude Code, Pi, and custom OpenAI agents) to collaborate on complex software engineering tasks.

Instead of managing context windows and parsing text, **Orchestrix** uses **LangGraph** to manage the state machine and **BoxLite** to provide a persistent, hardware-isolated micro-VM. Agents communicate not by passing code back and forth, but by reading and writing to a shared file system in real-time.

---

## 🎯 Features

*   **True "Bring Your Own Agent" (BYOA):** Orchestrates fully autonomous CLI agents (like Anthropic's `@claude-code`, Pi, and Codex) and custom Python agents natively.
*   **Shared Reality:** All agents operate inside a single, persistent BoxLite micro-VM. If Claude installs a package, Pi and Codex can immediately use it to run tests.
*   **Zero-Sync Workspace:** Mounts your local project directory directly into the VM. The guest `agent` user is aligned to your host UID/GID so files created in the VM are owned by your macOS/Linux user and open normally in your IDE.
*   **Deterministic Routing:** Uses LangGraph conditional edges based on rigid Unix exit codes (`0` for success, `1` for failure) to manage agent handoffs and self-correction loops.

---

## 📋 Prerequisites

The host machine only runs the lightweight orchestration layer. The actual execution happens securely inside BoxLite.

1.  **Python 3.14+**
2.  **[uv](https://docs.astral.sh/uv/)** (Python package and project manager)
3.  **Docker** (Ensure the Docker daemon is running locally to build the OCI image).
4.  **Hardware Virtualization:** 
    *   *macOS:* Apple Silicon (M1/M2/M3/M4) with macOS 12+.
    *   *Linux:* x86_64 or ARM64 with KVM enabled.
5.  **API Keys:** Anthropic (for Claude Code and Pi by default) and OpenAI/Codex (for Codex CLI).

---

## 🚀 Quick Start

### 1. Install Host Dependencies

Clone the repo and install dependencies with uv (creates a local `.venv` from `pyproject.toml` and `uv.lock`):

```bash
git clone <repo-url>
cd orchestrix
uv sync
```

### 2. Configure Environment

Copy the example env file and add your API keys (and optional proxy/base URLs):

```bash
cp .env.example .env
# ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL (optional)
# OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL (optional)
# PI_API_KEY, PI_BASE_URL, PI_MODEL, PI_PROVIDER, PI_API (optional Pi overrides)
```

Pi infers a native provider for known endpoints: `api.minimaxi.com` uses
`minimax-cn`, `api.minimax.io` uses `minimax`, and other `OPENAI_BASE_URL`
values use Pi's built-in `openai` provider. The orchestrator writes
`/home/agent/.pi/agent/auth.json` and, when a generic compatible endpoint needs
one, `models.json` in the devbox before the agent runs. Set `PI_*` values only
when Pi should use a different provider, key, endpoint, model, or API transport
than Codex. For Anthropic-compatible endpoints, set `PI_PROVIDER=anthropic` and
optionally `PI_API=anthropic-messages`.

### 3. Build the local devbox image

BoxLite has its own OCI image store (separate from Docker). Build the image with Docker, then export it for BoxLite:

```bash
make devbox-image   # docker build -t orchestrix-devbox:v1
make devbox-check   # verify node, Pi, Claude, and Codex CLIs inside the image
make devbox-oci     # docker save → .oci/orchestrix-devbox-v1/
```

### 4. Prepare Workspace

The orchestrator mounts `~/projects/air-platform` into the devbox at `/workspace`. Create the sample project layout and task plan:

```bash
mkdir -p ~/projects/air-platform/docs
mkdir -p ~/projects/air-platform/src/api

# Create the architecture plan
echo "Implement JWT authentication middleware in src/api/middleware.ts. Ensure it checks for token expiration." > ~/projects/air-platform/docs/plan.md
```

### 5. Run the Orchestrator

```bash
make run
# or: uv run python -m orchestrix  (auto-exports OCI layout when stale)
# or: uv run orchestrix

# After changing the devbox image (dockerfile), rebuild first:
make run-fresh
# or: make devbox-oci && make run
```
