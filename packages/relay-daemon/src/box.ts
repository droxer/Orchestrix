import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

import {
  DEVBOX_IMAGE,
  DOCKERFILE,
  OCI_LAYOUT_DIR,
  requireOpenaiApiKey,
  requirePiConfig,
} from "relay-core";
import { emitOrPrint, status } from "relay-core";
import {
  GUEST_AGENT_SYNC_SCRIPT,
  encodeBase64,
  guestCodexAuthJson,
  guestCodexConfigToml,
  guestPiAuthJson,
  guestPiModelsJson,
} from "relay-core";
import { shellQuote } from "relay-core";
import { hostWorkspaceOwner } from "relay-core";
import type { AgentName, AgentOutputSink, StreamExecResult } from "relay-core";

export type BoxLiteModule = typeof import("@boxlite-ai/boxlite");
type StreamRenderer = (chunk: string) => string;
type CommandRunner = typeof spawnSync;
interface KimiCodeFile {
  relativePath: string;
  content: Buffer;
}

const KIMI_CODE_AUTH_ENTRIES = ["config.toml", "tui.toml", "credentials", "oauth"] as const;

export interface DevboxOciOptions {
  dockerfile?: string;
  ociLayoutDir?: string;
  runCommand?: CommandRunner;
}

let sessionBox: any | null = null;

export function setSessionBox(box: any | null): void {
  sessionBox = box;
}

export async function stopSessionBox(): Promise<void> {
  if (sessionBox) await sessionBox.stop();
  sessionBox = null;
}

export function activeBox(): any {
  if (!sessionBox) {
    throw new Error("BoxLite sandbox is not running. Stop any other Relay process and run again.");
  }
  return sessionBox;
}

export async function importBoxLite(): Promise<BoxLiteModule> {
  return import("@boxlite-ai/boxlite");
}

export function ensureSingleOrchestrator(pattern = "relay|orchestrator"): void {
  const ignored = new Set([process.pid, process.ppid]);
  const result = spawnSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
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
      "Another Relay orchestrator is already running:\n" +
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

export function hostKimiCodeHomePath(): string {
  return resolve(process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"));
}

export function prepareHostKimiCodeHome(targetHome: string): void {
  for (const file of collectKimiCodeFiles()) {
    const target = join(targetHome, file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, { mode: 0o600 });
    chmodSync(target, 0o600);
  }
}

function kimiCodeGuestSetupScript(targetHome = "/home/agent/.kimi-code"): string[] {
  const files = collectKimiCodeFiles();
  const script = [
    `mkdir -p ${shellQuote(targetHome)}`,
  ];
  for (const file of files) {
    const target = posix.join(targetHome, ...file.relativePath.split(posix.sep));
    script.push(
      `mkdir -p ${shellQuote(posix.dirname(target))}`,
      `printf %s ${shellQuote(file.content.toString("base64"))} | base64 -d > ${shellQuote(target)}`,
      `chmod 600 ${shellQuote(target)}`,
    );
  }
  script.push(
    `chown -R agent:agent ${shellQuote(targetHome)}`,
    `find ${shellQuote(targetHome)} -type d -exec chmod 700 {} +`,
  );
  return script;
}

function collectKimiCodeFiles(sourceHome = hostKimiCodeHomePath()): KimiCodeFile[] {
  if (!existsSync(sourceHome)) {
    throw new Error(`Kimi Code home not found at ${sourceHome}. Run kimi login on the host or set KIMI_CODE_HOME.`);
  }
  const files: KimiCodeFile[] = [];
  for (const entry of KIMI_CODE_AUTH_ENTRIES) {
    const path = join(sourceHome, entry);
    if (existsSync(path)) collectKimiCodePath(sourceHome, path, files);
  }
  if (files.length === 0) {
    throw new Error(`Kimi Code home at ${sourceHome} does not contain config or credential files.`);
  }
  return files;
}

function collectKimiCodePath(sourceHome: string, path: string, files: KimiCodeFile[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path).sort()) collectKimiCodePath(sourceHome, join(path, child), files);
    return;
  }
  if (!stat.isFile()) return;
  const relativePath = relative(sourceHome, path).split(sep).join(posix.sep);
  if (!relativePath || relativePath.startsWith("../") || relativePath === "..") return;
  files.push({ relativePath, content: readFileSync(path) });
}

export async function prepareGuestAgentAuth(agents: Iterable<AgentName> = ["codex", "pi"], signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Agent auth setup cancelled.");
  const selectedAgents = new Set(agents);
  const script = [
    "set -eu",
  ];
  if (selectedAgents.has("codex")) {
    const apiKey = requireOpenaiApiKey();
    const authB64 = encodeBase64(guestCodexAuthJson(apiKey));
    const configB64 = encodeBase64(guestCodexConfigToml());
    script.push(
      "mkdir -p /home/agent/.codex",
      `printf %s ${shellQuote(authB64)} | base64 -d > /home/agent/.codex/auth.json`,
      `printf %s ${shellQuote(configB64)} | base64 -d > /home/agent/.codex/config.toml`,
      "chown -R agent:agent /home/agent/.codex",
      "chmod 600 /home/agent/.codex/auth.json",
    );
  }
  if (selectedAgents.has("pi")) {
    requirePiConfig();
    const piAuthB64 = encodeBase64(guestPiAuthJson());
    const piModelsB64 = encodeBase64(guestPiModelsJson());
    script.push(
      "mkdir -p /home/agent/.pi/agent",
      `printf %s ${shellQuote(piAuthB64)} | base64 -d > /home/agent/.pi/agent/auth.json`,
      `printf %s ${shellQuote(piModelsB64)} | base64 -d > /home/agent/.pi/agent/models.json`,
      "chown -R agent:agent /home/agent/.pi",
      "chmod 600 /home/agent/.pi/agent/auth.json",
    );
  }
  if (selectedAgents.has("kimi")) {
    script.push(...kimiCodeGuestSetupScript());
  }
  if (script.length === 1) return;
  const command = script.join("; ");
  const result = await collectExecution(await activeBox().exec("bash", ["-c", command]), false, undefined, undefined, undefined, signal);
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Failed to configure agent auth in the guest. ${detail}`);
  }
}

export async function execStream(
  cmd: string,
  args: string[] = [],
  options: { cwd?: string; stdoutRenderer?: StreamRenderer; stderrRenderer?: StreamRenderer; sink?: AgentOutputSink; signal?: AbortSignal } = {},
): Promise<StreamExecResult> {
  if (options.signal?.aborted) {
    return { exit_code: -1, stdout: "", stderr: "", error_message: "Execution cancelled before start." };
  }
  const box = activeBox();
  const execution = await box.exec(cmd, args, null, false, null, null, options.cwd ?? null);
  return collectExecution(execution, true, options.stdoutRenderer, options.stderrRenderer, options.sink, options.signal);
}

export async function collectExecution(
  execution: any,
  echo = false,
  stdoutRenderer?: StreamRenderer,
  stderrRenderer?: StreamRenderer,
  sink?: AgentOutputSink,
  signal?: AbortSignal,
): Promise<StreamExecResult> {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let cancelled = false;
  const abortExecution = (): void => {
    cancelled = true;
    void execution.kill?.().catch(() => undefined);
  };
  if (signal?.aborted) abortExecution();
  signal?.addEventListener("abort", abortExecution, { once: true });

  async function readStream(name: "stdout" | "stderr", parts: string[]): Promise<void> {
    const reader = await execution[name]();
    while (true) {
      const chunk = await reader.next();
      if (chunk === null) break;
      const text = String(chunk);
      parts.push(text);
      if (echo) {
        const rendered = name === "stderr"
          ? stderrRenderer ? stderrRenderer(text) : text
          : stdoutRenderer ? stdoutRenderer(text) : text;
        if (sink) {
          sink(rendered);
          continue;
        }
        if (name === "stderr") {
          process.stderr.write(rendered);
        } else {
          process.stdout.write(rendered);
        }
      }
    }
  }

  try {
    await closeExecutionStdin(execution);
    await Promise.all([readStream("stdout", stdoutParts), readStream("stderr", stderrParts)]);
    const result = await execution.wait();
    return {
      exit_code: result.exitCode ?? -1,
      stdout: stdoutParts.join(""),
      stderr: stderrParts.join(""),
      error_message: cancelled ? "Execution cancelled." : result.errorMessage,
    };
  } finally {
    signal?.removeEventListener("abort", abortExecution);
  }
}

async function closeExecutionStdin(execution: any): Promise<void> {
  if (typeof execution.stdin !== "function") return;
  try {
    const stdin = await execution.stdin();
    await stdin?.close?.();
  } catch {
    // Some BoxLite runtimes may not expose stdin for every execution.
  }
}

export function dockerImageId(image: string, options: DevboxOciOptions = {}): string | undefined {
  const runCommand = options.runCommand ?? spawnSync;
  const inspect = runCommand("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
    encoding: "utf8",
  });
  if (inspect.status !== 0) return undefined;
  return inspect.stdout.trim() || undefined;
}

export function ensureLocalDevboxOci(sink?: AgentOutputSink, options: DevboxOciOptions = {}): string {
  const runCommand = options.runCommand ?? spawnSync;
  const dockerfile = options.dockerfile ?? DOCKERFILE;
  const ociLayoutDir = options.ociLayoutDir ?? OCI_LAYOUT_DIR;
  let inspect = runCommand("docker", ["image", "inspect", DEVBOX_IMAGE], { encoding: "utf8" });
  if (inspect.status !== 0) {
    emitOrPrint(sink, status("info", `Local image ${DEVBOX_IMAGE} not found; building and exporting the devbox.`));
    const built = runCommand("make", ["devbox-oci"], { encoding: "utf8", stdio: "inherit" });
    if (built.status !== 0) {
      throw new Error(`Failed to build local devbox image. Run make devbox-image and retry.`);
    }
    inspect = runCommand("docker", ["image", "inspect", DEVBOX_IMAGE], { encoding: "utf8" });
    if (inspect.status !== 0) {
      throw new Error(`Local image ${JSON.stringify(DEVBOX_IMAGE)} was not created by make devbox-oci.`);
    }
  }

  const imageId = dockerImageId(DEVBOX_IMAGE, { runCommand });
  const stampFile = resolve(ociLayoutDir, ".docker-image-id");
  const dockerfileStamp = resolve(ociLayoutDir, ".dockerfile-mtime");
  const ociLayout = resolve(ociLayoutDir, "oci-layout");
  const dockerfileMtime = String(statSync(dockerfile, { bigint: true }).mtimeNs);
  if (
    existsSync(ociLayout) &&
    existsSync(stampFile) &&
    existsSync(dockerfileStamp) &&
    imageId &&
    readFileSync(stampFile, "utf8").trim() === imageId &&
    readFileSync(dockerfileStamp, "utf8").trim() === dockerfileMtime
  ) {
    return ociLayoutDir;
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

  mkdirSync(ociLayoutDir, { recursive: true });
  emitOrPrint(sink, status("info", `Exporting ${DEVBOX_IMAGE} to ${ociLayoutDir}.`));
  const exported = runCommand("sh", ["-c", `docker save ${shellQuote(DEVBOX_IMAGE)} | tar -xf - -C ${shellQuote(ociLayoutDir)}`], {
    encoding: "utf8",
  });
  if (exported.status !== 0) {
    const detail = `${exported.stderr || ""}${exported.stdout || ""}`.trim();
    throw new Error(`Failed to export Docker image for BoxLite.${detail ? ` ${detail}` : ""}`);
  }
  if (imageId) {
    writeFileSync(stampFile, `${imageId}\n`);
    writeFileSync(dockerfileStamp, `${dockerfileMtime}\n`);
  }
  return ociLayoutDir;
}
