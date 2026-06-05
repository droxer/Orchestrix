# Relay: Human and AI Agent Collaboration Platform

A lightweight, local-first collaboration platform where humans and AI agents like Claude Code, Pi, and Codex share context, tools, and a live workspace for complex software engineering tasks.

Instead of managing context windows and parsing text, **Relay** uses a small TypeScript state machine and **BoxLite** to provide a persistent, hardware-isolated micro-VM. Humans assign work from the terminal, and agents collaborate by reading and writing to a shared file system in real time.

---

## 🎯 Features

*   **True "Bring Your Own Agent" (BYOA):** Orchestrates fully autonomous CLI agents like Anthropic's `@claude-code`, Pi, and Codex.
*   **Shared Reality:** All agents operate inside a single, persistent BoxLite micro-VM. If Claude installs a package, Pi and Codex can immediately use it to run tests.
*   **Zero-Sync Workspace:** Mounts your local project directory directly into the VM. The guest `agent` user is aligned to your host UID/GID so files created in the VM are owned by your macOS/Linux user and open normally in your IDE.
*   **Deterministic Routing:** Uses explicit TypeScript routing based on rigid Unix exit codes (`0` for success, `1` for failure) to manage agent handoffs and self-correction loops.
*   **Readable terminal streams:** Claude and Codex JSONL events are rendered as human-readable terminal output, and Pi uses streaming print mode when the installed CLI supports it.

---

## 📋 Prerequisites

The host machine only runs the lightweight orchestration layer. The actual execution happens securely inside BoxLite.

1.  **Node.js 22.19+**
2.  **npm**
3.  **Docker** (Ensure the Docker daemon is running locally to build the OCI image).
4.  **Hardware Virtualization:** 
    *   *macOS:* Apple Silicon (M1/M2/M3/M4) with macOS 12+.
    *   *Linux:* x86_64 or ARM64 with KVM enabled.
5.  **API Keys:** Anthropic (for Claude Code and Pi by default) and OpenAI/Codex (for Codex CLI).

---

## 🚀 Quick Start

### 1. Install Host Dependencies

Clone the repo and install dependencies with npm:

```bash
git clone <repo-url>
cd relay
npm install
npm test
```

The host project is TypeScript:

```text
src/index.ts          CLI entrypoint
src/orchestrator.ts   BoxLite lifecycle, agent commands, routing, renderers
tests/handoff.test.ts Unit tests for routing, prompts, provider config, and stream rendering
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

Pi CLI versions are not fully uniform. Relay checks `pi --help` at runtime:
if `-P` / `--print-streaming` is available, it uses streaming print mode; if not,
it falls back to `-p` so older devbox images still run.

### 3. Build the local devbox image

BoxLite has its own OCI image store (separate from Docker). Build the image with Docker, then export it for BoxLite:

```bash
make devbox-image   # docker build -t relay-devbox:v1
make devbox-check   # verify node, Pi, Claude, and Codex CLIs inside the image
make devbox-oci     # docker save -> .oci/relay-devbox-v1/
```

You only need to rebuild/export the devbox when the image changes. Normal code
changes in `src/` or `tests/` do not require `make run-fresh`.

### 4. Prepare Workspace

The orchestrator mounts `~/projects/air-platform` into the devbox at `/workspace`. Create or clone the project you want agents to work on there:

```bash
mkdir -p ~/projects/air-platform
```

### 5. Run the Orchestrator

```bash
make run
# or: npm run run

# In the TUI, type the task and assign it explicitly:
# @claude <your task>
# @claude @pi @codex <your task>

# Only after editing dockerfile or changing the devbox image:
make run-fresh
# or: make devbox-oci && make run
```

## Development

```bash
npm run build
npm test
make test
```

The CLI output is intentionally formatted for terminal use:

- Startup metadata is shown as aligned key/value rows.
- Agent phases are shown as section headers with the prompt.
- Claude `stream-json` and Codex `--json` events are rendered into readable text.
- Raw JSONL should not be printed during normal runs.

Set `NO_COLOR=1` to disable ANSI colors.
