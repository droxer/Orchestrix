import argparse
import asyncio
import base64
import boxlite
import json
import os
import shlex
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypedDict, Annotated, Literal
import operator
from dotenv import load_dotenv
from langgraph.graph import StateGraph
from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.rule import Rule

REPO_ROOT = Path(__file__).resolve().parents[2]
DEVBOX_IMAGE = "orchestrix-devbox:v1"
OCI_LAYOUT_DIR = REPO_ROOT / ".oci" / "orchestrix-devbox-v1"

load_dotenv(REPO_ROOT / ".env")

console = Console()

ANTHROPIC_ENV_KEYS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
)

OPENAI_ENV_KEYS = (
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
)

AGENT_USER = "agent"
GUEST_WORKSPACE = "/workspace"
DEFAULT_HOST_WORKSPACE = "~/projects/air-platform"
MAX_CLAUDE_FAILURES = 3
MAX_CODEX_FAILURES = 2
session_guest_env: list[tuple[str, str]] = []

# Align guest agent UID/GID with the bind-mounted host workspace owner so new
# files appear on the host with the correct owner (numeric UID is preserved).
GUEST_AGENT_SYNC_SCRIPT = r"""
set -eu
uid="${ORCHESTRIX_HOST_UID:?}"
gid="${ORCHESTRIX_HOST_GID:?}"
ws="/workspace"

if ! getent group "$gid" >/dev/null 2>&1; then
  groupadd -g "$gid" orchestrix-host
fi

if id -u agent >/dev/null 2>&1; then
  usermod -o -u "$uid" -g "$gid" agent
else
  useradd -o -u "$uid" -g "$gid" -d /home/agent -s /bin/bash -m agent
fi

chown -R agent:agent /home/agent
chown -R agent:agent "$ws"
find "$ws" -type d -exec chmod u+rwx {} +
find "$ws" -type f -exec chmod u+rw {} +
"""


def host_workspace_path(raw: str | None = None) -> Path:
    path = Path(raw or DEFAULT_HOST_WORKSPACE).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def host_workspace_owner(path: str | Path) -> tuple[int, int]:
    """UID/GID of the host directory owner (used for bind-mount ownership)."""
    resolved = host_workspace_path(str(path))
    stat = resolved.stat()
    return stat.st_uid, stat.st_gid


def guest_agent_env(host_workspace: str | Path | None = None) -> list[tuple[str, str]]:
    """Host .env vars forwarded into the BoxLite guest for agent CLIs."""
    env: list[tuple[str, str]] = []
    for key in ANTHROPIC_ENV_KEYS:
        if value := os.environ.get(key):
            env.append((key, value))
    openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("CODEX_API_KEY")
    if openai_key:
        env.append(("OPENAI_API_KEY", openai_key))
        env.append(("CODEX_API_KEY", openai_key))
    for key in ("OPENAI_BASE_URL", "OPENAI_MODEL"):
        if value := os.environ.get(key):
            env.append((key, value))
    if host_workspace is not None:
        uid, gid = host_workspace_owner(host_workspace)
        env.append(("ORCHESTRIX_HOST_UID", str(uid)))
        env.append(("ORCHESTRIX_HOST_GID", str(gid)))
    return env


def guest_env_exports() -> str:
    """Shell exports for API keys when dropping from root to the agent user."""
    parts = [
        f"export {key}={shlex.quote(value)}" for key, value in session_guest_env
    ]
    return " && ".join(parts)


def require_openai_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("CODEX_API_KEY")
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY (or CODEX_API_KEY) is required for Codex. "
            "Set it in .env (DashScope: use your compatible-mode API key)."
        )
    return key


def guest_codex_config_toml() -> str:
    """Codex config for a third-party OpenAI-compatible API (e.g. DashScope).

    Use a custom model_provider instead of openai_base_url on the built-in OpenAI
    provider. Current Codex releases no longer accept wire_api = "chat" for
    custom providers, so compatible providers must handle Codex's default
    Responses API flow.

    requires_openai_auth = false marks this as a non-OpenAI provider so Codex
    uses the configured provider API key instead of OpenAI sign-in.
    """
    lines = [
        "[sandbox]",
        'default_mode = "danger-full-access"',
        'model_provider = "dashscope"',
    ]
    if model := os.environ.get("OPENAI_MODEL"):
        lines.append(f"model = {json.dumps(model)}")
    if base_url := os.environ.get("OPENAI_BASE_URL"):
        lines.extend(
            [
                "",
                "[model_providers.dashscope]",
                'name = "DashScope"',
                f"base_url = {json.dumps(base_url)}",
                'env_key = "OPENAI_API_KEY"',
                "requires_openai_auth = false",
            ]
        )
    return "\n".join(lines) + "\n"


def guest_codex_auth_json(api_key: str) -> str:
    return json.dumps({"auth_mode": "apikey", "OPENAI_API_KEY": api_key})


def codex_cli_config_overrides() -> list[str]:
    """CLI -c flags matching guest_codex_config_toml."""
    argv: list[str] = ["-c", 'model_provider="dashscope"']
    if model := os.environ.get("OPENAI_MODEL"):
        argv.extend(["-c", f"model={json.dumps(model)}"])
    if base_url := os.environ.get("OPENAI_BASE_URL"):
        argv.extend(
            [
                "-c",
                f'model_providers.dashscope.base_url={json.dumps(base_url)}',
                "-c",
                "model_providers.dashscope.requires_openai_auth=false",
            ]
        )
    return argv


def run_as_agent(command: str) -> str:
    """Run a command as the non-root agent user with workspace and env set up."""
    parts = [
        "export HOME=/home/agent",
        "export CODEX_HOME=/home/agent/.codex",
        "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "umask 002",
        guest_env_exports(),
        f"cd {GUEST_WORKSPACE}",
        command,
    ]
    inner = " && ".join(part for part in parts if part)
    return f"su {AGENT_USER} -s /bin/bash -c {shlex.quote(inner)}"


async def prepare_guest_workspace(host_workspace: str | Path) -> tuple[int, int]:
    """Map guest agent to the host workspace owner and fix mount permissions."""
    uid, gid = host_workspace_owner(host_workspace)
    box = active_box()
    result = await box.exec("bash", "-c", GUEST_AGENT_SYNC_SCRIPT)
    if result.exit_code != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            "Failed to sync workspace ownership for host access. "
            f"uid={uid} gid={gid}. {detail}"
        )
    return uid, gid


async def prepare_guest_agent_auth() -> None:
    """Write Codex auth.json and config.toml so API key + base URL reach the CLI."""
    api_key = require_openai_api_key()
    box = active_box()
    auth_b64 = base64.b64encode(guest_codex_auth_json(api_key).encode()).decode()
    config_b64 = base64.b64encode(guest_codex_config_toml().encode()).decode()
    script = (
        "set -eu; "
        "mkdir -p /home/agent/.codex; "
        f"printf %s {shlex.quote(auth_b64)} | base64 -d > /home/agent/.codex/auth.json; "
        f"printf %s {shlex.quote(config_b64)} | base64 -d > /home/agent/.codex/config.toml; "
        "chown -R agent:agent /home/agent/.codex; "
        "chmod 600 /home/agent/.codex/auth.json"
    )
    result = await box.exec("bash", "-c", script)
    if result.exit_code != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Failed to configure Codex auth in the guest. {detail}")

    expected = os.environ.get("OPENAI_BASE_URL", "")
    if expected:
        verify = await box.exec(
            "grep",
            "-F",
            expected,
            "/home/agent/.codex/config.toml",
        )
        if verify.exit_code != 0:
            raise RuntimeError(
                "Codex config.toml in the guest is missing the DashScope base_url. "
                f"Expected to find: {expected!r}"
            )
        provider = await box.exec(
            "grep",
            "-F",
            'model_provider = "dashscope"',
            "/home/agent/.codex/config.toml",
        )
        if provider.exit_code != 0:
            raise RuntimeError(
                'Codex config.toml must set model_provider = "dashscope" '
                "so third-party APIs use the configured provider."
            )


def print_user_task(console: Console, prompt: str) -> None:
    console.print(
        Panel(
            prompt,
            title="[bold blue]You[/]",
            border_style="blue",
            padding=(0, 1),
        )
    )


def codex_review_prompt(state: AgentState) -> str:
    return (
        "You are reviewing code in /workspace. "
        f"Task context: {state['task_goal']}. "
        "Read relevant files, check for blocking bugs or regressions, "
        "and report only blocking issues. "
        "If there are no blocking issues, reply with a brief approval. "
        "End your response with exactly one verdict line: "
        "ORCHESTRIX_REVIEW_VERDICT: APPROVED when there are no blocking issues, "
        "or ORCHESTRIX_REVIEW_VERDICT: REJECTED when blocking issues remain."
    )


def build_codex_review_command(state: AgentState) -> str:
    """Run Codex via `exec` with a review prompt (not the `review` subcommand)."""
    argv = [
        "stdbuf",
        "-oL",
        "-eL",
        "codex",
        *codex_cli_config_overrides(),
        "-C",
        GUEST_WORKSPACE,
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
    ]
    if model := os.environ.get("OPENAI_MODEL"):
        argv.extend(["-m", model])
    argv.append(codex_review_prompt(state))
    inner = " ".join(shlex.quote(arg) for arg in argv) + " < /dev/null"
    return run_as_agent(inner)


def claude_task_prompt(state: AgentState) -> str:
    prompt = (
        f"Read docs/plan.md. {state['task_goal']}. "
        "Run tests and fix any errors before exiting."
    )
    if feedback := state.get("codex_feedback"):
        prompt += f"\n\nCodex review feedback to fix:\n{feedback}"
    return prompt


def build_claude_implement_command(state: AgentState) -> str:
    argv = [
        "stdbuf",
        "-oL",
        "-eL",
        "claude",
        "-p",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        GUEST_WORKSPACE,
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
    ]
    if model := os.environ.get("ANTHROPIC_MODEL"):
        argv.extend(["--model", model])
    argv.append(claude_task_prompt(state))
    inner = " ".join(shlex.quote(arg) for arg in argv) + " < /dev/null"
    return run_as_agent(inner)


class ClaudeStreamRenderer:
    """Render Claude Code stream-json events with distinct visual roles."""

    TEXT_STYLE = "#e2e8f0"
    THINKING_STYLE = "dim italic #64748b"

    def __init__(self, console: Console) -> None:
        self.console = console
        self._buffer = ""
        self._block: str | None = None
        self._assistant_open = False

    def feed(self, chunk: str) -> None:
        self._buffer += chunk
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._handle_line(line.strip())

    def print_task(self, prompt: str) -> None:
        print_user_task(self.console, prompt)

    def _close_block(self) -> None:
        if self._block is not None:
            self.console.print()
            self._block = None
            self._assistant_open = False

    def _open_assistant(self) -> None:
        if not self._assistant_open:
            self.console.print(
                "\n[bold #c084fc]Claude[/] [dim #64748b]·[/] ",
                markup=True,
                end="",
            )
            self._assistant_open = True

    def _handle_line(self, line: str) -> None:
        if not line:
            return
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            self._close_block()
            self.console.print(line, style=self.TEXT_STYLE)
            self.console.print()
            return

        event_type = event.get("type")
        if event_type == "stream_event":
            self._handle_stream_event(event.get("event", {}))
        elif event_type == "system":
            self._handle_system_event(event)
        elif event_type == "result":
            self._handle_result_event(event)

    def _handle_stream_event(self, stream_event: dict) -> None:
        event_kind = stream_event.get("type")
        delta = stream_event.get("delta", {})
        content_block = stream_event.get("content_block", {})

        if event_kind == "message_start":
            message = stream_event.get("message", {})
            if message.get("role") == "user":
                self._close_block()
                text = _message_text(message)
                if text:
                    self.print_task(text)
            return

        if event_kind == "content_block_start":
            block_type = content_block.get("type")
            self._close_block()
            if block_type == "thinking":
                self._block = "thinking"
                self.console.print(
                    "\n[dim #64748b]💭 thinking[/]",
                    markup=True,
                )
            elif block_type == "text":
                self._block = "text"
                self._open_assistant()
            elif block_type == "tool_use":
                self._block = "tool"
                name = content_block.get("name", "unknown")
                self.console.print(
                    f"\n[cyan]⚙[/]  [bold cyan]{escape(name)}[/]",
                    markup=True,
                )
            return

        if event_kind == "content_block_stop":
            self._close_block()
            return

        if delta.get("type") == "text_delta":
            self._block = self._block or "text"
            if self._block == "text":
                self._open_assistant()
            self.console.print(
                delta.get("text", ""),
                end="",
                style=self.TEXT_STYLE,
                highlight=False,
            )
            return

        if delta.get("type") == "thinking_delta":
            self._block = "thinking"
            self.console.print(
                delta.get("thinking", ""),
                end="",
                style=self.THINKING_STYLE,
                highlight=False,
            )

    def _handle_system_event(self, event: dict) -> None:
        subtype = event.get("subtype")
        if subtype == "api_retry":
            self._close_block()
            self.console.print(
                f"\n[yellow]↻[/]  [yellow]API retry "
                f"{event.get('attempt')}/{event.get('max_retries')}[/] "
                f"[dim]({escape(str(event.get('error', 'unknown error')))})[/]",
                markup=True,
            )
            return
        if subtype == "status" and event.get("status") == "requesting":
            self._close_block()
            self.console.print(
                "\n[dim #64748b]⏳  Waiting for model response…[/]",
                markup=True,
            )

    def _handle_result_event(self, event: dict) -> None:
        self._close_block()
        if event.get("is_error"):
            self.console.print(
                f"\n[red]✗[/]  [red]{escape(str(event.get('result', 'unknown error')))}[/]",
                markup=True,
            )
            return
        self.console.print("\n[green]✓[/]  [green]Claude finished[/]", markup=True)


def _message_text(message: dict) -> str:
    parts: list[str] = []
    for block in message.get("content", []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(part for part in parts if part)


def _truncate_command(command: str, limit: int = 88) -> str:
    command = " ".join(command.split())
    if len(command) <= limit:
        return command
    return command[: limit - 1] + "…"


class CodexStreamRenderer:
    """Render Codex exec --json JSONL events with distinct visual roles."""

    TEXT_STYLE = "#e2e8f0"
    THINKING_STYLE = "dim italic #64748b"

    def __init__(self, console: Console) -> None:
        self.console = console
        self._buffer = ""
        self._assistant_open = False

    def feed(self, chunk: str) -> None:
        self._buffer += chunk
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._handle_line(line.strip())

    def print_task(self, prompt: str) -> None:
        print_user_task(self.console, prompt)

    def _close_assistant(self) -> None:
        if self._assistant_open:
            self.console.print()
            self._assistant_open = False

    def _open_assistant(self) -> None:
        if not self._assistant_open:
            self.console.print(
                "\n[bold #38bdf8]Codex[/] [dim #64748b]·[/] ",
                markup=True,
                end="",
            )
            self._assistant_open = True

    def _handle_line(self, line: str) -> None:
        if not line:
            return
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            self._close_assistant()
            self.console.print(line, style=self.TEXT_STYLE)
            self.console.print()
            return

        event_type = event.get("type")
        if event_type == "turn.started":
            self._close_assistant()
            self.console.print(
                "\n[dim #64748b]⏳  Codex is reviewing…[/]",
                markup=True,
            )
            return
        if event_type == "error":
            self._close_assistant()
            message = str(event.get("message", "unknown error"))
            if message.startswith("Reconnecting"):
                self.console.print(
                    f"\n[yellow]↻[/]  [yellow]{escape(message)}[/]",
                    markup=True,
                )
            else:
                self.console.print(
                    f"\n[red]✗[/]  [red]{escape(message)}[/]",
                    markup=True,
                )
            return
        if event_type == "turn.failed":
            self._close_assistant()
            error = event.get("error", {})
            message = error.get("message", "turn failed")
            self.console.print(
                f"\n[red]✗[/]  [red]{escape(str(message))}[/]",
                markup=True,
            )
            return
        if event_type == "turn.completed":
            self._close_assistant()
            self.console.print("\n[green]✓[/]  [green]Codex finished[/]", markup=True)
            return
        if event_type and event_type.startswith("item."):
            self._handle_item_event(event_type, event.get("item", {}))

    def _handle_item_event(self, phase: str, item: dict) -> None:
        item_type = item.get("type")
        if item_type == "command_execution":
            self._handle_command_event(phase, item)
        elif item_type == "reasoning" and phase == "item.completed":
            self._handle_reasoning(item)
        elif item_type == "agent_message" and phase == "item.completed":
            self._handle_agent_message(item)
        elif item_type == "file_change" and phase == "item.completed":
            self._handle_file_change(item)
        elif item_type == "mcp_tool_call":
            self._handle_mcp_tool_call(phase, item)
        elif item_type == "web_search" and phase == "item.completed":
            query = item.get("query", "")
            self._close_assistant()
            self.console.print(
                f"\n[blue]🔍[/]  [blue]{escape(str(query))}[/]",
                markup=True,
            )
        elif item_type == "todo_list":
            self._handle_todo_list(item)
        elif item_type == "error" and phase == "item.completed":
            self._close_assistant()
            self.console.print(
                f"\n[yellow]![/]  [yellow]{escape(str(item.get('message', 'warning')))}[/]",
                markup=True,
            )

    def _handle_command_event(self, phase: str, item: dict) -> None:
        command = _truncate_command(str(item.get("command", "command")))
        if phase == "item.started":
            self._close_assistant()
            self.console.print(
                f"\n[cyan]⚙[/]  [bold cyan]{escape(command)}[/]",
                markup=True,
            )
            return
        if phase != "item.completed":
            return
        exit_code = item.get("exit_code")
        status = item.get("status")
        if exit_code in (None, 0) and status != "failed":
            return
        self.console.print(
            f"   [dim red]exit {exit_code} ({escape(str(status or 'failed'))})[/]",
            markup=True,
        )

    def _handle_reasoning(self, item: dict) -> None:
        text = str(item.get("text", "")).strip()
        if not text:
            return
        self._close_assistant()
        self.console.print("\n[dim #64748b]💭 reasoning[/]", markup=True)
        self.console.print(f"   {text}", style=self.THINKING_STYLE)

    def _handle_agent_message(self, item: dict) -> None:
        text = str(item.get("text", "")).strip()
        if not text:
            return
        self._close_assistant()
        self._open_assistant()
        self.console.print(text, style=self.TEXT_STYLE)
        self._assistant_open = True

    def _handle_file_change(self, item: dict) -> None:
        changes = item.get("changes", [])
        if not changes:
            return
        self._close_assistant()
        self.console.print("\n[green]📝[/]  [green]file changes[/]", markup=True)
        for change in changes:
            kind = escape(str(change.get("kind", "update")))
            path = escape(str(change.get("path", "")))
            self.console.print(f"   [dim]{kind}[/]  {path}", markup=True)
        status = item.get("status")
        if status == "failed":
            self.console.print("   [red]patch failed[/]", markup=True)

    def _handle_mcp_tool_call(self, phase: str, item: dict) -> None:
        server = escape(str(item.get("server", "mcp")))
        tool = escape(str(item.get("tool", "tool")))
        if phase == "item.started":
            self._close_assistant()
            self.console.print(
                f"\n[cyan]⚙[/]  [bold cyan]{server}[/] · {tool}",
                markup=True,
            )
            return
        if phase != "item.completed":
            return
        if item.get("status") == "failed":
            error = item.get("error", {})
            message = escape(str(error.get("message", "tool failed")))
            self.console.print(f"   [dim red]{message}[/]", markup=True)

    def _handle_todo_list(self, item: dict) -> None:
        todos = item.get("items", [])
        if not todos:
            return
        self._close_assistant()
        self.console.print("\n[dim #64748b]📋 plan[/]", markup=True)
        for todo in todos:
            done = todo.get("completed", False)
            mark = "[green]✓[/]" if done else "[dim]○[/]"
            text = escape(str(todo.get("text", "")))
            self.console.print(f"   {mark}  {text}", markup=True)


@dataclass
class LineBufferFormatter:
    """Accumulate stdout chunks and emit formatted complete lines."""

    _buffer: str = field(default="", init=False)

    def feed(self, chunk: str, format_line) -> str:
        self._buffer += chunk
        output: list[str] = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if formatted := format_line(line):
                output.append(formatted)
        return "".join(output)


def _chunk_text(chunk: str | bytes) -> str:
    if isinstance(chunk, bytes):
        return chunk.decode("utf-8", errors="replace")
    return chunk


@dataclass
class StreamExecResult:
    exit_code: int
    stdout: str
    stderr: str
    error_message: str | None = None


async def exec_stream(
    cmd: str,
    *args: str,
    cwd: str | None = None,
    stdout_style: str = "",
    stderr_style: str = "dim red",
    stdout_line_formatter=None,
    stdout_renderer: ClaudeStreamRenderer | CodexStreamRenderer | None = None,
) -> StreamExecResult:
    """Run a guest command and print stdout/stderr to the host console as they arrive."""
    box = active_box()
    arg_list = list(args) if args else None
    try:
        execution = await box._box.exec(cmd, arg_list, None, cwd=cwd)
    except RuntimeError as exc:
        if "Handle invalidated after stop()" in str(exc):
            raise RuntimeError(
                "BoxLite sandbox stopped before the agent command could run. "
                "Check for stale processes: pgrep -fl 'orchestrator.py|boxlite-shim'. "
                "Then rebuild and retry: make devbox-oci && make run"
            ) from exc
        raise

    stdout_stream = execution.stdout()
    stderr_stream = execution.stderr()
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []
    line_formatter = (
        LineBufferFormatter()
        if stdout_line_formatter is not None and stdout_renderer is None
        else None
    )

    async def drain_stdout() -> None:
        if not stdout_stream:
            return
        async for chunk in stdout_stream:
            text = _chunk_text(chunk)
            stdout_parts.append(text)
            if stdout_renderer is not None:
                stdout_renderer.feed(text)
            elif line_formatter is not None:
                display = line_formatter.feed(text, stdout_line_formatter)
                if display:
                    console.print(display, end="", style=stdout_style, highlight=False)
            elif text:
                console.print(text, end="", style=stdout_style, highlight=False)

    async def drain_stderr() -> None:
        if not stderr_stream:
            return
        async for chunk in stderr_stream:
            text = _chunk_text(chunk)
            stderr_parts.append(text)
            console.print(text, end="", style=stderr_style, highlight=False)

    await asyncio.gather(drain_stdout(), drain_stderr())

    if stdout_parts or stderr_parts:
        console.print()

    try:
        exec_result = await execution.wait()
        exit_code = exec_result.exit_code
        error_message = exec_result.error_message
    except Exception:
        exit_code = -1
        error_message = "execution.wait() failed"

    return StreamExecResult(
        exit_code=exit_code,
        stdout="".join(stdout_parts),
        stderr="".join(stderr_parts),
        error_message=error_message,
    )


def _docker_image_id(image: str) -> str | None:
    inspect = subprocess.run(
        ["docker", "image", "inspect", image, "--format", "{{.Id}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if inspect.returncode != 0:
        return None
    return inspect.stdout.strip() or None


def ensure_local_devbox_oci() -> str:
    """Export the local Docker image to an OCI layout BoxLite can load."""
    inspect = subprocess.run(
        ["docker", "image", "inspect", DEVBOX_IMAGE],
        capture_output=True,
    )
    if inspect.returncode != 0:
        raise RuntimeError(
            f"Local image {DEVBOX_IMAGE!r} not found. "
            "Build it with: make devbox-image"
        )

    image_id = _docker_image_id(DEVBOX_IMAGE)
    stamp_file = OCI_LAYOUT_DIR / ".docker-image-id"
    oci_layout = OCI_LAYOUT_DIR / "oci-layout"
    if (
        oci_layout.exists()
        and stamp_file.exists()
        and image_id is not None
        and stamp_file.read_text().strip() == image_id
    ):
        return str(OCI_LAYOUT_DIR)

    if oci_layout.exists():
        console.print("[yellow]![/] Docker image changed — re-exporting OCI layout")

    OCI_LAYOUT_DIR.mkdir(parents=True, exist_ok=True)
    with console.status(
        f"[bold cyan]Exporting[/] {DEVBOX_IMAGE} → {OCI_LAYOUT_DIR.name}/"
    ):
        subprocess.run(
            f"docker save {DEVBOX_IMAGE} | tar -xf - -C {OCI_LAYOUT_DIR}",
            shell=True,
            check=True,
        )
    if image_id is not None:
        stamp_file.write_text(image_id + "\n")
    return str(OCI_LAYOUT_DIR)

# ---------------------------------------------------------
# 1. State Definition
# ---------------------------------------------------------
class AgentState(TypedDict):
    task_goal: str
    agent_logs: Annotated[list, operator.add]
    last_exit_code: int
    claude_failures: int
    codex_failures: int
    codex_verdict: str
    codex_feedback: str

session_box: boxlite.SimpleBox | None = None


def active_box() -> boxlite.SimpleBox:
    """Return the live sandbox or raise with an actionable error."""
    box = session_box
    if box is None or not box._started:
        raise RuntimeError(
            "BoxLite sandbox is not running. "
            "Stop any other Orchestrix process and run again."
        )
    return box


def ensure_single_orchestrator() -> None:
    """Refuse to start if another orchestrator.py is already running."""
    ignored = {os.getpid(), os.getppid()}
    result = subprocess.run(
        ["pgrep", "-fl", "orchestrator.py"],
        capture_output=True,
        text=True,
        check=False,
    )
    others: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        pid_str = line.split(None, 1)[0]
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        if pid not in ignored:
            others.append(line)
    if others:
        raise RuntimeError(
            "Another Orchestrix orchestrator is already running:\n"
            + "\n".join(f"  {line}" for line in others)
            + "\nStop it first (only one BoxLite runtime can use ~/.boxlite)."
        )

# ---------------------------------------------------------
# 2. Agent Nodes
# ---------------------------------------------------------
async def claude_implement_node(state: AgentState):
    console.print(Rule("[bold magenta]Claude Code[/] — implementation"))

    renderer = ClaudeStreamRenderer(console)
    renderer.print_task(claude_task_prompt(state))

    result = await exec_stream(
        "bash",
        "-c",
        build_claude_implement_command(state),
        cwd="/workspace",
        stdout_renderer=renderer,
    )

    claude_failures = (
        0 if result.exit_code == 0 else state.get("claude_failures", 0) + 1
    )
    return {
        "agent_logs": [f"[Claude Code Exit {result.exit_code}]:\n{result.stdout[-500:]}"],
        "last_exit_code": result.exit_code,
        "claude_failures": claude_failures,
    }

async def codex_review_node(state: AgentState):
    console.print(Rule("[bold blue]Codex[/] — code review"))

    renderer = CodexStreamRenderer(console)
    renderer.print_task(codex_review_prompt(state))

    result = await exec_stream(
        "bash",
        "-c",
        build_codex_review_command(state),
        cwd="/workspace",
        stdout_renderer=renderer,
    )
    
    feedback = extract_codex_feedback(result.stdout)
    verdict = classify_codex_review(result.exit_code, feedback)
    codex_failures = (
        state.get("codex_failures", 0) + 1
        if verdict == "failed"
        else 0
    )
    return {
        "agent_logs": [f"[Codex Review Exit {result.exit_code}]:\n{result.stdout}"],
        "last_exit_code": result.exit_code,
        "codex_failures": codex_failures,
        "codex_verdict": verdict,
        "codex_feedback": feedback,
    }


def extract_codex_feedback(stdout: str) -> str:
    messages: list[str] = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "item.completed":
            continue
        item = event.get("item", {})
        if item.get("type") == "agent_message":
            text = str(item.get("text", "")).strip()
            if text:
                messages.append(text)
    if messages:
        return "\n\n".join(messages)
    return stdout.strip()[-4000:]


def classify_codex_review(exit_code: int, feedback: str) -> str:
    if exit_code != 0:
        return "failed"
    verdict = ""
    for line in feedback.splitlines():
        line = line.strip()
        if line.startswith("ORCHESTRIX_REVIEW_VERDICT:"):
            verdict = line.split(":", 1)[1].strip().upper()
    if verdict == "APPROVED":
        return "approved"
    if verdict == "REJECTED":
        return "rejected"
    return "failed"

# ---------------------------------------------------------
# 3. Routing Logic
# ---------------------------------------------------------
def route_claude_handoff(state: AgentState) -> Literal["codex_review", "claude_implement", "__end__"]:
    if state["last_exit_code"] == 0:
        console.print("[green]✓[/] Claude succeeded → Codex review")
        return "codex_review"

    if state["claude_failures"] < MAX_CLAUDE_FAILURES:
        console.print(
            f"[yellow]![/] Claude failed (exit {state['last_exit_code']}) "
            f"— retry {state['claude_failures']}/{MAX_CLAUDE_FAILURES}"
        )
        return "claude_implement"

    console.print(f"[red]✗[/] Claude failed {MAX_CLAUDE_FAILURES} times — halting")
    return "__end__"

def route_codex_handoff(state: AgentState) -> Literal["codex_review", "claude_implement", "__end__"]:
    verdict = state.get("codex_verdict", "failed")
    if verdict == "approved":
        console.print("[green]✓[/] Codex approved — workflow complete")
        return "__end__"

    if verdict == "rejected":
        console.print("[yellow]![/] Codex rejected → back to Claude")
        return "claude_implement"

    if state["codex_failures"] < MAX_CODEX_FAILURES:
        console.print(
            f"[yellow]![/] Codex review failed (exit {state['last_exit_code']}) "
            f"— retry {state['codex_failures']}/{MAX_CODEX_FAILURES}"
        )
        return "codex_review"
    console.print(f"[red]✗[/] Codex review failed {MAX_CODEX_FAILURES} times — halting")
    return "__end__"

# ---------------------------------------------------------
# 4. Execution Engine
# ---------------------------------------------------------
async def main():
    global session_box

    ensure_single_orchestrator()
    
    console.print(
        Panel(
            f"[bold]Image[/] {DEVBOX_IMAGE}\n[bold]Workspace[/] mount → /workspace",
            title="[bold cyan]Orchestrix[/]",
            border_style="cyan",
        )
    )
    rootfs_path = ensure_local_devbox_oci()

    host_workspace = host_workspace_path()
    require_openai_api_key()

    try:
        global session_guest_env
        host_uid, host_gid = host_workspace_owner(host_workspace)
        session_guest_env = guest_agent_env(host_workspace)
        async with boxlite.SimpleBox(
            rootfs_path=rootfs_path,
            volumes=[(str(host_workspace), GUEST_WORKSPACE, False)],
            env=session_guest_env,
            auto_remove=True,
        ) as box:
            session_box = box
            console.print(f"[dim]rootfs[/] {rootfs_path}  [dim]box[/] {box.id}")

            synced_uid, synced_gid = await prepare_guest_workspace(host_workspace)
            await prepare_guest_agent_auth()
            base_url = os.environ.get("OPENAI_BASE_URL", "(default)")
            console.print(
                f"[dim]workspace[/] {host_workspace}\n"
                f"[dim]mount[/] {GUEST_WORKSPACE}  "
                f"[dim]owner[/] uid={synced_uid} gid={synced_gid} "
                f"(matches host user for IDE access)\n"
                f"[dim]codex[/] provider=dashscope (HTTP)  base_url={base_url}"
            )

            preflight = await box.exec(
                "bash",
                "-c",
                run_as_agent("claude --version"),
            )
            if preflight.exit_code != 0:
                raise RuntimeError(
                    "Claude Code is missing from the devbox image. "
                    "Rebuild with: make devbox-oci"
                )

            codex_preflight = await box.exec(
                "bash",
                "-c",
                run_as_agent("codex login status"),
            )
            if codex_preflight.exit_code != 0:
                detail = (codex_preflight.stderr or codex_preflight.stdout or "").strip()
                raise RuntimeError(f"Codex auth preflight failed. {detail}")

            # Compile the LangGraph
            workflow = StateGraph(AgentState)
            workflow.add_node("claude_implement", claude_implement_node)
            workflow.add_node("codex_review", codex_review_node)
            workflow.set_entry_point("claude_implement")
            workflow.add_conditional_edges("claude_implement", route_claude_handoff)
            workflow.add_conditional_edges("codex_review", route_codex_handoff)
            orchestrator = workflow.compile()

            initial_state = {
                "task_goal": "Implement the auth middleware in src/api/middleware.ts",
                "agent_logs": [],
                "last_exit_code": 0,
                "claude_failures": 0,
                "codex_failures": 0,
                "codex_verdict": "",
                "codex_feedback": "",
            }

            async for _event in orchestrator.astream(initial_state):
                pass
    finally:
        session_box = None

def run(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="orchestrix",
        description="Run the Orchestrix multi-agent workflow.",
    )
    parser.parse_args(argv)
    asyncio.run(main())


if __name__ == "__main__":
    run()
