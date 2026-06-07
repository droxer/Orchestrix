import { mkdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(currentFile), "../../..", "..");
export const DEVBOX_IMAGE = "relay-devbox:v1";
export const OCI_LAYOUT_DIR = resolve(REPO_ROOT, ".oci/relay-devbox-v1");
export const DOCKERFILE = resolve(REPO_ROOT, "dockerfile");

export const ANTHROPIC_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
] as const;

export const OPENAI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

export const DEFAULT_HOST_WORKSPACE = "~/projects/air-platform";
export const PI_NATIVE_BASE_URL_PROVIDERS = new Set(["minimax", "minimax-cn"]);

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

loadDotEnv(resolve(REPO_ROOT, ".env"));
if (process.env.RELAY_WORKSPACE) {
  loadDotEnv(resolve(expandUser(process.env.RELAY_WORKSPACE), ".env"));
}
loadDotEnv(resolve(process.cwd(), ".env"));

export function hostWorkspacePath(raw?: string | null): string {
  const selected = raw?.trim() || process.env.RELAY_WORKSPACE?.trim() || DEFAULT_HOST_WORKSPACE;
  const path = resolve(expandUser(selected));
  mkdirSync(path, { recursive: true });
  return path;
}

export function hostWorkspaceOwner(path: string): [number, number] {
  const resolved = hostWorkspacePath(path);
  const stat = statSync(resolved);
  return [stat.uid, stat.gid];
}

export function openaiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.LLM_API_KEY;
}

export function openaiBaseUrl(): string | undefined {
  return process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL;
}

export function openaiModel(): string | undefined {
  return process.env.OPENAI_MODEL || process.env.LLM_MODEL;
}

export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
}

export function anthropicBaseUrl(): string | undefined {
  return process.env.ANTHROPIC_BASE_URL || process.env.CLAUDE_BASE_URL;
}

export function anthropicModel(): string | undefined {
  return process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL;
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
  return process.env.PI_API_KEY || openaiApiKey() || anthropicApiKey();
}

export function piSourceBaseUrl(): string | undefined {
  return process.env.PI_BASE_URL || openaiBaseUrl();
}

export function piModel(): string | undefined {
  return process.env.PI_MODEL || openaiModel();
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
  return openaiBaseUrl();
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
