import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type BoxLiteModule = typeof import("@boxlite-ai/boxlite");

const currentFile = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(currentFile), "../..");
export const DEVBOX_IMAGE = "orchestrix-devbox:v1";
export const OCI_LAYOUT_DIR = resolve(REPO_ROOT, ".oci/orchestrix-devbox-v1");
export const DOCKERFILE = resolve(REPO_ROOT, "dockerfile");

export const ANTHROPIC_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
] as const;

export const OPENAI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

export const AGENT_USER = "agent";
export const GUEST_WORKSPACE = "/workspace";
export const DEFAULT_HOST_WORKSPACE = "~/projects/air-platform";
export const MAX_CLAUDE_FAILURES = 3;
export const MAX_PI_FAILURES = 2;
export const MAX_CODEX_FAILURES = 2;
export const PI_NATIVE_BASE_URL_PROVIDERS = new Set(["minimax", "minimax-cn"]);

export let sessionGuestEnv: Array<[string, string]> = [];

loadDotEnv(resolve(REPO_ROOT, ".env"));

const GUEST_AGENT_SYNC_SCRIPT = `
set -eu
uid="\${ORCHESTRIX_HOST_UID:?}"
gid="\${ORCHESTRIX_HOST_GID:?}"
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
`;

export interface AgentState {
  task_goal: string;
  agent_logs: string[];
  last_exit_code: number;
  claude_failures: number;
  pi_failures: number;
  codex_failures: number;
  codex_verdict: string;
  codex_feedback: string;
}

export interface StreamExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  error_message?: string;
}

type StreamRenderer = (chunk: string) => string;
type Route = "claude_implement" | "pi_implement" | "codex_review" | "__end__";

let sessionBox: any | null = null;

const colorsEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

function color(text: string, ...codes: string[]): string {
  if (!colorsEnabled) return text;
  return `${codes.join("")}${text}${ansi.reset}`;
}

function section(title: string, accent: string): string {
  return `\n${color(`== ${title} `, ansi.bold, accent)}${color("=".repeat(Math.max(8, 58 - title.length)), accent)}\n`;
}

function status(kind: "ok" | "warn" | "error" | "info", message: string): string {
  const label = {
    ok: color("OK", ansi.green, ansi.bold),
    warn: color("WARN", ansi.yellow, ansi.bold),
    error: color("ERR", ansi.red, ansi.bold),
    info: color("INFO", ansi.cyan, ansi.bold),
  }[kind];
  return `${label}  ${message}`;
}

function keyValue(key: string, value: string): string {
  return `${color(key.padEnd(11), ansi.dim)} ${value}`;
}

function agentLabel(name: string, accent: string): string {
  return color(name, ansi.bold, accent);
}

function promptBlock(title: string, prompt: string, accent: string): string {
  return [
    section(title, accent),
    color("Prompt", ansi.dim),
    indent(wrapText(prompt, terminalWidth() - 2), 2),
    "",
  ].join("\n");
}

function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns || 88, 64), 110);
}

function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function expandUser(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function hostWorkspacePath(raw?: string | null): string {
  const path = resolve(expandUser(raw ?? DEFAULT_HOST_WORKSPACE));
  mkdirSync(path, { recursive: true });
  return path;
}

export function hostWorkspaceOwner(path: string): [number, number] {
  const resolved = hostWorkspacePath(path);
  const stat = statSync(resolved);
  return [stat.uid, stat.gid];
}

export function openaiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
}

export function requireOpenaiApiKey(): string {
  const key = openaiApiKey();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY (or CODEX_API_KEY) is required for Codex. " +
        "Set it in .env (DashScope: use your compatible-mode API key).",
    );
  }
  return key;
}

export function piApiKey(): string | undefined {
  return process.env.PI_API_KEY || openaiApiKey() || process.env.ANTHROPIC_API_KEY;
}

export function piSourceBaseUrl(): string | undefined {
  return process.env.PI_BASE_URL || process.env.OPENAI_BASE_URL;
}

export function piModel(): string | undefined {
  return process.env.PI_MODEL || process.env.OPENAI_MODEL;
}

export function piProvider(): string {
  if (process.env.PI_PROVIDER) return process.env.PI_PROVIDER;
  const baseUrl = piSourceBaseUrl();
  if (!baseUrl) return "anthropic";
  if (baseUrl.includes("api.minimaxi.com")) return "minimax-cn";
  if (baseUrl.includes("api.minimax.io")) return "minimax";
  return "openai";
}

export function piBaseUrl(): string | undefined {
  if (process.env.PI_BASE_URL) return process.env.PI_BASE_URL;
  if (PI_NATIVE_BASE_URL_PROVIDERS.has(piProvider())) return undefined;
  return process.env.OPENAI_BASE_URL;
}

export function piApi(): string {
  if (process.env.PI_API) return process.env.PI_API;
  if (["anthropic", "minimax", "minimax-cn"].includes(piProvider())) {
    return "anthropic-messages";
  }
  return "openai-completions";
}

export function requirePiConfig(): void {
  if (piBaseUrl() && !piModel()) {
    throw new Error(
      "PI_MODEL or OPENAI_MODEL is required for Pi when using an " +
        "OpenAI/Anthropic-compatible base URL.",
    );
  }
  if (!piApiKey()) {
    throw new Error(
      "Pi requires PI_API_KEY, OPENAI_API_KEY/CODEX_API_KEY, or ANTHROPIC_API_KEY.",
    );
  }
}

export function guestAgentEnv(hostWorkspace?: string | null): Array<[string, string]> {
  const env: Array<[string, string]> = [];
  for (const key of ANTHROPIC_ENV_KEYS) {
    const value = process.env[key];
    if (value) env.push([key, value]);
  }
  const openaiKey = openaiApiKey();
  if (openaiKey) {
    env.push(["OPENAI_API_KEY", openaiKey]);
    env.push(["CODEX_API_KEY", openaiKey]);
  }
  for (const key of OPENAI_ENV_KEYS.slice(1)) {
    const value = process.env[key];
    if (value) env.push([key, value]);
  }
  for (const key of ["PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "PI_PROVIDER", "PI_API"]) {
    const value = process.env[key];
    if (value) env.push([key, value]);
  }
  if (!process.env.PI_API_KEY) {
    const value = piApiKey();
    if (value) env.push(["PI_API_KEY", value]);
  }
  if (hostWorkspace !== undefined && hostWorkspace !== null) {
    const [uid, gid] = hostWorkspaceOwner(hostWorkspace);
    env.push(["ORCHESTRIX_HOST_UID", String(uid)]);
    env.push(["ORCHESTRIX_HOST_GID", String(gid)]);
  }
  return env;
}

export function guestEnvExports(): string {
  return sessionGuestEnv
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join(" && ");
}

export function guestCodexConfigToml(): string {
  const lines = [
    "[sandbox]",
    'default_mode = "danger-full-access"',
    'model_provider = "dashscope"',
  ];
  if (process.env.OPENAI_MODEL) {
    lines.push(`model = ${JSON.stringify(process.env.OPENAI_MODEL)}`);
  }
  if (process.env.OPENAI_BASE_URL) {
    lines.push(
      "",
      "[model_providers.dashscope]",
      'name = "DashScope"',
      `base_url = ${JSON.stringify(process.env.OPENAI_BASE_URL)}`,
      'env_key = "OPENAI_API_KEY"',
      "requires_openai_auth = false",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function guestCodexAuthJson(apiKey: string): string {
  return JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: apiKey });
}

export function guestPiAuthJson(): string {
  const auth: Record<string, { type: "api_key"; key: string }> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    auth.anthropic = { type: "api_key", key: process.env.ANTHROPIC_API_KEY };
  }
  const openaiKey = openaiApiKey();
  if (openaiKey) auth.openai = { type: "api_key", key: openaiKey };
  const piKey = piApiKey();
  if (piKey) auth[piProvider()] = { type: "api_key", key: piKey };
  return JSON.stringify(auth);
}

export function guestPiModelsJson(): string {
  const provider = piProvider();
  const model = piModel();
  const baseUrl = piBaseUrl();
  if (!baseUrl || !model) return JSON.stringify({ providers: {} });
  const providerConfig: Record<string, unknown> = {
    name: `${provider} compatible`,
    baseUrl,
    apiKey: "$PI_API_KEY",
    api: piApi(),
    models: [
      {
        id: model,
        name: model,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  };
  if (piApi() === "openai-completions") {
    providerConfig.authHeader = true;
    providerConfig.compat = {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    };
  }
  return JSON.stringify({ providers: { [provider]: providerConfig } });
}

export function codexCliConfigOverrides(): string[] {
  const argv = ["-c", 'model_provider="dashscope"'];
  if (process.env.OPENAI_MODEL) argv.push("-c", `model=${JSON.stringify(process.env.OPENAI_MODEL)}`);
  if (process.env.OPENAI_BASE_URL) {
    argv.push(
      "-c",
      `model_providers.dashscope.base_url=${JSON.stringify(process.env.OPENAI_BASE_URL)}`,
      "-c",
      "model_providers.dashscope.requires_openai_auth=false",
    );
  }
  return argv;
}

export function shellQuote(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellCommand(argv: string[]): string {
  return `${argv.map(shellQuote).join(" ")} < /dev/null`;
}

export function runAsAgent(command: string): string {
  const parts = [
    "export HOME=/home/agent",
    "export CODEX_HOME=/home/agent/.codex",
    "export PI_CODING_AGENT_DIR=/home/agent/.pi/agent",
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "umask 002",
    guestEnvExports(),
    `cd ${GUEST_WORKSPACE}`,
    command,
  ].filter(Boolean);
  return `su ${AGENT_USER} -s /bin/bash -c ${shellQuote(parts.join(" && "))}`;
}

export function codexReviewPrompt(state: AgentState): string {
  return (
    "You are reviewing code in /workspace. " +
    `Task context: ${state.task_goal}. ` +
    "Read relevant files, check for blocking bugs or regressions, and report only blocking issues. " +
    "If there are no blocking issues, reply with a brief approval. " +
    "End your response with exactly one verdict line: " +
    "ORCHESTRIX_REVIEW_VERDICT: APPROVED when there are no blocking issues, " +
    "or ORCHESTRIX_REVIEW_VERDICT: REJECTED when blocking issues remain."
  );
}

export function appendCodexFeedback(prompt: string, state: AgentState): string {
  return state.codex_feedback ? `${prompt}\n\nCodex review feedback to fix:\n${state.codex_feedback}` : prompt;
}

export function claudeTaskPrompt(state: AgentState): string {
  return appendCodexFeedback(
    `Read docs/plan.md. ${state.task_goal}. Run tests and fix any errors before exiting.`,
    state,
  );
}

export function piTaskPrompt(state: AgentState): string {
  return appendCodexFeedback(
    `Read docs/plan.md. ${state.task_goal}. Inspect the current implementation, improve or fix any gaps you find, run tests, and leave the workspace in a passing state before exiting.`,
    state,
  );
}

export function buildCodexReviewCommand(state: AgentState): string {
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "codex",
    ...codexCliConfigOverrides(),
    "-C",
    GUEST_WORKSPACE,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  if (process.env.OPENAI_MODEL) argv.push("-m", process.env.OPENAI_MODEL);
  argv.push(codexReviewPrompt(state));
  return runAsAgent(shellCommand(argv));
}

export function buildClaudeImplementCommand(state: AgentState): string {
  const argv = [
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
  ];
  if (process.env.ANTHROPIC_MODEL) argv.push("--model", process.env.ANTHROPIC_MODEL);
  argv.push(claudeTaskPrompt(state));
  return runAsAgent(shellCommand(argv));
}

export function buildPiImplementCommand(state: AgentState): string {
  const argv = ["stdbuf", "-oL", "-eL", "pi", "--no-session"];
  const provider = piProvider();
  if (provider) argv.push("--provider", provider);
  const model = piModel();
  if (model) argv.push("--model", model);
  const prompt = piTaskPrompt(state);
  const streamingCommand = shellCommand([...argv, "-P", prompt]);
  const printCommand = shellCommand([...argv, "-p", prompt]);
  const supportsStreamingPrint =
    "pi --help 2>&1 | grep -Eq '(^|[[:space:]])(-P|--print-streaming)([=,[:space:]]|$)'";
  return runAsAgent(
    `if ${supportsStreamingPrint}; then ${streamingCommand}; else ${printCommand}; fi`,
  );
}

export function buildPiPreflightCommand(): string {
  const listModelsArgv = ["pi", "--list-models"];
  const provider = piProvider();
  const model = piModel();
  let modelCheck: string;
  if (model) {
    listModelsArgv.push(`${provider} ${model}`);
    const listModelsCommand = shellCommand(listModelsArgv);
    const modelRowPattern = shellQuote(
      `^${escapeRegExp(provider)}[[:space:]]+${escapeRegExp(model)}([[:space:]]|$)`,
    );
    modelCheck = [
      `model_output=$(${listModelsCommand} 2>&1)`,
      'printf "%s\\n" "$model_output"',
      `printf "%s\\n" "$model_output" | grep -E ${modelRowPattern}`,
    ].join("; ");
  } else {
    modelCheck = shellCommand(listModelsArgv);
  }
  return runAsAgent(["node --version", "command -v pi", "pi --version", modelCheck].join(" && "));
}

export function nextFailureCount(failed: boolean, currentCount: number): number {
  return failed ? currentCount + 1 : 0;
}

export function extractCodexFeedback(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: unknown } };
      if (event.type !== "item.completed") continue;
      if (event.item?.type === "agent_message") {
        const text = String(event.item.text ?? "").trim();
        if (text) messages.push(text);
      }
    } catch {
      continue;
    }
  }
  return messages.length > 0 ? messages.join("\n\n") : stdout.trim().slice(-4000);
}

export function classifyCodexReview(exitCode: number, feedback: string): "approved" | "rejected" | "failed" {
  if (exitCode !== 0) return "failed";
  let verdict = "";
  for (const rawLine of feedback.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("ORCHESTRIX_REVIEW_VERDICT:")) {
      verdict = line.split(":", 2)[1].trim().toUpperCase();
    }
  }
  if (verdict === "APPROVED") return "approved";
  if (verdict === "REJECTED") return "rejected";
  return "failed";
}

export function routeClaudeHandoff(state: AgentState): Route {
  if (state.last_exit_code === 0) {
    console.log(status("ok", "Claude finished; handing off to Pi."));
    return "pi_implement";
  }
  if (state.claude_failures < MAX_CLAUDE_FAILURES) {
    console.log(status("warn", `Claude failed with exit ${state.last_exit_code}; retry ${state.claude_failures}/${MAX_CLAUDE_FAILURES}.`));
    return "claude_implement";
  }
  console.log(status("error", `Claude failed ${MAX_CLAUDE_FAILURES} times; halting.`));
  return "__end__";
}

export function routePiHandoff(state: AgentState): Route {
  if (state.last_exit_code === 0) {
    console.log(status("ok", "Pi finished; handing off to Codex review."));
    return "codex_review";
  }
  if (state.pi_failures < MAX_PI_FAILURES) {
    console.log(status("warn", `Pi failed with exit ${state.last_exit_code}; retry ${state.pi_failures}/${MAX_PI_FAILURES}.`));
    return "pi_implement";
  }
  console.log(status("error", `Pi failed ${MAX_PI_FAILURES} times; halting.`));
  return "__end__";
}

export function routeCodexHandoff(state: AgentState): Route {
  const verdict = state.codex_verdict || "failed";
  if (verdict === "approved") {
    console.log(status("ok", "Codex approved; workflow complete."));
    return "__end__";
  }
  if (verdict === "rejected") {
    console.log(status("warn", "Codex rejected the change; handing feedback back to Claude."));
    return "claude_implement";
  }
  if (state.codex_failures < MAX_CODEX_FAILURES) {
    console.log(status("warn", `Codex review failed with exit ${state.last_exit_code}; retry ${state.codex_failures}/${MAX_CODEX_FAILURES}.`));
    return "codex_review";
  }
  console.log(status("error", `Codex review failed ${MAX_CODEX_FAILURES} times; halting.`));
  return "__end__";
}

function activeBox(): any {
  if (!sessionBox) {
    throw new Error("BoxLite sandbox is not running. Stop any other Orchestrix process and run again.");
  }
  return sessionBox;
}

async function importBoxLite(): Promise<BoxLiteModule> {
  return import("@boxlite-ai/boxlite");
}

export function ensureSingleOrchestrator(): void {
  const ignored = new Set([process.pid, process.ppid]);
  const result = spawnSync("pgrep", ["-fl", "orchestrix|orchestrator"], { encoding: "utf8" });
  if (result.status !== 0) return;
  const others: string[] = [];
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const pid = Number.parseInt(line.split(/\s+/, 1)[0], 10);
    if (Number.isFinite(pid) && !ignored.has(pid)) others.push(line);
  }
  if (others.length > 0) {
    throw new Error(
      "Another Orchestrix orchestrator is already running:\n" +
        others.map((line) => `  ${line}`).join("\n") +
        "\nStop it first (only one BoxLite runtime can use ~/.boxlite).",
    );
  }
}

export async function prepareGuestWorkspace(hostWorkspace: string): Promise<[number, number]> {
  const [uid, gid] = hostWorkspaceOwner(hostWorkspace);
  const result = await collectExecution(await activeBox().exec("bash", ["-c", GUEST_AGENT_SYNC_SCRIPT]));
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Failed to sync workspace ownership for host access. uid=${uid} gid=${gid}. ${detail}`);
  }
  return [uid, gid];
}

export async function prepareGuestAgentAuth(): Promise<void> {
  const apiKey = requireOpenaiApiKey();
  requirePiConfig();
  const authB64 = Buffer.from(guestCodexAuthJson(apiKey)).toString("base64");
  const configB64 = Buffer.from(guestCodexConfigToml()).toString("base64");
  const piAuthB64 = Buffer.from(guestPiAuthJson()).toString("base64");
  const piModelsB64 = Buffer.from(guestPiModelsJson()).toString("base64");
  const script = [
    "set -eu",
    "mkdir -p /home/agent/.codex",
    `printf %s ${shellQuote(authB64)} | base64 -d > /home/agent/.codex/auth.json`,
    `printf %s ${shellQuote(configB64)} | base64 -d > /home/agent/.codex/config.toml`,
    "chown -R agent:agent /home/agent/.codex",
    "chmod 600 /home/agent/.codex/auth.json",
    "mkdir -p /home/agent/.pi/agent",
    `printf %s ${shellQuote(piAuthB64)} | base64 -d > /home/agent/.pi/agent/auth.json`,
    `printf %s ${shellQuote(piModelsB64)} | base64 -d > /home/agent/.pi/agent/models.json`,
    "chown -R agent:agent /home/agent/.pi",
    "chmod 600 /home/agent/.pi/agent/auth.json",
  ].join("; ");
  const result = await collectExecution(await activeBox().exec("bash", ["-c", script]));
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Failed to configure Codex auth in the guest. ${detail}`);
  }
}

export async function execStream(
  cmd: string,
  args: string[] = [],
  options: { cwd?: string; stdoutRenderer?: StreamRenderer; stderrRenderer?: StreamRenderer } = {},
): Promise<StreamExecResult> {
  const box = activeBox();
  const execution = await box.exec(cmd, args, null, false, null, null, options.cwd ?? null);
  return collectExecution(execution, true, options.stdoutRenderer, options.stderrRenderer);
}

async function collectExecution(
  execution: any,
  echo = false,
  stdoutRenderer?: StreamRenderer,
  stderrRenderer?: StreamRenderer,
): Promise<StreamExecResult> {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  async function readStream(name: "stdout" | "stderr", sink: string[]): Promise<void> {
    const reader = await execution[name]();
    while (true) {
      const chunk = await reader.next();
      if (chunk === null) break;
      const text = String(chunk);
      sink.push(text);
      if (echo) {
        if (name === "stderr") {
          process.stderr.write(stderrRenderer ? stderrRenderer(text) : text);
        } else {
          process.stdout.write(stdoutRenderer ? stdoutRenderer(text) : text);
        }
      }
    }
  }

  await Promise.all([readStream("stdout", stdoutParts), readStream("stderr", stderrParts)]);
  const result = await execution.wait();
  return {
    exit_code: result.exitCode ?? -1,
    stdout: stdoutParts.join(""),
    stderr: stderrParts.join(""),
    error_message: result.errorMessage,
  };
}

export class PlainTextStreamRenderer {
  private atLineStart = true;

  constructor(
    private readonly name: string,
    private readonly accent: string,
  ) {}

  feed(chunk: string): string {
    let output = "";
    for (const char of chunk) {
      if (this.atLineStart && char !== "\n" && char !== "\r") {
        output += `${agentLabel(this.name, this.accent)} ${color("|", ansi.dim)} `;
        this.atLineStart = false;
      }
      output += char;
      if (char === "\n") this.atLineStart = true;
    }
    return output;
  }
}

export class StderrLineRenderer {
  private buffer = "";

  feed(chunk: string): string {
    this.buffer += chunk;
    const output: string[] = [];
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      const formatted = this.formatLine(line);
      if (formatted) output.push(formatted);
    }
    return output.join("");
  }

  private formatLine(line: string): string {
    if (!line) return "";
    if (line.includes("seccomp not available")) return "";
    return `${status("warn", line)}\n`;
  }
}

export class JsonLineRenderer {
  private buffer = "";

  constructor(private readonly formatLine: (line: string) => string) {}

  feed(chunk: string): string {
    this.buffer += chunk;
    const output: string[] = [];
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) output.push(this.formatLine(line));
    }
    return output.join("");
  }
}

export class ClaudeStreamRenderer {
  private readonly text = new PlainTextStreamRenderer("Claude", ansi.magenta);
  private readonly thinking = new PlainTextStreamRenderer("Claude thinking", ansi.magenta);

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${line}\n`);

    if (event.type === "stream_event") {
      const streamEvent = asRecord(event.event);
      const delta = asRecord(streamEvent.delta);
      const contentBlock = asRecord(streamEvent.content_block);
      if (streamEvent.type === "content_block_start") {
        if (contentBlock.type === "tool_use") {
          return `\n${agentLabel("Claude", ansi.magenta)} ${color("tool", ansi.dim)} ${String(contentBlock.name ?? "unknown")}\n`;
        }
        return "";
      }
      if (streamEvent.type === "content_block_stop") return "\n";
      if (delta.type === "text_delta") return this.text.feed(String(delta.text ?? ""));
      if (delta.type === "thinking_delta") return this.thinking.feed(String(delta.thinking ?? ""));
      return "";
    }

    if (event.type === "result") {
      return event.is_error
        ? `\n${status("error", `Claude error: ${String(event.result ?? "unknown error")}`)}\n`
        : `\n${status("ok", "Claude finished.")}\n`;
    }
    if (event.type === "system" && event.subtype === "api_retry") {
      return `\n${status("warn", `Claude API retry ${String(event.attempt ?? "?")}/${String(event.max_retries ?? "?")}.`)}\n`;
    }
    return "";
  }
}

export class CodexStreamRenderer {
  private readonly text = new PlainTextStreamRenderer("Codex", ansi.blue);
  private readonly reasoning = new PlainTextStreamRenderer("Codex reasoning", ansi.blue);

  feed(chunk: string): string {
    return this.lines.feed(chunk);
  }

  private readonly lines = new JsonLineRenderer((line) => this.formatLine(line));

  private formatLine(line: string): string {
    const event = parseJsonObject(line);
    if (!event) return this.text.feed(`${line}\n`);

    if (event.type === "turn.started") return `\n${status("info", "Codex is reviewing.")}\n`;
    if (event.type === "turn.completed") return `\n${status("ok", "Codex finished.")}\n`;
    if (event.type === "turn.failed") {
      const error = asRecord(event.error);
      return `\n${status("error", `Codex failed: ${String(error.message ?? "turn failed")}`)}\n`;
    }
    if (event.type === "error") return `\n${status("error", `Codex error: ${String(event.message ?? "unknown error")}`)}\n`;

    if (typeof event.type === "string" && event.type.startsWith("item.")) {
      const item = asRecord(event.item);
      if (item.type === "agent_message" && event.type === "item.completed") {
        const text = String(item.text ?? "");
        return text.trim() ? `\n${this.text.feed(`${text.trim()}\n`)}` : "";
      }
      if (item.type === "reasoning" && event.type === "item.completed") {
        const text = String(item.text ?? "");
        return text.trim() ? `\n${this.reasoning.feed(`${text.trim()}\n`)}` : "";
      }
      if (item.type === "command_execution" && event.type === "item.started") {
        return `\n${agentLabel("Codex", ansi.blue)} ${color("command", ansi.dim)} ${String(item.command ?? "command")}\n`;
      }
      if (item.type === "file_change" && event.type === "item.completed") {
        return `\n${status("info", "Codex changed files.")}\n`;
      }
    }
    return "";
  }
}

export function formatClaudeJsonLine(line: string): string {
  return new ClaudeStreamRenderer().feed(`${line}\n`);
}

export function formatCodexJsonLine(line: string): string {
  return new CodexStreamRenderer().feed(`${line}\n`);
}

export function dockerImageId(image: string): string | undefined {
  const inspect = spawnSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
    encoding: "utf8",
  });
  if (inspect.status !== 0) return undefined;
  return inspect.stdout.trim() || undefined;
}

export function ensureLocalDevboxOci(): string {
  const inspect = spawnSync("docker", ["image", "inspect", DEVBOX_IMAGE], { encoding: "utf8" });
  if (inspect.status !== 0) {
    throw new Error(`Local image ${JSON.stringify(DEVBOX_IMAGE)} not found. Build it with: make devbox-image`);
  }

  const imageId = dockerImageId(DEVBOX_IMAGE);
  const stampFile = resolve(OCI_LAYOUT_DIR, ".docker-image-id");
  const dockerfileStamp = resolve(OCI_LAYOUT_DIR, ".dockerfile-mtime");
  const ociLayout = resolve(OCI_LAYOUT_DIR, "oci-layout");
  const dockerfileMtime = String(statSync(DOCKERFILE, { bigint: true }).mtimeNs);
  if (
    existsSync(ociLayout) &&
    existsSync(stampFile) &&
    existsSync(dockerfileStamp) &&
    imageId &&
    readFileSync(stampFile, "utf8").trim() === imageId &&
    readFileSync(dockerfileStamp, "utf8").trim() === dockerfileMtime
  ) {
    return OCI_LAYOUT_DIR;
  }

  const previousImageId = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";
  const previousDockerfileMtime = existsSync(dockerfileStamp)
    ? readFileSync(dockerfileStamp, "utf8").trim()
    : "";
  if (existsSync(ociLayout) && previousDockerfileMtime !== dockerfileMtime && previousImageId === imageId) {
    throw new Error(
      "The devbox dockerfile changed, but the Docker image has not been rebuilt. " +
        "Run make run-fresh once, or run make devbox-image before make run.",
    );
  }

  mkdirSync(OCI_LAYOUT_DIR, { recursive: true });
  console.log(status("info", `Exporting ${DEVBOX_IMAGE} to ${OCI_LAYOUT_DIR}.`));
  const exported = spawnSync("sh", ["-c", `docker save ${shellQuote(DEVBOX_IMAGE)} | tar -xf - -C ${shellQuote(OCI_LAYOUT_DIR)}`], {
    stdio: "inherit",
  });
  if (exported.status !== 0) throw new Error("Failed to export Docker image for BoxLite.");
  if (imageId) {
    writeFileSync(stampFile, `${imageId}\n`);
    writeFileSync(dockerfileStamp, `${dockerfileMtime}\n`);
  }
  return OCI_LAYOUT_DIR;
}

export async function claudeImplementNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(promptBlock("Claude Code - implementation", claudeTaskPrompt(state), ansi.magenta));
  const renderer = new ClaudeStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const result = await execStream("bash", ["-c", buildClaudeImplementCommand(state)], {
    cwd: GUEST_WORKSPACE,
    stdoutRenderer: (chunk) => renderer.feed(chunk),
    stderrRenderer: (chunk) => stderrRenderer.feed(chunk),
  });
  return {
    agent_logs: [`[Claude Code Exit ${result.exit_code}]:\n${result.stdout.slice(-500)}`],
    last_exit_code: result.exit_code,
    claude_failures: nextFailureCount(result.exit_code !== 0, state.claude_failures),
  };
}

export async function piImplementNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(promptBlock("Pi - implementation review", piTaskPrompt(state), ansi.yellow));
  const renderer = new PlainTextStreamRenderer("Pi", ansi.yellow);
  const stderrRenderer = new StderrLineRenderer();
  const result = await execStream("bash", ["-c", buildPiImplementCommand(state)], {
    cwd: GUEST_WORKSPACE,
    stdoutRenderer: (chunk) => renderer.feed(chunk),
    stderrRenderer: (chunk) => stderrRenderer.feed(chunk),
  });
  return {
    agent_logs: [`[Pi Exit ${result.exit_code}]:\n${result.stdout.slice(-500)}`],
    last_exit_code: result.exit_code,
    pi_failures: nextFailureCount(result.exit_code !== 0, state.pi_failures),
  };
}

export async function codexReviewNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(promptBlock("Codex - code review", codexReviewPrompt(state), ansi.blue));
  const renderer = new CodexStreamRenderer();
  const stderrRenderer = new StderrLineRenderer();
  const result = await execStream("bash", ["-c", buildCodexReviewCommand(state)], {
    cwd: GUEST_WORKSPACE,
    stdoutRenderer: (chunk) => renderer.feed(chunk),
    stderrRenderer: (chunk) => stderrRenderer.feed(chunk),
  });
  const feedback = extractCodexFeedback(result.stdout);
  const verdict = classifyCodexReview(result.exit_code, feedback);
  return {
    agent_logs: [`[Codex Review Exit ${result.exit_code}]:\n${result.stdout}`],
    last_exit_code: result.exit_code,
    codex_failures: nextFailureCount(verdict === "failed", state.codex_failures),
    codex_verdict: verdict,
    codex_feedback: feedback,
  };
}

function mergeState(state: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...state,
    ...patch,
    agent_logs: [...state.agent_logs, ...(patch.agent_logs ?? [])],
  };
}

export async function runWorkflow(initialState: AgentState): Promise<AgentState> {
  let state = initialState;
  let next: Route = "claude_implement";
  while (next !== "__end__") {
    if (next === "claude_implement") {
      state = mergeState(state, await claudeImplementNode(state));
      next = routeClaudeHandoff(state);
    } else if (next === "pi_implement") {
      state = mergeState(state, await piImplementNode(state));
      next = routePiHandoff(state);
    } else {
      state = mergeState(state, await codexReviewNode(state));
      next = routeCodexHandoff(state);
    }
  }
  return state;
}

export async function main(): Promise<void> {
  ensureSingleOrchestrator();
  console.log(section("Orchestrix", ansi.cyan));
  console.log(keyValue("image", DEVBOX_IMAGE));
  console.log(keyValue("mount", GUEST_WORKSPACE));
  const rootfsPath = ensureLocalDevboxOci();
  const hostWorkspace = hostWorkspacePath();
  requireOpenaiApiKey();

  const { JsBoxlite } = await importBoxLite();
  const runtime = JsBoxlite.withDefaultConfig();
  const boxName = "orchestrix";
  try {
    const [hostUid, hostGid] = hostWorkspaceOwner(hostWorkspace);
    sessionGuestEnv = guestAgentEnv(hostWorkspace);
    const env = sessionGuestEnv.map(([key, value]) => ({ key, value }));
    const box = await runtime.create(
      {
        rootfsPath,
        volumes: [{ hostPath: hostWorkspace, guestPath: GUEST_WORKSPACE, readOnly: false }],
        env,
        workingDir: GUEST_WORKSPACE,
      },
      boxName,
    );
    sessionBox = box;
    console.log(keyValue("rootfs", rootfsPath));
    console.log(keyValue("workspace", hostWorkspace));

    const [syncedUid, syncedGid] = await prepareGuestWorkspace(hostWorkspace);
    await prepareGuestAgentAuth();
    console.log(keyValue("owner", `uid=${syncedUid} gid=${syncedGid} (host uid=${hostUid} gid=${hostGid})`));
    console.log(keyValue("codex", `provider=dashscope base_url=${process.env.OPENAI_BASE_URL || "(default)"}`));
    console.log(keyValue("pi", `provider=${piProvider()} model=${piModel() || "(default)"} base_url=${piBaseUrl() || "(default)"}`));

    for (const [name, command] of [
      ["Claude Code", runAsAgent("claude --version")],
      ["Codex auth", runAsAgent("codex login status")],
      ["Pi coding agent", buildPiPreflightCommand()],
    ] as const) {
      const result = await collectExecution(await box.exec("bash", ["-c", command]));
      if (result.exit_code !== 0) {
        const detail = (result.stderr || result.stdout).trim();
        throw new Error(`${name} preflight failed. ${detail}`);
      }
      console.log(status("ok", `${name} preflight passed.`));
    }

    await runWorkflow({
      task_goal: "Implement the auth middleware in src/api/middleware.ts",
      agent_logs: [],
      last_exit_code: 0,
      claude_failures: 0,
      pi_failures: 0,
      codex_failures: 0,
      codex_verdict: "",
      codex_feedback: "",
    });
  } finally {
    if (sessionBox) await sessionBox.stop();
    sessionBox = null;
    if (runtime.remove) await runtime.remove(boxName);
  }
}

export function run(argv: string[] = process.argv.slice(2)): void {
  if (argv.length > 0) {
    throw new Error(`Unknown arguments: ${argv.join(" ")}`);
  }
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
