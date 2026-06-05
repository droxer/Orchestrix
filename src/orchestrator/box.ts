import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEVBOX_IMAGE,
  DOCKERFILE,
  OCI_LAYOUT_DIR,
  requireOpenaiApiKey,
  requirePiConfig,
} from "./env.js";
import { emitOrPrint, status } from "./format.js";
import {
  GUEST_AGENT_SYNC_SCRIPT,
  encodeBase64,
  guestCodexAuthJson,
  guestCodexConfigToml,
  guestPiAuthJson,
  guestPiModelsJson,
} from "./guest.js";
import { shellQuote } from "./shell.js";
import { hostWorkspaceOwner } from "./env.js";
import type { AgentName, AgentOutputSink, StreamExecResult } from "./state.js";

type BoxLiteModule = typeof import("@boxlite-ai/boxlite");
type StreamRenderer = (chunk: string) => string;

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

export function ensureSingleOrchestrator(): void {
  const ignored = new Set([process.pid, process.ppid]);
  const result = spawnSync("pgrep", ["-fl", "relay|orchestrator"], { encoding: "utf8" });
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

export function dockerImageId(image: string): string | undefined {
  const inspect = spawnSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
    encoding: "utf8",
  });
  if (inspect.status !== 0) return undefined;
  return inspect.stdout.trim() || undefined;
}

export function ensureLocalDevboxOci(sink?: AgentOutputSink): string {
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
  emitOrPrint(sink, status("info", `Exporting ${DEVBOX_IMAGE} to ${OCI_LAYOUT_DIR}.`));
  const exported = spawnSync("sh", ["-c", `docker save ${shellQuote(DEVBOX_IMAGE)} | tar -xf - -C ${shellQuote(OCI_LAYOUT_DIR)}`], {
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
  return OCI_LAYOUT_DIR;
}
