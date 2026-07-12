import { Buffer } from "node:buffer";

import {
  anthropicApiKey,
  anthropicBaseUrl,
  anthropicModel,
  hostWorkspaceOwner,
  openaiBaseUrl,
  openaiApiKey,
  openaiModel,
  piApi,
  piApiKey,
  piBaseUrl,
  piModel,
  piProvider,
} from "./env.js";
import { AGENT_USER, GUEST_WORKSPACE, type AgentName } from "./state.js";
import { shellQuote } from "./shell.js";

export const GUEST_AGENT_SYNC_SCRIPT = `
set -eu
uid="\${RELAY_HOST_UID:?}"
gid="\${RELAY_HOST_GID:?}"
ws="/workspace"

if ! getent group "$gid" >/dev/null 2>&1; then
  groupadd -g "$gid" relay-host
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

export let sessionGuestEnv: Array<[string, string]> = [];

export function setSessionGuestEnv(env: Array<[string, string]>): void {
  sessionGuestEnv = env;
}

/**
 * Per-agent credential resolvers. Each entry returns ONLY the secrets and
 * provider settings that agent needs at runtime, so a run is never handed
 * another provider's API key. The `Record<AgentName, …>` type forces an entry
 * when a new agent is added to the registry. Resolution reads `process.env`
 * (and the `.env`-derived fallbacks in env.ts) at call time so injection is
 * scoped to the single command invocation rather than the VM's lifetime.
 */
const AGENT_CREDENTIAL_ENV: Record<AgentName, () => Array<[string, string]>> = {
  claude: () => {
    const env: Array<[string, string]> = [];
    pushEnv(env, "ANTHROPIC_API_KEY", anthropicApiKey());
    pushEnv(env, "ANTHROPIC_BASE_URL", anthropicBaseUrl());
    pushEnv(env, "ANTHROPIC_MODEL", anthropicModel());
    return env;
  },
  codex: () => {
    const env: Array<[string, string]> = [];
    const openaiKey = openaiApiKey();
    if (openaiKey) {
      env.push(["OPENAI_API_KEY", openaiKey]);
      env.push(["CODEX_API_KEY", openaiKey]);
    }
    pushEnv(env, "OPENAI_BASE_URL", openaiBaseUrl());
    pushEnv(env, "OPENAI_MODEL", openaiModel());
    return env;
  },
  pi: () => {
    const env: Array<[string, string]> = [];
    for (const key of ["PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "PI_PROVIDER", "PI_API"]) {
      const value = process.env[key];
      if (value) env.push([key, value]);
    }
    if (!process.env.PI_API_KEY) {
      const value = piApiKey();
      if (value) env.push(["PI_API_KEY", value]);
    }
    return env;
  },
  kimi: () => {
    const env: Array<[string, string]> = [];
    for (const key of [
      "KIMI_API_KEY", "KIMI_BASE_URL", "KIMI_MODEL",
      "MOONSHOT_API_KEY", "MOONSHOT_BASE_URL", "MOONSHOT_MODEL",
    ]) {
      const value = process.env[key];
      if (value) env.push([key, value]);
    }
    return env;
  },
};

/** The credential/provider env a single agent run needs — nothing else. */
export function agentCredentialEnv(agent: AgentName): Array<[string, string]> {
  return AGENT_CREDENTIAL_ENV[agent]();
}

/**
 * Non-secret infrastructure env handed to the sandbox at creation. API keys are
 * deliberately excluded here: baking them into the box would make them resident
 * for the VM's whole lifetime and visible to every process and every agent.
 * Credentials are injected per run via {@link runAsAgent} instead.
 */
export function guestAgentEnv(hostWorkspace?: string | null): Array<[string, string]> {
  const env: Array<[string, string]> = [];
  if (hostWorkspace !== undefined && hostWorkspace !== null) {
    const [uid, gid] = hostWorkspaceOwner(hostWorkspace);
    env.push(["RELAY_HOST_UID", String(uid)]);
    env.push(["RELAY_HOST_GID", String(gid)]);
  }
  return env;
}

function envExports(env: Array<[string, string]>): string {
  return env
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join(" && ");
}

export function guestEnvExports(): string {
  return envExports(sessionGuestEnv);
}

export function guestCodexConfigToml(): string {
  const lines = [
    "[sandbox]",
    'default_mode = "danger-full-access"',
    'model_provider = "dashscope"',
  ];
  const model = openaiModel();
  const baseUrl = openaiBaseUrl();
  if (model) {
    lines.push(`model = ${JSON.stringify(model)}`);
  }
  if (baseUrl) {
    lines.push(
      "",
      "[model_providers.dashscope]",
      'name = "DashScope"',
      `base_url = ${JSON.stringify(baseUrl)}`,
      'env_key = "OPENAI_API_KEY"',
      "requires_openai_auth = false",
    );
  }
  const multiAgent = codexMultiAgentEnabled();
  lines.push(
    "",
    "[features]",
    `multi_agent = ${multiAgent}`,
    `multi_agent_v2 = ${multiAgent}`,
  );
  return `${lines.join("\n")}\n`;
}

export function guestCodexAuthJson(apiKey: string): string {
  return JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: apiKey });
}

export function guestPiAuthJson(): string {
  const auth: Record<string, { type: "api_key"; key: string }> = {};
  const anthropicKey = anthropicApiKey();
  if (anthropicKey) auth.anthropic = { type: "api_key", key: anthropicKey };
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
  const multiAgent = codexMultiAgentEnabled();
  const argv = [
    "-c",
    'model_provider="dashscope"',
    "-c",
    `features.multi_agent=${multiAgent}`,
    "-c",
    `features.multi_agent_v2=${multiAgent}`,
  ];
  const model = openaiModel();
  const baseUrl = openaiBaseUrl();
  if (model) argv.push("-c", `model=${JSON.stringify(model)}`);
  if (baseUrl) {
    argv.push(
      "-c",
      `model_providers.dashscope.base_url=${JSON.stringify(baseUrl)}`,
      "-c",
      "model_providers.dashscope.requires_openai_auth=false",
    );
  }
  return argv;
}

function codexMultiAgentEnabled(): boolean {
  const value = process.env.RELAY_CODEX_MULTI_AGENT?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

function pushEnv(env: Array<[string, string]>, key: string, value: string | undefined): void {
  if (value) env.push([key, value]);
}

/**
 * Wrap a command so it runs as the guest `agent` user with the right HOME and
 * working directory. When `agent` is given, only that agent's credentials are
 * exported inline — they live in the command's shell process and are gone once
 * it exits, so no provider key persists in the VM or leaks across agents. The
 * agentless form falls back to the (non-secret) session env for legacy callers.
 */
export function runAsAgent(command: string, agent?: AgentName): string {
  const workspace = agentWorkspacePath();
  const home = agentHomePath();
  const credentialExports = agent ? envExports(agentCredentialEnv(agent)) : guestEnvExports();
  if (process.env.RELAY_RUN_AS_CURRENT_USER === "1") {
    return [
      `export HOME=${shellQuote(home)}`,
      `export CODEX_HOME=${shellQuote(`${home}/.codex`)}`,
      `export PI_CODING_AGENT_DIR=${shellQuote(`${home}/.pi/agent`)}`,
      `export KIMI_CODE_HOME=${shellQuote(`${home}/.kimi-code`)}`,
      credentialExports,
      `cd ${shellQuote(workspace)}`,
      command,
    ].filter(Boolean).join(" && ");
  }
  const parts = [
    "export HOME=/home/agent",
    "export CODEX_HOME=/home/agent/.codex",
    "export PI_CODING_AGENT_DIR=/home/agent/.pi/agent",
    "export KIMI_CODE_HOME=/home/agent/.kimi-code",
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "umask 002",
    credentialExports,
    `cd ${shellQuote(workspace)}`,
    command,
  ].filter(Boolean);
  return `su ${AGENT_USER} -s /bin/bash -c ${shellQuote(parts.join(" && "))}`;
}

export function agentWorkspacePath(): string {
  return process.env.RELAY_AGENT_WORKSPACE || GUEST_WORKSPACE;
}

export function agentHomePath(): string {
  return process.env.RELAY_AGENT_HOME || "/home/agent";
}

export function encodeBase64(value: string): string {
  return Buffer.from(value).toString("base64");
}
